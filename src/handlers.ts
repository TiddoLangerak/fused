/// For whatever reason the reference is needed for the language-server
/// <reference path="../types/fuse-native.d.ts" />
import Fuse, { CB, Handlers, Stat } from "fuse-native";
import { debug } from "./debug.js";
import { FusedFs } from "./fusedFs.js";
import { ProgramOpts } from "./opts.js";
import { resolver } from './path.js';
import { VirtualFs } from "./virtualfs/index.js";
import * as fs from 'node:fs/promises';
import { Awaitable } from "./awaitable.js";
export { Stat };

// TODO clean up some

function handleError(e: any): number {
  if (e.errno) {
    return e.errno;
  } else {
    console.error("Unexpected error", e);
    // When in doubt, file not found
    return Fuse.ENOENT; // TODO
  }
}

// Handles mapping a promise-returning function to a c-style cb.
function $<T>(cb: CB<T>, fn: () => Awaitable<T>) {
  (async() => {
    try {
      const res = await fn();
      cb(0, res);
    } catch (e) {
      cb(handleError(e));
    }
  })();
}


type ToAwaitable<F> = F extends (cb: CB<infer R>) => void
? () => Awaitable<R>
: F extends (a: infer A, cb: CB<infer R>) => void
? (a: A) => Awaitable<R>
: F extends (a: infer A, b: infer B, cb: CB<infer R>) => void
? (a: A, b: B) => Awaitable<R>
: F extends (a: infer A, b: infer B, c: infer C, cb: CB<infer R>) => void
? (a: A, b: B, c: C) => Awaitable<R>
: never;

// Read and write have a different signature
type StandardHandlers = Exclude<keyof Handlers, 'read' | 'write'>;

export type FusedHandlers = {
  [k in StandardHandlers]: ToAwaitable<Handlers[k]>;
} & {
  write(path: string, fd: number, buffer: Buffer, length: number, position: number): Awaitable<number>;
  read(path: string, fd: number, buffer: Buffer, length: number, position: number): Awaitable<number>;
}

function fusedHandlerToNativeHandler<K extends StandardHandlers>(h: Partial<Handlers>, f: Partial<FusedHandlers>, k: K) {
  const func : Function | undefined = f[k];
  if (func) {
    // Sorry, can't type it, need to do some funky stuff.
    // Essentially we're just passing the args on, except for the cb
    h[k] = (...args: any[]) => {
      const cb = args.pop();
      debug(k, ...args);
      $(cb, () => func!.apply(f, args));
    };
  }
}

const standardHandlers: StandardHandlers[] = [
    'init',
    'access',
    'getattr',
    'fgetattr',
    'flush',
    'fsync',
    'fsyncdir',
    'readdir',
    'truncate',
    'ftruncate',
    'readlink',
    'chown',
    'chmod',
    'mknod',
    'open',
    'opendir',
    'release',
    'releasedir',
    'create',
    'utimens',
    'unlink',
    'rename',
    'symlink',
    'link',
    'mkdir',
    'rmdir',
];

function mapHandlers(f: Partial<FusedHandlers>): Partial<Handlers> {
  const handlers: Partial<Handlers> = {
    init(cb) {
      debug("init");
      cb(0);
    }
  };

  // TODO: maybe interject debug here? And move it out of elsewhere?
  standardHandlers.forEach(method => fusedHandlerToNativeHandler(handlers, f, method));
  if (f.read) {
    // !!! read cb doesn't take an error
    handlers.read = async (path, fd, buffer, length, position, cb) => {
      debug('read');
      try {
        const bytesRead = await f.read!(path, fd, buffer, length, position);
        cb(bytesRead);
      } catch (e) {
        console.error("Read failed", e);
        cb(0);
      }
    }
  }

  if (f.write) {
    // !!! write cb doesn't take an error
    handlers.write = async (path, fd, buffer, length, position, cb) => {
      debug('write');
      try {
        const bytesWritten = await f.write!(path, fd, buffer, length, position);
        cb(bytesWritten);
      } catch (e) {
        console.error("Write failed", e);
        cb(0);
      }
    }
  }

  return handlers;
}


export const makeHandlers = (opts: ProgramOpts, virtualFs: VirtualFs): Partial<Handlers> => {
  const getAbsolutePath = resolver(opts);
  const fusedFs = new FusedFs(opts);
  return mapHandlers(fusedFs);
};
