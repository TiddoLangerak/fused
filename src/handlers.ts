/// For whatever reason the reference is needed for the language-server
/// <reference path="../types/fuse-native.d.ts" />
import Fuse, { CB, Handlers, Stat } from "fuse-native";
import { debug } from "./debug.js";
import { Awaitable } from "./awaitable.js";
import { FdMapper } from "./fd.js";
import { VirtualFs } from "./virtualfs/index.js";
import { RealFs } from "./realFs.js";
export { Stat };
export type Fd = number;

type AwaitableFunc<A extends any[], R> = ((...args: A) => Awaitable<R>);

type Readdir = (path: string) => Awaitable<string[]>;

function isEnoent(e: unknown): boolean {
  return typeof e === 'object' && !!e && (e as any).errno === Fuse.ENOENT;
}

async function realWithFallback<A extends any[], R>(real: AwaitableFunc<A, R>, virtual: AwaitableFunc<A, R>, args: A): Promise<R> {
  try {
    return await real(...args);
  } catch (e) {
    if (isEnoent(e)) {
      return await virtual(...args);
    }
    throw e;
  }
}

export const makeHandlers = (realFs: RealFs, virtualFs: VirtualFs): Partial<Handlers> => {
  //return mapHandlers(virtualFs);
  const fdMapper = new FdMapper<[FusedHandlers, Fd]>();

function init(): (() => Promise<void>) {
  return async () => { await Promise.all([ realFs.init(), virtualFs.init() ]); }
}


  function readdir(): Readdir {
    async function ignoreEnoent(p: Awaitable<string[]>): Promise<string[]> {
      try {
        return await p;
      } catch (e) {
        if (isEnoent(e)) {
          return [];
        }
        throw e;
      }
    }
    return async (path: string): Promise<string[]> => {
      switch (await virtualFs.handles(path)) {
        case 'self':
          return await virtualFs.readdir(path);
        case 'other':
          return await realFs.readdir(path);
        case 'other_with_fallback':
          // We want to ignore at most 1 enoent.
          // If both enoent, then we abort
          const vRes = virtualFs.readdir(path);
          try {
            const rRes = await realFs.readdir(path);
            return [...rRes, ...(await ignoreEnoent(vRes))];
          } catch (e) {
            return await vRes;
          }
      }
    }
  }
  // TODO: clean up
  function virtualFirst<A extends [string, ...any[]], R>(real: AwaitableFunc<A, R>, virtual: AwaitableFunc<A, R>): AwaitableFunc<A, R> {
    return (async(...args) => {
      const path: string = args[0];
      switch (await virtualFs.handles(path)) {
        case 'self':
          return await virtual(...args);
        case 'other':
          return await real(...args);
        case 'other_with_fallback':
          return await realWithFallback(real, virtual, args);
      }
    });
  }

  function fromFd<A extends [string, number, ...any[]], R>(real: AwaitableFunc<A, R>, virtual: AwaitableFunc<A, R>): AwaitableFunc<A, R> {
    const delegate = virtualFirst(real, virtual);
    return ((...args) => {
      const [path, fd, ...rest] = args;
      const downstream = fdMapper.get(fd);
      if (downstream) {
        const [handler, mappedFd] = downstream;
        // TODO: not the nicest... perhaps we could improve?
        const mappedArgs: A = [path, mappedFd, ...rest] as A;
        if (handler === realFs) {
          return real(...mappedArgs);
        } else {
          return virtual(...mappedArgs);
        }
      } else {
        return delegate(...args);
      }
    });
  }

  type LinkFunc = (target: string, path: string) => Awaitable<void>;
  function linkVirtualFirst(real: LinkFunc, virtual: LinkFunc): LinkFunc {
    return async (target, path) => {
      switch (await virtualFs.handles(path)) {
        case 'self':
          return virtual(target, path);
        case 'other':
          return real(target, path);
        case 'other_with_fallback':
          return realWithFallback(real, virtual, [target, path]);
      }
    }
  }

  const mappers: { [K in keyof FusedHandlers]: ((r: RealFs[K], v: VirtualFs[K]) => FusedHandlers[K]) } = {
    init: init,
    readdir: readdir,
    getattr: virtualFirst,
    fgetattr: fromFd,
    flush: fromFd,
    fsync: fromFd,
    chown: virtualFirst,
    chmod: virtualFirst,
    mknod: virtualFirst,
    open: virtualFirst,
    opendir: virtualFirst,
    read: fromFd,
    write: fromFd,
    release: fromFd,
    releasedir: fromFd,
    utimens: virtualFirst,
    unlink: virtualFirst,
    rename: virtualFirst,
    mkdir: virtualFirst,
    rmdir: virtualFirst,
    truncate: virtualFirst,
    ftruncate: fromFd,
    readlink: virtualFirst,
    symlink: linkVirtualFirst,
    link: linkVirtualFirst,
  };

  const combinedFs: FusedHandlers = Object.fromEntries(
    Object.entries(mappers)
      // TODO: better typing
      .map(([ key, val ]) => [key, val((realFs as any)[key], (virtualFs as any)[key])])
  ) as FusedHandlers;

  return mapHandlers(combinedFs);
};

type SupportedOperations = Exclude<keyof Handlers, 'access' | 'create' | 'fsyncdir' | 'setxattr' | 'getxattr' | 'listxattr' | 'removexattr'>;
// Read and write have a different signature
type StandardHandlers = Exclude<SupportedOperations, 'read' | 'write'>;
const standardHandlers: StandardHandlers[] = [
    'init',
    //'access', // TODO: we don't support access, because we rely on defaultPermissions. See: https://libfuse.github.io/doxygen/structfuse__operations.html#a2248db35e200265f7fb9a18348229858
    'getattr',
    'fgetattr',
    'flush',
    'fsync',
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
    'utimens',
    'unlink',
    'rename',
    'symlink',
    'link',
    'mkdir',
    'rmdir',
];

function mapHandlers(f: FusedHandlers): Partial<Handlers> {
  const handlers: Partial<Handlers> = {};

  standardHandlers.forEach(method => fusedHandlerToNativeHandler(handlers, f, method));

  // Read and write are odd ones out, as they don't take a success parameter.
  // We therefore implement them separately.
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

function fusedHandlerToNativeHandler<K extends keyof FusedHandlers>(h: Partial<Handlers>, f: FusedHandlers, k: K) {
  const fusedHandler = f[k];
  if (fusedHandler) {
    // Sorry, can't type it, need to do some funky stuff.
    // Essentially we're just passing the args on, except for the cb
    h[k] = (...args: any[]) => {
      const cb = args.pop();
      debug(k, ...args);
      // TODO: get rid of any
      $(cb, () => (fusedHandler as any)(...args));
    };
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

function handleError(e: any): number {
  if (e.errno) {
    return e.errno;
  } else {
    console.error("Unexpected error", e);
    // When in doubt, file not found
    return Fuse.ENOENT; // TODO
  }
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


export type FusedHandlers = {
  [k in StandardHandlers]: ToAwaitable<Handlers[k]>;
} & {
  write(path: string, fd: number, buffer: Buffer, length: number, position: number): Awaitable<number>;
  read(path: string, fd: number, buffer: Buffer, length: number, position: number): Awaitable<number>;
}




