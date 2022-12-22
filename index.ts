import Fuse, { CB, Handlers } from 'fuse-native';
import { Dir } from 'node:fs';
import * as fs from 'node:fs/promises';
import { FileHandle } from 'node:fs/promises';
import { resolve, basename, dirname } from 'node:path';

// TODO: clean up this monstrousity

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error("Usage: fused <src> <workspace>");
  process.exit(-1);
}

const sourcePath = resolve(args[0]);
const mountPath = resolve(args[1]);

let sourceIsDir;
try {
 sourceIsDir = (await fs.stat(sourcePath)).isDirectory();
} catch (e) {
  sourceIsDir = false;
}
if (!sourceIsDir) {
  console.error("Source must be a folder");
  process.exit(-1);
}


const enableDebug = !!process.env.FUSED_DEBUG || false;

function debug(...args: any[]) {
  if (enableDebug) {
    console.log(...args);
  }
}


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
let dirFdCount = 1;
const openDirs: Map<number, Dir> = new Map();

async function getOrOpenFile(path: string, fd: number, mode: number): Promise<FileHandle | undefined> {
  if (!fd || !openFiles.has(fd)) {
    debug(`Warn: No file open for ${path}`);
    fd = await openFile(path, mode);
  }
  const file = openFiles.get(fd);
  return file;
}

const handlers: Partial<Handlers> = {
  init: (cb) => {
    debug("init");
    cb(0);
  },
  /*
  access: (path, mode, cb) => {
    debug(`access ${path} (mode: ${mode})`);
    // TODO: do we need to do something here?
    cb(0);
  },
  */
  // statfs(). Doesn't have a node equivalent
  getattr: (path, cb) => {
    debug(`getattr ${path}`);
    $(cb,  () =>  fs.lstat(getAbsolutePath(path)));
  },
  fgetattr: (path, fd, cb) => {
    debug(`fgetattr ${path} (fd: ${fd})`);
    $(cb, async() => {
      const file = await getOrOpenFile(path, fd, fs.constants.O_RDONLY);
      if (file) {
        return await file.stat();
      } else {
        return await fs.stat(getAbsolutePath(path));
      }
    });
  },
  flush(path, fd, cb) {
    debug(`flush ${path} (fd: ${fd})`);
    // We need to flush uncommitted data to the OS here (not necessarily disk)
    // Since we don't keep things in memory, we can do nothing here.
    cb(0);
  },
  fsync(path, fd, datasync, cb) {
    debug(`fsync ${path} (fd: ${fd}, datasync: ${datasync})`);
    $(cb, async() => {
      const file = await getOrOpenFile(path, fd, fs.constants.O_RDWR);
      if (file) {
        if (datasync) {
          await file.datasync();
        } else {
          await file.sync();
        }
      } else {
        console.warn(`Trying to fsync a file that isn't open. Path: ${path}. Fd: ${fd}`);
        /*throw {
          errno: Fuse.EBADF,
          msg: `File not open. FD: ${fd}. Path: ${path}`
        };*/
        //throw new Error(`File not open. FD: ${fd}. Path: ${path}`); // TODO: better error
      }
    });
  },
  // fsyncdir: don't think we can do anything here?
  readdir: (path, cb) => {
    debug(`readdir ${path}`);
    $(cb, async () => {
      const fullPath = getAbsolutePath(path);
      const realFiles = await fs.readdir(fullPath);
      const fakeFiles = virtualFiles.get(fullPath)?.keys() || [] as string[];

      return [...realFiles, ...fakeFiles];
    });
  },
  truncate: (path, size, cb) => {
    debug(`truncate ${path} (size: ${size})`);
    $(cb, async () => {
      fs.truncate(getAbsolutePath(path), size);
    });
  },
  ftruncate: (path, fd, size, cb) => {
    debug(`ftruncate ${path} (fd: ${fd} size: ${size})`);
    $(cb, async () => {
      const file = await getOrOpenFile(path, fd, fs.constants.O_WRONLY);
      if (file) {
        file.truncate(size);
      } else {
        throw new Error("file not open"); // TODO: better error
      }
    });
  },
  readlink: (path, cb) => {
    debug(`readlink ${path}`);
    $(cb, () => fs.readlink(getAbsolutePath(path)));
  },
  chown: (path, uid, gid, cb) => {
    debug(`chown ${path} ${gid}:${uid}`);
    $(cb, () => fs.chown(getAbsolutePath(path), uid, gid));
  },
  chmod: (path, mode, cb) => {
    debug(`chmod ${path} (mode: ${mode})`);
    $(cb, () => fs.chmod(getAbsolutePath(path), mode));
  },
  mknod: (path, mode, dev, cb) => {
    debug(`mknod ${path} (mode: ${mode} dev: ${dev})`);
    // TODO: existance checking?
    $(cb, () => fs.writeFile(getAbsolutePath(path), Buffer.alloc(0), { mode }));
  },
  //mknod TODO: not sure how to implement this, or if it's needed.
  //setxattr TODO: only osx, no native node support
  //getxattr TODO: only osx, no native node support
  //listxattr TODO: only osx, no native node support
  //removexattr TODO: only osx, no native node support
  open: (path, flags, cb) => {
    debug(`open ${path} (flags: ${flags})`);
    $(cb, () => openFile(path, flags));
  },
  opendir: (path, flags, cb) => {
    debug(`opendir ${path} (flags: ${flags})`);
    $(cb, async() => {
      const handle = await fs.opendir(getAbsolutePath(path));
      const fd = dirFdCount++;
      openDirs.set(fd, handle);
      return fd;
    });
  },
  read: (path, fd, buffer, length, position, cb) => {
    debug(`read ${path} (fd: ${fd} length: ${length} position ${position}`);
    (async() => {
      try {
        const file = await getOrOpenFile(path, fd, fs.constants.O_RDONLY);
        if (file) {
          const { bytesRead } = await file.read(buffer, 0, length, position);
          cb(bytesRead);
        } else {
          cb(0);
        }
      } catch (e) {
        console.error(`Read error for file ${path} (fd: ${fd})`, e);
        cb(0);
      }
    })();
    // TODO
  },
  write: (path, fd, buffer, length, position, cb) => {
    debug(`write ${path} (fd: ${fd} length: ${length} position ${position}`);
    (async() => {
      try {
        const file = await getOrOpenFile(path, fd, fs.constants.O_WRONLY);
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
    debug(`release ${path} (fd: ${fd})`);
    $(cb, async () => {
      const file = openFiles.get(fd);
      openFiles.delete(fd);
      if (file) {
        await file.close()
      }
    });
  },
  releasedir: (path, fd, cb) => {
    debug(`releasedir ${path} (fd: ${fd})`);
    $(cb, async() => {
      const dir = openDirs.get(fd);
      openDirs.delete(fd);
      if (dir) {
        await dir.close();
      }
    });
  },
  /*
   * TODO: _something_ is wrong with this implementation, but we don't really need it anyway.
   * Without create, users will use mknod + open, which are working as expected.
   *
   * create: (path, mode, cb) => {
    debug(`create ${path} (mode: ${mode})`);
    $(cb, async() => {
      await fs.writeFile(getAbsolutePath(path), Buffer.alloc(0), { mode });
      const fd = await openFile(path, mode)
      debug(`Created ${path}, fd: ${fd}`);
      return fd;
    });
  },
  */
  utimens: (path, atime, mtime, cb) => {
    debug(`utimens ${path} (atime: ${atime} mtime: ${mtime})`);
    $(cb, () => fs.utimes(getAbsolutePath(path), atime, mtime));
  },
  unlink: (path, cb) => {
    debug(`unlink ${path}`);
    $(cb, () => fs.unlink(getAbsolutePath(path)));
  },
  rename: (src, dest, cb) => {
    debug(`rename ${src} -> ${dest}`);
    $(cb, () => fs.rename(getAbsolutePath(src), getAbsolutePath(dest)));
  },
  // TODO: link
  symlink: (target, path, cb) => {
    debug(`symlink ${path} -> ${target}`);
    // Note that target should NOT be resolved here
    $(cb, () => fs.symlink(target, getAbsolutePath(path)));
  },
  link: (target, path, cb) => {
    debug(`link ${path} -> ${target}`);
    $(cb, () => fs.link(getAbsolutePath(target), getAbsolutePath(path)));
  },
  mkdir: (path, mode, cb) => {
    debug(`mkdir ${path} (mode: ${mode})`);
    $(cb, () => fs.mkdir(getAbsolutePath(path), { mode }));
  },
  rmdir: (path, cb) => {
    debug(`rmdir ${path}`);
    $(cb, () => fs.rmdir(getAbsolutePath(path)));
  }
};

const fuse = new Fuse(
  mountPath,
  handlers,
  { force: true, mkdir: true, autoUnmount: true, defaultPermissions: true }
);

fuse.mount(err => {
  console.log("Mounted, ready for action");
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


type FileContent = string;

type VirtualFile = {
  path: string,
  load(): FileContent,
  write(f: FileContent): unknown,
}

// dir -> filename -> file
const virtualFiles : Map<string, Map<string, VirtualFile>> = new Map();;

function registerVirtualFile(file: VirtualFile) {
  const fullPath = getAbsolutePath(file.path);
  const filename = basename(fullPath);
  const dir = dirname(fullPath);
  if (!virtualFiles.has(dir)) {
    virtualFiles.set(dir, new Map());
  }
  virtualFiles.get(dir)!.set(filename, file);
}

registerVirtualFile({
  path: 'virtual.virt',
  load() { throw new Error("TODO"); },
  write(f: FileContent) {}
});

