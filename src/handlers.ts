/// For whatever reason the reference is needed for the language-server
/// <reference path="../types/fuse-native.d.ts" />
import Fuse, { CB, Handlers, Stat } from "fuse-native";
import { debug } from "./debug.js";
import { Awaitable } from "./awaitable.js";
import { FdMapper } from "./fd.js";
import { Fd, FusedFs, fuseLayers, StandardHandlers } from "./fusedFs.js";
import { VirtualFs } from "./virtualfs/index.js";
import { RealFs } from "./realFs.js";
export { Stat };

export const makeHandlers = (realFs: RealFs, overlays: VirtualFs[]): Partial<Handlers> => {
  const fdMapper = new FdMapper<[FusedFs, Fd]>();

  const fused = overlays
    .reduce((base: FusedFs, overlay) => fuseLayers(base, overlay, fdMapper), realFs);

  return mapHandlers(fused);
};

const standardHandlers: StandardHandlers[] = [
    'init',
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

function mapHandlers(f: FusedFs): Partial<Handlers> {
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

function fusedHandlerToNativeHandler<K extends keyof Handlers & keyof FusedFs>(h: Partial<Handlers>, f: FusedFs, k: K) {
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
  debug("Error", e);
  if (e.errno) {
    return e.errno;
  } else {
    console.error("Unexpected error", e);
    return Fuse.EIO;
  }
}


