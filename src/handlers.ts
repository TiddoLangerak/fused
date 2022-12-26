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

function both<A extends any[], F extends (...args: A) => Awaitable<void>>
(a: F, b: F): ((...args: A) => Promise<void>) {
  return (async (...args: A) => {
    const aRes = a(...args);
    const bRes = b(...args);
    await aRes;
    await bRes;
  });
}

type PathHandlers = Omit<FusedHandlers, 'init'>;

type FdHandlers = ('fgetattr' | 'flush' | 'fsync' | 'fsyncdir' | 'ftruncate' | 'read' | 'write' | 'release' | 'releasedir') & keyof PathHandlers;
type AwaitableFunc<A extends any[], R> = ((...args: A) => Awaitable<R>);

function merge<A extends any[], R, F extends ((...args: A) => Awaitable<R[]>)>(a: F, b: F): (...args: A) => Promise<R[]> {
  return async (...args: A) => {
    const aRes = a(...args);
    const bRes = b(...args);
    return [...(await aRes), ...(await bRes)];
  }
}

export const makeHandlers = (realFs: RealFs, virtualFs: VirtualFs): Partial<Handlers> => {
  return mapHandlers(virtualFs);
  const fdMapper = new FdMapper<[FusedHandlers, Fd]>();

  // TODO: clean up
  function virtualFirst<A extends [string, ...any[]], R>(real: AwaitableFunc<A, R>, virtual: AwaitableFunc<A, R>): AwaitableFunc<A, R> {
    return (async(...args) => {
      const path: string = args[0];
      if (await virtualFs.handles(path)) {
        return await virtual(...args);
      } else {
        return await real(...args);
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
        if (handler === realFs) {
          return real(...args);
        } else {
          return virtual(...args);
        }
      } else {
        return delegate(...args);
      }
    });
  }

  type LinkFunc = (target: string, path: string) => Awaitable<void>;
  function linkVirtualFirst(real: LinkFunc, virtual: LinkFunc): LinkFunc {
    return (target, path) => {
      if (virtualFs.handles(path)) {
        return virtual(target, path);
      } else {
        return real(target, path);
      }
    }
  }

  const mappers: { [K in keyof FusedHandlers]: ((r: RealFs[K], v: VirtualFs[K]) => FusedHandlers[K]) } = {
    init: both,
    readdir: merge,
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
      .map(([ key, val ]) => [key, val(realFs[key], virtualFs[key])])
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




