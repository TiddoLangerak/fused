export { InMemoryFileHandler } from './inMemoryFileHandler.js';
export { VirtualFileHandler } from './virtualFile.js';

import Fuse, { Stat } from 'fuse-native';
import { S_IFDIR, S_IFREG, S_IRGRP, S_IROTH, S_IRUSR, S_IRWXG, S_IRWXU, S_IWGRP, S_IWUSR, S_IXGRP, S_IXOTH, S_IXUSR } from 'node:constants';
import { mkdir } from 'node:fs/promises';
import { unreachable } from '../assert.js';
import { Awaitable } from '../awaitable.js';
import { IOError } from '../error.js';
import { FdMapper } from '../fd.js';
import { FusedFs } from '../handlers.js';
import { resolver, Resolver } from '../path.js';
import { VirtualFileHandler } from './virtualFile.js';

/**
 * Use cases:
 * 1. Insert a package.json file into every /lib/ folder
 * 2. Auto lazily compile every .ts file to .js
 */

export type VirtualFsOpts = {
  sourcePath: string,
  mountPath: string,
}

const INIT_TIME = new Date();

export type Handler = 'self' | 'other' | 'other_with_fallback';

class FileFd {
  readonly type = 'file';
  readonly path: string;
  #content: Buffer;
  #hasPendingContent: boolean = false;
  #size: number;

  constructor(path: string, content: Buffer, size: number) {
    this.path = path;
    this.#content = content;
    this.#size = size;
  }

  set content(b: Buffer) {
    this.#content = b;
    this.#hasPendingContent = true;
  }

  get content() {
    return this.#content;
  }

  set size(size: number) {
    this.#size = size;
    this.#hasPendingContent = true;
  }

  get size() {
    return this.#size;
  }

  get hasPendingContent() {
    return this.#hasPendingContent;
  }


}

type DirFd = {
  type: 'dir',
  path: string
}

type InternalFd = FileFd | DirFd;

export class VirtualFs implements FusedFs {
  #handler: VirtualFileHandler;
  #rootGid: number;
  #rootUid: number;
  #fdMapper = new FdMapper<InternalFd>();
  #resolver: Resolver;

  constructor(handler: VirtualFileHandler, opts: VirtualFsOpts, rootGid: number, rootUid: number) {
    this.#handler = handler;
    this.#rootGid = rootGid;
    this.#rootUid = rootUid;
    this.#resolver = resolver(opts);
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

  fgetattr = (path: string, _fd: number) : Awaitable<Stat> => {
    return this.getattr(path);
  };
  flush = async (path: string, fd: number) : Promise<void> => {
    await this.fsync(path, fd, false);
  };
  fsync = async (_path: string, fd: number, _datasync: boolean) : Promise<void> => {
    // We ignore the datasync parameter, as it's not really relevant for us.
    // Datasync parameter is just an optimization, not a requirement.
    const file = this.#getFile(fd);
    if (file.hasPendingContent) {
      await this.#handler.writeFile(file.path, file.content.subarray(0, file.size));
    }
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
      this.#handler.writeFile(path, newBuf);
    }
  };
  ftruncate = async (path: string, fd: number, size: number) : Promise<void> => {
    const file = this.#getFile(fd);
    file.size = Math.min(file.size, size);
    // It seems that we're required to flush our changes straight away.
    // Without this, things don't work.
    await this.flush(path, fd);
  };
  readlink = () : Awaitable<string> => {
    throw new IOError(Fuse.ENOSYS, "Virtual files don't support symlink");
  };
  chown = () : Awaitable<void> => {
    throw new IOError(Fuse.EACCES, "Virtual files can't be chown-ed");
  };
  chmod = () : Awaitable<void> => {
    throw new IOError(Fuse.EACCES, "Virtual files can't be chmod-ed");
  };
  mknod = async (path: string, _mode: number, _dev: string) : Promise<void> => {
    // TODO: test
    await this.#handler.writeFile(path, Buffer.alloc(0));
  };
  open = async (path: string, _mode: number) => {
    // No need to check mode, already done by kernel (due to "default_permissions")
    const content = await this.#handler.readFile(path);
    const buff: Buffer = typeof content === 'string'
      ? Buffer.from(content)
      : content;

    return this.#fdMapper.insert(new FileFd(path, buff, buff.length));
  }
  opendir = (path: string, _flags: number) => this.#fdMapper.insert({ type: 'dir', path });
  release = (_path: string, fd: number) => this.#fdMapper.clear(fd);
  releasedir = (_path: string, fd: number) => this.#fdMapper.clear(fd);
  utimens = (path: string, atime: number, mtime: number) : Awaitable<void> => {
    if (this.#handler.updateModificationTime) {
      const modificationTime = new Date(Math.max(atime, mtime));
      this.#handler.updateModificationTime(path, modificationTime);
    }
  };
  unlink = () : Awaitable<void> => {
    throw new IOError(Fuse.EACCES, "Cannot remove virtual file");
  };
  rename = () : Awaitable<void> => {
    // Renaming virtual files is sketchy and risks data loss.
    // E.g. renaming a real file into a virtual file could lose the file.
    // For now, better to just not support renaming.
    throw new IOError(Fuse.ENOSYS, "Cannot rename from/to virtual files");
  };
  symlink = () : Awaitable<void> => {
    throw new IOError(Fuse.ENOSYS, "Virtual files don't support symlink");
  };
  link = () : Awaitable<void> => {
    throw new IOError(Fuse.ENOSYS, "Virtual files don't support links");
  };
  mkdir = async (path: string, mode: number) : Promise<void> => {
    await mkdir(this.#resolver(path), { recursive: true, mode });
  };
  rmdir = () : Awaitable<void> => {
    throw new IOError(Fuse.EPERM, "Cannot remove virtual directory");
  };
  write = async (_path: string, fd: number, buffer: Buffer, length: number, position: number): Promise<number> => {
    const file = this.#getFile(fd);

    const neededBufferSize = position+length;
    if (file.content.length < neededBufferSize) {
      file.content = this.#resizeBuffer(file.content, neededBufferSize);
    }

    file.size = Math.max(file.size, neededBufferSize);
    return buffer.copy(file.content, position, 0, length);
  }
  read = (_path: string, fd: number, buffer: Buffer, length: number, position: number): Awaitable<number> => {
    const file = this.#getFile(fd);
    const endpos = Math.min(position + length, file.content.length);

    return file.content.copy(buffer, 0, position, endpos);
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

  #resizeBuffer(buf: Buffer, desiredSize: number): Buffer {
    const newSize = Math.max(desiredSize, buf.length * 2);
    const newBuf = Buffer.alloc(newSize);
    buf.copy(newBuf, 0, 0, buf.length);
    return newBuf;
  }
}
