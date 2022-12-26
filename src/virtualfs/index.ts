export { InMemoryFileHandler } from './inMemoryFileHandler.js';
export { VirtualFileHandler } from './virtualFile.js';

import Fuse, { Stat } from 'fuse-native';
import { S_IFDIR, S_IFREG, S_IRGRP, S_IROTH, S_IRUSR, S_IRWXG, S_IRWXU, S_IWGRP, S_IWUSR, S_IXGRP, S_IXOTH, S_IXUSR } from 'node:constants';
import { todo, unreachable } from '../assert.js';
import { Awaitable } from '../awaitable.js';
import { FusedHandlers } from '../handlers.js';
import { RealFs } from '../realFs.js';
import { VirtualFileHandler } from './virtualFile.js';

// TODO
// I should tackle this differently. I should:
// 1. Make a promise-based interface for all the handler methods
// 2. Implement this interface twice:
//    i. with real file backing
//    ii. with virtual file backing
// 3. Implement this interface a third time, delegating to ^. Prio should go to overlay.
//    - Keep in mind that we should be careful to only implement those methods for which BOTH
//      delegates have support.

/**
 * Use cases:
 * 1. Insert a package.json file into every /lib/ folder
 * 2. Auto lazily compile every .ts file to .js
 */

export type VirtualFsOpts = {
  sourcePath: string,
  mountPath: string
}

export class IOError extends Error {
  constructor(public errno: number, msg: string) {
    super(msg);
  }
}

// TODO: maybe better?
const INIT_TIME = new Date();

// TODO: maybe I'm going about this the wrong way.
// Instead of merging 2 independent file systems, we can make VirtualFS actually aware of RealFS.
// That means that VirtualFS would be the only etry point, and it's up to VirtualFS to delegate to RealFS when needed
export class VirtualFs implements FusedHandlers {
  #handlers: VirtualFileHandler[] = [];
  #realFs: RealFs;
  #rootGid: number;
  #rootUid: number;

  static init = async (realFs: RealFs): Promise<VirtualFs> => {
    const { uid, gid } = await realFs.getattr('/');
    return new VirtualFs(realFs, gid, uid);
  }

  private constructor(realFs: RealFs, rootGid: number, rootUid: number) {
    this.#realFs = realFs;
    this.#rootGid = rootGid;
    this.#rootUid = rootUid;
  }
  registerHandler(handler: VirtualFileHandler) {
    this.#handlers.push(handler);
  }

  #all = <R>(f: (h: VirtualFileHandler) => Awaitable<R>): Promise<R[]> => {
    return Promise.all(this.#handlers.map(f));
  }

  #first = async <R>(m: (h: VirtualFileHandler) => Awaitable<R | undefined>): Promise<R | undefined> => {
    for (const h of this.#handlers) {
      const res = await m(h);
      if (res !== undefined) {
        return res;
      }
    }
    return undefined;
  }

  init = () => { this.#realFs.init(); /* Nothing to init ourselves */ };
  readdir = async (dirPath: string) => {
    const realFiles = this.#realFs.readdir(dirPath);
    const fileSets = await this.#all(async (handler) => {
      // TODO: do we need to stat here?
      const ministat = await handler.stat(dirPath);
      if (ministat && ministat.type === 'file') {
          throw new IOError(Fuse.ENOTDIR, `${dirPath} is registered as a file`);
      }
      if (await handler.handlesFolder(dirPath)) {
        return await handler.listFiles(dirPath);
      }
      return [];
    });

    return fileSets.reduce((a, b) => { a.push(...b); return a }, await realFiles);
  }

  getattr = async (path: string) : Promise<Stat> => {
    // TODO: we can probably still do this delegation from a higher level, using .handles.
    // Or alternatively, some slightly different interface
    // Possibly the virtualfs could implement a Result | undefined kind of thing.
    // Let's see.
    const ministat = await this.#first(h => h.stat(path));
    if (!ministat) {
      return this.#realFs.getattr(path);
    }
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
        const writeMode = ministat.executable
          ? S_IWUSR | S_IWGRP
          : 0;
        const readMode = S_IRUSR | S_IRGRP | S_IROTH;
        return {
          mtime: ministat.modificationTime,
          atime: ministat.modificationTime,
          ctime: INIT_TIME,
          size: ministat.size,
          // TODO: do we need to handle char vs block
          mode: execMode | writeMode | readMode | S_IFREG,
          // TODO: instead, should probably inherit from parent
          uid: this.#rootUid,
          gid: this.#rootUid,
        }
      default:
        unreachable(ministat);
    }
  };
  fgetattr = (a: string, b: number) : Awaitable<Stat> => {
    // TODO:
    return this.#realFs.fgetattr(a, b);
  };
  flush = (a: string, b: number) : Awaitable<void> => {
    // TODO:
    return this.#realFs.flush(a, b);
  };
  fsync = (a: string, b: number, c: boolean) : Awaitable<void> => {
    // TODO
    return this.#realFs.fsync(a, b, c);
  };
  truncate = (a: string, b: number) : Awaitable<void> => {
    // TODO
    return this.#realFs.truncate(a, b);
  };
  ftruncate = (a: string, b: number, c: number) : Awaitable<void> => {
    // TODO
    return this.#realFs.ftruncate(a, b, c);
  };
  readlink = (a: string) : Awaitable<string> => {
    // TODO
    return this.#realFs.readlink(a);
  };
  chown = (a: string, b: number, c: number) : Awaitable<void> => {
    // TODO
    return this.#realFs.chown(a, b, c);
  };
  chmod = (a: string, b: number) : Awaitable<void> => {
    // TODO
    return this.#realFs.chmod(a, b);
  };
  mknod = (a: string, b: number, c: string) : Awaitable<void> => {
    // TODO
    return this.#realFs.mknod(a, b, c);
  };
  open = (a: string, b: number) : Awaitable<number> => {
    // TODO
    return this.#realFs.open(a, b);
  };
  opendir = (a: string, b: number) : Awaitable<number | void> => {
    // TODO
    return this.#realFs.opendir(a, b);
  };
  release = (a: string, b: number) : Awaitable<void> => {
    // TODO
    return this.#realFs.release(a, b);
  };
  releasedir = (a: string, b: number) : Awaitable<void> => {
    // TODO
    return this.#realFs.releasedir(a, b);
  };
  utimens = (a: string, b: number, c: number) : Awaitable<void> => {
    // TODO
    return this.#realFs.utimens(a, b, c);
  };
  unlink = (a: string) : Awaitable<void> => {
    // TODO
    return this.#realFs.unlink(a);
  };
  rename = (a: string, b: string) : Awaitable<void> => {
    // TODO
    return this.#realFs.rename(a, b);
  };
  symlink = (a: string, b: string) : Awaitable<void> => {
    // TODO
    return this.#realFs.symlink(a, b);
  };
  link = (a: string, b: string) : Awaitable<void> => {
    // TODO
    return this.#realFs.link(a, b);
  };
  mkdir = (a: string, b: number) : Awaitable<void> => {
    // TODO
    return this.#realFs.mkdir(a, b);
  };
  rmdir = (a: string) : Awaitable<void> => {
    // TODO
    return this.#realFs.rmdir(a);
  };
  write = (path: string, fd: number, buffer: Buffer, length: number, position: number): Awaitable<number> => {
    // TODO
    return this.#realFs.write(path, fd, buffer, length, position);
  }
  read = (path: string, fd: number, buffer: Buffer, length: number, position: number): Awaitable<number> => {
    // TODO
    return this.#realFs.read(path, fd, buffer, length, position);
  }

  handles = (path: string): Awaitable<boolean> => {
    return this.#handlers.some(handler => handler.handlesFile(path));
  }
}
