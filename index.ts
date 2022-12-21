import Fuse from 'fuse-native';
import * as fs from 'node:fs/promises';
import { resolve } from 'node:path';

const mountPath = resolve("./mnt");
const sourcePath = resolve("./example");
console.log(mountPath);

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

const fuse = new Fuse(mountPath,
  {
    readdir: (path, cb) => {
      (async () => {
        try {
          const files = await fs.readdir(getAbsolutePath(path));
          console.log("Calling cb");
          cb(0, files);
        } catch (e) {
          console.log("err", e);
          throw new Error("TODO");
        }
      })();
    }
  },
  { force: true, mkdir: true, autoUnmount: true });

fuse.mount(err => {
  console.log("Err?", err);
  console.log(Fuse.ENOENT);
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
