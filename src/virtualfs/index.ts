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

// TODO:
// - let's let VirtualFs only deal with one handler
// - And then we layer VirtualFSs on top of each other (we need to build that anyway)
export type Handler = 'self' | 'other' | 'other_with_fallback';

// TODO: maybe I'm going about this the wrong way.
// Instead of merging 2 independent file systems, we can make VirtualFS actually aware of RealFS.
// That means that VirtualFS would be the only etry point, and it's up to VirtualFS to delegate to RealFS when needed
export class VirtualFs implements FusedHandlers {
  #handler: VirtualFileHandler;
  #rootGid: number;
  #rootUid: number;

  constructor(handler: VirtualFileHandler, rootGid: number, rootUid: number) {
    this.#handler = handler;
    this.#rootGid = rootGid;
    this.#rootUid = rootUid;
  }
  handles = (path: string) => this.#handler.handles(path)

  init = () => { /* Nothing to do */ };

  readdir = (dirPath: string) => this.#handler.listFiles(dirPath);

  getattr = async (path: string) : Promise<Stat> => {
    // TODO: we can probably still do this delegation from a higher level, using .handles.
    // Or alternatively, some slightly different interface
    // Possibly the virtualfs could implement a Result | undefined kind of thing.
    // Let's see.
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
    return todo("fgetattr");
  };
  flush = (a: string, b: number) : Awaitable<void> => {
    // TODO:
    return todo("flush");
  };
  fsync = (a: string, b: number, c: boolean) : Awaitable<void> => {
    // TODO
    return todo("fsync");
  };
  truncate = (a: string, b: number) : Awaitable<void> => {
    // TODO
    return todo("truncate");
  };
  ftruncate = (a: string, b: number, c: number) : Awaitable<void> => {
    // TODO
    return todo("ftruncate");
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
  open = (path: string, mode: number) : Awaitable<number> => {
    // TODO
    return todo("open");
  };
  opendir = (a: string, b: number) : Awaitable<number | void> => {
    // TODO
    return todo("opendir");
  };
  release = (a: string, b: number) : Awaitable<void> => {
    // TODO
    return todo("release");
  };
  releasedir = (a: string, b: number) : Awaitable<void> => {
    // TODO
    return todo("releasedir");
  };
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
  mkdir = (a: string, b: number) : Awaitable<void> => {
    // TODO
    return todo("mkdir");
  };
  rmdir = (a: string) : Awaitable<void> => {
    // TODO
    return todo("rmdir");
  };
  write = (path: string, fd: number, buffer: Buffer, length: number, position: number): Awaitable<number> => {
    // TODO
    return todo("write");
  }
  read = (path: string, fd: number, buffer: Buffer, length: number, position: number): Awaitable<number> => {
    // TODO
    return todo("read");
  }
}
