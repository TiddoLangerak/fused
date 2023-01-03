import { CB, Handlers } from "fuse-native";
import { dirname } from "path";
import { Awaitable, AwaitableFunc } from "./awaitable.js";
import { isEnoent } from "./error.js";
import { FdMapper } from "./fd.js";

export type Fd = number;

// - we don't support access, because we rely on defaultPermissions. See: https://libfuse.github.io/doxygen/structfuse__operations.html#a2248db35e200265f7fb9a18348229858
// - We don't support "create" because we don't have to, and can't do anything particular clever there.
// - We don't support fsyncdir because we have nothing to sync
// - We don't support xattr cause it's osx only
type UnsupportedOperations = 'access' | 'create' | 'fsyncdir' | 'setxattr' | 'getxattr' | 'listxattr' | 'removexattr';
type SupportedOperations = Exclude<keyof Handlers, UnsupportedOperations>;
// Read and write have a different signature, so we treat them slightly differently
export type StandardHandlers = Exclude<SupportedOperations, 'read' | 'write'>;

export type Handles = 'self' | 'other' | 'other_with_fallback';
export type FusedFs = {
  [k in StandardHandlers]: ToAwaitable<Handlers[k]>;
} & {
  write(path: string, fd: number, buffer: Buffer, length: number, position: number): Awaitable<number>;
  read(path: string, fd: number, buffer: Buffer, length: number, position: number): Awaitable<number>;
  handles(path: string): Awaitable<Handles>
}
type Readdir = (path: string) => Awaitable<string[]>;


export const fuseLayers = (baseFs: FusedFs, overlayFs: FusedFs, fdMapper: FdMapper<[FusedFs, Fd]>): FusedFs => {
  function init(): (() => Promise<void>) {
    return async () => { await Promise.all([ baseFs.init(), overlayFs.init() ]); }
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
      switch (await overlayFs.handles(path)) {
        case 'self':
          return await overlayFs.readdir(path);
        case 'other':
          return await baseFs.readdir(path);
        case 'other_with_fallback':
          // We want to ignore at most 1 enoent.
          // If both enoent, then we abort
          const vRes = overlayFs.readdir(path);
          try {
            const rRes = await baseFs.readdir(path);
            return [...rRes, ...(await ignoreEnoent(vRes))];
          } catch (e) {
            return await vRes;
          }
      }
    }
  }
  // TODO: clean up
  function overlayFirst<A extends [string, ...any[]], R>(baseFn: AwaitableFunc<A, R>, overlayFn: AwaitableFunc<A, R>): AwaitableFunc<A, R> {
    return (async(...args) => {
      const path: string = args[0];
      switch (await overlayFs.handles(path)) {
        case 'self':
          return await overlayFn(...args);
        case 'other':
          return await baseFn(...args);
        case 'other_with_fallback':
          return await baseWithFallback(baseFn, overlayFn, args);
      }
    });
  }

  function fromFd<A extends [string, number, ...any[]], R>(baseFn: AwaitableFunc<A, R>, overlayFn: AwaitableFunc<A, R>): AwaitableFunc<A, R> {
    const delegate = overlayFirst(baseFn, overlayFn);
    return ((...args) => {
      const [path, fd, ...rest] = args;
      const downstream = fdMapper.get(fd);
      if (downstream) {
        const [handler, mappedFd] = downstream;
        // TODO: not the nicest... perhaps we could improve?
        const mappedArgs: A = [path, mappedFd, ...rest] as A;
        if (handler === baseFs) {
          return baseFn(...mappedArgs);
        } else {
          return overlayFn(...mappedArgs);
        }
      } else {
        return delegate(...args);
      }
    });
  }

  type LinkFunc = (target: string, path: string) => Awaitable<void>;
  function linkOverlayFirst(baseFn: LinkFunc, overlayFn: LinkFunc): LinkFunc {
    return async (target, path) => {
      switch (await overlayFs.handles(path)) {
        case 'self':
          return overlayFn(target, path);
        case 'other':
          return baseFn(target, path);
        case 'other_with_fallback':
          return baseWithFallback(baseFn, overlayFn, [target, path]);
      }
    }
  }

  const mappers: { [K in keyof FusedFs]: ((baseFn: FusedFs[K], overlayFn: FusedFs[K]) => FusedFs[K]) } = {
    init: init,
    readdir: readdir,
    getattr: overlayFirst,
    fgetattr: fromFd,
    flush: fromFd,
    fsync: fromFd,
    chown: overlayFirst,
    chmod: overlayFirst,
    mknod: overlayFirst,
    open: overlayFirst,
    opendir: overlayFirst,
    read: fromFd,
    write: fromFd,
    release: fromFd,
    releasedir: fromFd,
    utimens: overlayFirst,
    unlink: overlayFirst,
    rename: (baseRename, overlayRename) => async (from: string, to: string) => {
      const fromHandles = await overlayFs.handles(from);
      const toHandles = await overlayFs.handles(to);
      if (fromHandles === 'self' || toHandles === 'self') {
        return await overlayRename(from, to);
      }
      if (fromHandles === 'other_with_fallback' || toHandles === 'other_with_fallback') {
        return await baseWithFallback(baseRename, overlayRename, [from, to]);
      }
      return await baseRename(from, to);
    },
    mkdir: (baseMkdir, overlayMkdir) => async (path: string, mode: number) => {
      // TODO: refactor this into something nice?
      const parent = dirname(path);
      switch (await overlayFs.handles(parent)) {
        case 'self':
          return await overlayMkdir(path, mode);
        case 'other':
          return await baseMkdir(path, mode);
        case 'other_with_fallback':
          return await baseWithFallback(baseMkdir, overlayMkdir, [path, mode]);
      }
    },
    rmdir: overlayFirst,
    truncate: overlayFirst,
    ftruncate: fromFd,
    readlink: overlayFirst,
    symlink: linkOverlayFirst,
    link: linkOverlayFirst,
    handles: (baseHandles, overlayHandles) => async (path:string) => {
      switch (await overlayHandles(path)) {
        case 'self':
          return 'self';
        case 'other':
          return await baseHandles(path);
        case 'other_with_fallback':
          const base = await baseHandles(path);
          if (base === 'other') {
            return 'other_with_fallback';
          }
          return base;
      }
    }
  };

  const combinedFs: FusedFs = Object.fromEntries(
    Object.entries(mappers)
      // TODO: better typing
      .map(([ key, val ]) => [key, val((baseFs as any)[key], (overlayFs as any)[key])])
  ) as FusedFs;

  return combinedFs;
}

async function baseWithFallback<A extends any[], R>(base: AwaitableFunc<A, R>, overlay: AwaitableFunc<A, R>, args: A): Promise<R> {
  try {
    return await base(...args);
  } catch (e) {
    if (isEnoent(e)) {
      return await overlay(...args);
    }
    throw e;
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

