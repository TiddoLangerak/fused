import Fuse, { CB } from 'fuse-native';
import * as fs from 'node:fs/promises';
import { FileHandle } from 'node:fs/promises';
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

const openFiles: Map<number, FileHandle> = new Map();

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
    open: (path, flags, cb) => {
      $(cb, async() => {
        console.log("open called");
        const handle = await fs.open(getAbsolutePath(path), flags);
        openFiles.set(handle.fd, handle);
        cb(0, handle.fd);
      });
    },
    read: (path, fd, buffer, length, position, cb) => {
      (async() => {
        try {
          const file = openFiles.get(fd);
          if (file) {
            const { bytesRead } = await file.read(buffer, 0, length, position);
            cb(bytesRead);
          } else {
            cb(0);
          }
        } catch (e) {
          console.error("Read error", e);
          cb(0);
        }
      })();
      // TODO
    },
    release: (path, fd, cb) => {
      console.log("Release");
      $(cb, async () => {
        const file = openFiles.get(fd);
        openFiles.delete(fd);
        if (file) {
          await file.close()
        }
        cb(0);
      });
    }
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
