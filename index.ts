import Fuse, { CB } from 'fuse-native';
import * as fs from 'node:fs/promises';
import { resolve } from 'node:path';

const mountPath = resolve("./mnt");
const sourcePath = resolve("./example");

function getAbsolutePath(pathSegment: string): string {
  const path = resolve(sourcePath, `./${pathSegment}`);
  if (!path.startsWith(sourcePath)) {
    throw new Error("Couldn't construct path: path is not a subpath of source");
  }
  if (path.startsWith(mountPath)) {
    throw new Error("Recursive mounting. Not good");
  }
  return path;
}

function handleError(e: any): number {
  if (e.errno) {
    return e.errno;
  } else {
    console.error("Unexpected error", e);
    return Fuse.ENOENT; // TODO
  }
}

function $<T>(cb: CB<T>, fn: () => Promise<unknown>) {
  (async() => {
    try {
      await fn();
    } catch (e) {
      cb(handleError(e));
    }
  })();
}

const fuse = new Fuse(mountPath,
  {
    readdir: (path, cb) => {
      $(cb, async() => {
        const files = await fs.readdir(getAbsolutePath(path));
        cb(0, files);
      });
    },
    getattr: (path, cb) => {
      $(cb, async() => {
        const stat = await fs.stat(getAbsolutePath(path));
        cb(0, stat);
      });
    },
  },
  { force: true, mkdir: true, autoUnmount: true });

fuse.mount(err => {
  console.log("Err?", err);
  if (err) {
    console.error("Couldn't mount", err);
    process.exit(-1);
  }
});

process.on('SIGINT', (code) => {
  // TODO: clean this up
  Fuse.unmount(mountPath, (err) => {
    if(err) {
      process.exit(-1);
    }
    process.exit(0);
  });
});
