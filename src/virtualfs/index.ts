export { InMemoryFileHandler } from './inMemoryFileHandler.js';
export { VirtualFileHandler } from './virtualFile.js';

import { Stat } from 'fuse-native';
import { todo } from '../assert.js';
import { Awaitable } from '../awaitable.js';
import { FusedHandlers } from '../handlers.js';
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

export class VirtualFs implements FusedHandlers {
  #handlers: VirtualFileHandler[] = [];
  registerHandler(handler: VirtualFileHandler) {
    this.#handlers.push(handler);
  }

  init = () => { /* Nothing to do */ };
  readdir = async (dirPath: string) => {
    // TODO: fancy functional interface
    const res: string[] = [];
    for (const handler of this.#handlers) {
      if (await handler.handles(dirPath)) {
        res.push(...await handler.listFiles(dirPath));
      }
    }
    return res;
  }

  getattr = (a: string) : Awaitable<Stat> => {
    todo("getattr");
  };
  fgetattr = (a: string, b: number) : Awaitable<Stat> => {
    todo("fgetattr");
  };
  flush = (a: string, b: number) : Awaitable<void> => {
    todo("flush");
  };
  fsync = (a: string, b: number, c: boolean) : Awaitable<void> => {
    todo("fsync");
  };
  truncate = (a: string, b: number) : Awaitable<void> => {
    todo("truncate");
  };
  ftruncate = (a: string, b: number, c: number) : Awaitable<void> => {
    todo("ftruncate");
  };
  readlink = (a: string) : Awaitable<string> => {
    todo("readlink");
  };
  chown = (a: string, b: number, c: number) : Awaitable<void> => {
    todo("chown");
  };
  chmod = (a: string, b: number) : Awaitable<void> => {
    todo("chmod");
  };
  mknod = (a: string, b: number, c: string) : Awaitable<void> => {
    todo("mknod");
  };
  open = (a: string, b: number) : Awaitable<number> => {
    todo("open");
  };
  opendir = (a: string, b: number) : Awaitable<number | void> => {
    todo("opendir");
  };
  release = (a: string, b: number) : Awaitable<void> => {
    todo("release");
  };
  releasedir = (a: string, b: number) : Awaitable<void> => {
    todo("releasedir");
  };
  utimens = (a: string, b: number, c: number) : Awaitable<void> => {
    todo("utimens");
  };
  unlink = (a: string) : Awaitable<void> => {
    todo("unlink");
  };
  rename = (a: string, b: string) : Awaitable<void> => {
    todo("rename");
  };
  symlink = (a: string, b: string) : Awaitable<void> => {
    todo("symlink");
  };
  link = (a: string, b: string) : Awaitable<void> => {
    todo("link");
  };
  mkdir = (a: string, b: number) : Awaitable<void> => {
    todo("mkdir");
  };
  rmdir = (a: string) : Awaitable<void> => {
    todo("rmdir");
  };
  write = (path: string, fd: number, buffer: Buffer, length: number, position: number): Awaitable<number> => {
    todo("write");
  }
  read = (path: string, fd: number, buffer: Buffer, length: number, position: number): Awaitable<number> => {
    todo("read");
  }

  handles = (path: string): Awaitable<boolean> => {
    todo("Handles");
  }
}
