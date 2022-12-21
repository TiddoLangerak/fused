import Fuse, { CB, Handlers } from 'fuse-native';
import { Dir } from 'node:fs';
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

async function openFile(path: string, flags: number | string) {
    const handle = await fs.open(getAbsolutePath(path), flags);
    openFiles.set(handle.fd, handle);
    return handle.fd;
}

function handleError(e: any): number {
  if (e.errno) {
    return e.errno;
  } else {
    console.error("Unexpected error", e);
    return Fuse.ENOENT; // TODO
  }
}

function $<T>(cb: CB<T>, fn: () => Promise<T>) {
  (async() => {
    try {
      const res = await fn();
      cb(0, res);
    } catch (e) {
      cb(handleError(e));
    }
  })();
}

const openFiles: Map<number, FileHandle> = new Map();
// TODO: figure out if we need to do something with open dirs. Seems like we don't have fds from them in node.

let dirFdCount = 1;
const openDirs: Map<number, Dir> = new Map();

const handlers: Partial<Handlers> = {
  init: (cb) => {
    cb(0);
  },
  access: (path, mode, cb) => {
    // TODO: do we need to do something here?
    cb(0);
  },
  // statfs(). Doesn't have a node equivalent
  getattr: (path, cb) => {
    $(cb,  () =>  fs.lstat(getAbsolutePath(path)));
  },
  fgetattr: (path, fd, cb) => {
    $(cb, async() => {
      const file = openFiles.get(fd);
      if (file) {
        return await file.stat();
      } else {
        return await fs.stat(getAbsolutePath(path));
      }
    });
  },
  flush(path, fd, cb) {
    // We need to flush uncommitted data to the OS here (not necessarily disk)
    // Since we don't keep things in memory, we can do nothing here.
    cb(0);
  },
  fsync(path, fd, datasync, cb) {
    $(cb, async() => {
      const file = openFiles.get(fd);
      if (file) {
        if (datasync) {
          await file.datasync();
        } else {
          await file.sync();
        }
      } else {
        throw new Error("File not open"); // TODO: better error
      }
    });
  },
  // fsyncdir: don't think we can do anything here?
  readdir: (path, cb) => {
    $(cb, () => fs.readdir(getAbsolutePath(path)));
  },
  truncate: (path, size, cb) => {
    $(cb, async () => {
      fs.truncate(getAbsolutePath(path), size);
    });
  },
  ftruncate: (path, fd, size, cb) => {
    $(cb, async () => {
      const file = openFiles.get(fd);
      if (file) {
        file.truncate(size);
      } else {
        throw new Error("file not open"); // TODO: better error
      }
    });
  },
  readlink: (path, cb) => {
    $(cb, () => fs.readlink(getAbsolutePath(path)));
  },
  chown: (path, uid, gid, cb) => {
    $(cb, () => fs.chown(getAbsolutePath(path), uid, gid));
  },
  chmod: (path, mode, cb) => {
    $(cb, () => fs.chmod(getAbsolutePath(path), mode));
  },
  mknod: (path, mode, dev, cb) => {
    // TODO: existance checking?
    $(cb, () => fs.writeFile(getAbsolutePath(path), Buffer.alloc(0), { mode }));
  },
  //mknod TODO: not sure how to implement this, or if it's needed.
  //setxattr TODO: only osx, no native node support
  //getxattr TODO: only osx, no native node support
  //listxattr TODO: only osx, no native node support
  //removexattr TODO: only osx, no native node support
  open: (path, flags, cb) => {
    $(cb, () => openFile(path, flags));
  },
  opendir: (path, flags, cb) => {
    $(cb, async() => {
      const handle = await fs.opendir(getAbsolutePath(path));
      const fd = dirFdCount++;
      openDirs.set(fd, handle);
      return fd;
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
  write: (path, fd, buffer, length, position, cb) => {
    (async() => {
      try {
        const file = openFiles.get(fd);
        if (file) {
          const { bytesWritten } = await file.write(buffer, 0, length, position);
          cb(bytesWritten);
        } else {
          cb(0);
        }
      } catch (e) {
        console.error("Write error", e);
        cb(0);
      }
    })();
    // TODO
  },
  release: (path, fd, cb) => {
    $(cb, async () => {
      const file = openFiles.get(fd);
      openFiles.delete(fd);
      if (file) {
        await file.close()
      }
    });
  },
  releasedir: (path, fd, cb) => {
    $(cb, async() => {
      const dir = openDirs.get(fd);
      openDirs.delete(fd);
      if (dir) {
        await dir.close();
      }
    });
  },
  create: (path, mode, cb) => {
    $(cb, async() => {
      await fs.writeFile(getAbsolutePath(path), Buffer.alloc(0), { mode });
      return await openFile(path, 'w')
    });
  },
  utimens: (path, atime, mtime, cb) => {
    $(cb, () => fs.utimes(getAbsolutePath(path), atime, mtime));
  },
  unlink: (path, cb) => {
    $(cb, () => fs.unlink(getAbsolutePath(path)));
  },
  rename: (src, dest, cb) => {
    $(cb, () => fs.rename(getAbsolutePath(src), getAbsolutePath(dest)));
  },
  // TODO: link
  symlink: (target, path, cb) => {
    $(cb, () => fs.symlink(target, getAbsolutePath(path)));
  }
};

const fuse = new Fuse(
  mountPath,
  handlers,
  { force: true, mkdir: true, autoUnmount: true }
);

// TODO: how do symlinks work? Currently they're shown as files.
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

