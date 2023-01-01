export { InMemoryFileHandler } from './inMemoryFileHandler.js';
export { VirtualFileHandler } from './virtualFile.js';

import Fuse, { Stat } from 'fuse-native';
import { S_IFDIR, S_IFREG, S_IRGRP, S_IROTH, S_IRUSR, S_IRWXG, S_IRWXU, S_IWGRP, S_IWUSR, S_IXGRP, S_IXOTH, S_IXUSR } from 'node:constants';
import { mkdir } from 'node:fs/promises';
import { todo, unreachable } from '../assert.js';
import { Awaitable } from '../awaitable.js';
import { IOError } from '../error.js';
import { FdMapper } from '../fd.js';
import { FusedHandlers } from '../handlers.js';
import { RealFs } from '../realFs.js';
import { VirtualFileHandler } from './virtualFile.js';

/**
 * Use cases:
 * 1. Insert a package.json file into every /lib/ folder
 * 2. Auto lazily compile every .ts file to .js
 */

export type VirtualFsOpts = {
  sourcePath: string,
  mountPath: string
}

// TODO: maybe better?
const INIT_TIME = new Date();

// TODO:
// - let's let VirtualFs only deal with one handler
// - And then we layer VirtualFSs on top of each other (we need to build that anyway)
// - Or, instead, pile up virtual handlers? Though, that might be more of a hassle as we don't have FDs there
export type Handler = 'self' | 'other' | 'other_with_fallback';

type InternalFd = {
  type: 'dir',
  path: string
} | {
  // TODO: this should probably be turned into a class
  type: 'file',
  path: string,
  content: Buffer,
  hasPendingContent: boolean,
  size: number
};


export class VirtualFs implements FusedHandlers {
  #handler: VirtualFileHandler;
  #rootGid: number;
  #rootUid: number;
  #fdMapper = new FdMapper<InternalFd>();
  // TODO: Possibly can be some better abstraction.
  // Only using realfs for getting the absolute path
  #realFs: RealFs;

  constructor(handler: VirtualFileHandler, realFs: RealFs, rootGid: number, rootUid: number) {
    this.#handler = handler;
    this.#rootGid = rootGid;
    this.#rootUid = rootUid;
    this.#realFs = realFs;
  }
  handles = (path: string) => this.#handler.handles(path)

  init = () => { /* Nothing to do */ };

  readdir = (dirPath: string) => this.#handler.listFiles(dirPath);

  getattr = async (path: string) : Promise<Stat> => {
    const ministat = await this.#handler.stat(path);
    switch (ministat.type) {
      case 'folder':
        return {
        mtime: INIT_TIME,
        atime: INIT_TIME,
        ctime: INIT_TIME,
        size: 0,
        // RWX for user | RWX for group | R for other | X for other | Dir
        mode: S_IRWXU | S_IRWXG | S_IROTH | S_IXOTH | S_IFDIR,
        // TODO: instead, should probably inherit from parent
        uid: this.#rootUid,
        gid: this.#rootGid,
      }
      case 'file':
        // Note that we keep "other" to be readonly
        const execMode = ministat.executable
          ? S_IXUSR | S_IXGRP
          : 0;
        const writeMode = ministat.writeable
          ? S_IWUSR | S_IWGRP
          : 0;
        const readMode = S_IRUSR | S_IRGRP | S_IROTH;
        return {
          mtime: ministat.modificationTime,
          atime: ministat.modificationTime,
          ctime: INIT_TIME,
          size: ministat.size,
          mode: execMode | writeMode | readMode | S_IFREG,
          // TODO: instead, should probably inherit from parent
          uid: this.#rootUid,
          gid: this.#rootUid,
        }
      default:
        unreachable(ministat);
    }
  };

  fgetattr = (path: string, fd: number) : Awaitable<Stat> => {
    return this.getattr(path);
  };
  flush = (path: string, fd: number) : Awaitable<void> => {
    const file = this.#getFile(fd);
    if (file.hasPendingContent) {
      this.#handler.writeFile(file.path, file.content.subarray(0, file.size));
    }
    /* Nothing to do */
  };
  fsync = (a: string, b: number, c: boolean) : Awaitable<void> => {
    // TODO
    return todo("fsync");
  };
  truncate = async (path: string, size: number) : Promise<void> => {
    if (size === 0) {
      this.#handler.writeFile(path, Buffer.alloc(0));
    } else {
      const original = await this.#handler.readFile(path);
      const newBuf = Buffer.alloc(size);
      if (typeof original === 'string') {
        newBuf.write(original);
      } else {
        original.copy(newBuf);
      }
      // TODO: this is broken. It should have a writeFile
      // First need test.
    }
  };
  ftruncate = (path: string, fd: number, size: number) : Awaitable<void> => {
    const file = this.#getFile(fd);
    file.size = Math.min(file.size, size);
    file.hasPendingContent = true;
  };
  readlink = (a: string) : Awaitable<string> => {
    // TODO
    return todo("readlink");
  };
  chown = (a: string, b: number, c: number) : Awaitable<void> => {
    // TODO
    return todo("chown");
  };
  chmod = (a: string, b: number) : Awaitable<void> => {
    // TODO
    return todo("chmod");
  };
  mknod = (a: string, b: number, c: string) : Awaitable<void> => {
    // TODO
    return todo("mknod");
  };
  open = async (path: string, mode: number) => {
    // TODO: how to deal with concurrent r/w access?
    // TODO: respect mode
    // TODO: do we need to respect blocking IO
    const content = await this.#handler.readFile(path);
    const buff: Buffer = typeof content === 'string'
      ? Buffer.from(content)
      : content;

    return this.#fdMapper.insert({ type: 'file', path, content: buff, hasPendingContent: false, size: buff.length });
  }
  opendir = (path: string, flags: number) => this.#fdMapper.insert({ type: 'dir', path });
  release = (path: string, fd: number) => this.#fdMapper.clear(fd);
  releasedir = (path: string, fd: number) => this.#fdMapper.clear(fd);
  utimens = (a: string, b: number, c: number) : Awaitable<void> => {
    // TODO
    return todo("utimens");
  };
  unlink = (a: string) : Awaitable<void> => {
    // TODO
    return todo("unlink");
  };
  rename = (a: string, b: string) : Awaitable<void> => {
    // TODO
    return todo("rename");
  };
  symlink = (a: string, b: string) : Awaitable<void> => {
    // TODO
    return todo("symlink");
  };
  link = (a: string, b: string) : Awaitable<void> => {
    // TODO
    return todo("link");
  };
  mkdir = async (path: string, mode: number) : Promise<void> => {
    await mkdir(this.#realFs.getAbsolutePath(path), { recursive: true, mode });
  };
  rmdir = (a: string) : Awaitable<void> => {
    throw new IOError(Fuse.EPERM, "Cannot remove virtual directory");
  };
  write = (path: string, fd: number, buffer: Buffer, length: number, position: number): Awaitable<number> => {
    const file = this.#getFile(fd);

    const neededBufferSize = position+length;
    if (file.content.length < neededBufferSize) {
      file.content = this.#resizeBuffer(file.content, neededBufferSize, length);
    }

    file.size = Math.max(file.size, neededBufferSize);
    file.hasPendingContent = true;
    return buffer.copy(file.content, position, 0, length);
  }
  read = (path: string, fd: number, buffer: Buffer, length: number, position: number): Awaitable<number> => {
    // TODO
    const file = this.#getFile(fd);

    return file.content.copy(buffer, 0, position, position + length);
  }

  #getFile(fd: number) {
    const file = this.#fdMapper.get(fd);
    if (!file) {
      throw new IOError(Fuse.EBADF, "Unknown file descriptor");
    }
    if (file.type !== 'file') {
      throw new IOError(Fuse.EISDIR, "Expected a file, but received a dir");
    }
    return file;
  }

  #resizeBuffer(buf: Buffer, desiredSize: number, chunkSize: number): Buffer {
    const newSize = Math.max(desiredSize, buf.length * 2);
    const newBuf = Buffer.alloc(newSize);
    buf.copy(newBuf, 0, 0, buf.length);
    return newBuf;
  }
}
