/// For whatever reason the reference is needed for the language-server
/// <reference path="../types/fuse-native.d.ts" />
import Fuse, { CB, Handlers } from "fuse-native";
import { debug } from "./debug.js";
import { FusedFs } from "./fusedFs.js";
import { ProgramOpts } from "./opts.js";
import { resolver } from './path.js';
import { VirtualFs } from "./virtualFs.js";
import * as fs from 'node:fs/promises';

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

export const makeHandlers = (opts: ProgramOpts, virtualFs: VirtualFs): Partial<Handlers> => {
  const getAbsolutePath = resolver(opts);
  const fusedFs = new FusedFs(opts);

  return {
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
        const file = await fusedFs.getOrOpenFile(path, fd, fs.constants.O_RDONLY);
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
        const file = await fusedFs.getOrOpenFile(path, fd, fs.constants.O_RDWR);
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
        const fakeFiles = virtualFs.list(path);

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
        const file = await fusedFs.getOrOpenFile(path, fd, fs.constants.O_WRONLY);
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
      $(cb, () => fusedFs.openFile(path, flags));
    },
    opendir: (path, flags, cb) => {
      debug(`opendir ${path} (flags: ${flags})`);
      $(cb, () => fusedFs.openDir(path));
    },
    read: (path, fd, buffer, length, position, cb) => {
      debug(`read ${path} (fd: ${fd} length: ${length} position ${position}`);
            (async() => {
              try {
                const file = await fusedFs.getOrOpenFile(path, fd, fs.constants.O_RDONLY);
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
                const file = await fusedFs.getOrOpenFile(path, fd, fs.constants.O_WRONLY);
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
      $(cb, () => fusedFs.closeFile(fd));
    },
    releasedir: (path, fd, cb) => {
      debug(`releasedir ${path} (fd: ${fd})`);
      $(cb, () => fusedFs.closeDir(fd));
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
}
};
