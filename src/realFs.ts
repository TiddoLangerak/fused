import { Dir } from 'node:fs';
import { open, opendir, FileHandle, lstat, constants, readdir, truncate, chown, readlink, chmod, writeFile, utimes, unlink, rename, symlink, link, mkdir, rmdir } from 'node:fs/promises';
import { debug } from './debug.js';
import { FusedFs, Stat, Fd, Handles } from './handlers.js';
import { ProgramOpts } from './opts.js';
import { resolver, Resolver } from './path.js';

export class RealFs implements FusedFs {
  getAbsolutePath: Resolver;
  #openFiles: Map<Fd, FileHandle> = new Map();
  #openDirs: Map<Fd, Dir> = new Map();
  #dirFdCount: Fd = 1;

  constructor(opts: ProgramOpts) {
    this.getAbsolutePath = resolver(opts);
  }

  handles = () => 'self' as Handles;
  init = () => { /* Nothing to do */ };
  getattr = (path: string) => lstat(this.getAbsolutePath(path));
  fgetattr = async (path: string, fd: Fd) => {
    const file = await this.getOrOpenFile(path, fd, constants.O_RDONLY);
    if (file) {
      return await file.stat();
    } else {
      return await this.getattr(path);
    }
  }
  flush = (path: string, fd: Fd) => {
      // We need to flush uncommitted data to the OS here (not necessarily disk)
      // Since we don't keep things in memory, we have nothing to do here
  }
  fsync = async (path: string, fd: Fd, datasync: boolean) => {
    const file = await this.getOrOpenFile(path, fd, constants.O_RDWR);
    if (file) {
      if (datasync) {
        await file.datasync();
      } else {
        await file.sync();
      }
    } else {
      console.warn(`Trying to fsync a file that isn't open. Path: ${path}. Fd: ${fd}`);
      // Technically we should return EBADF here, but it seems that it's somewhat common to get here?
      // I don't quite understand.
    }
  }
  readdir = (path: string) => readdir(this.getAbsolutePath(path));
  truncate = (path: string, size: number) => truncate(this.getAbsolutePath(path), size);
  ftruncate = async (path: string, fd: Fd, size: number) => {
    const file = await this.getOrOpenFile(path, fd, constants.O_WRONLY);
    if (file) {
      file.truncate(size);
    } else {
      throw new Error("file not open"); // TODO: better error
    }
  }
  readlink = (path: string) => readlink(this.getAbsolutePath(path));
  chown = (path: string, uid: number, gid: number) => chown(this.getAbsolutePath(path), uid, gid);
  chmod = (path: string, mode: number) => chmod(this.getAbsolutePath(path), mode);
      // TODO: existance checking?
  mknod = (path: string, mode: number, _dev: string) => writeFile(this.getAbsolutePath(path), Buffer.alloc(0), {mode});
  //setxattr TODO: only osx, no native node support
  //getxattr TODO: only osx, no native node support
  //listxattr TODO: only osx, no native node support
  //removexattr TODO: only osx, no native node support
  open = async(path: string, flags: number | string) => {
    const handle = await open(this.getAbsolutePath(path), flags);
    this.#openFiles.set(handle.fd, handle);
    return handle.fd;
  }
  opendir = async(path: string, flags: number) => {
    const handle = await opendir(this.getAbsolutePath(path));
    const fd = this.#dirFdCount++;
    this.#openDirs.set(fd, handle);
    return fd;
  }
  read = async(path: string, fd: Fd, buffer: Buffer, length: number, position: number) => {
    try {
      const file = await this.getOrOpenFile(path, fd, constants.O_RDONLY);
      if (file) {
        const { bytesRead } = await file.read(buffer, 0, length, position);
        return bytesRead;
      } else {
        return 0;
      }
    } catch (e) {
      console.error(`Read error for file ${path} (fd: ${fd})`, e);
      return 0;
    }
  }
  write = async(path: string, fd: Fd, buffer: Buffer, length: number, position: number) => {
    try {
      const file = await this.getOrOpenFile(path, fd, constants.O_WRONLY);
      if (file) {
        const { bytesWritten } = await file.write(buffer, 0, length, position);
        return bytesWritten;
      } else {
        return 0;
      }
    } catch (e) {
      console.error("Write error", e);
      return 0;
    }
  }
  release = async (_path: string, fd: Fd) => {
    const file = this.getFileHandle(fd);
    this.#openFiles.delete(fd);
    if (file) {
      await file.close()
    }
  }
  releasedir = async (_path: string, fd: Fd) => {
    const dir = this.#openDirs.get(fd);
    this.#openDirs.delete(fd);
    if (dir) {
      await dir.close();
    }
  }
  utimens = (path: string, atime: number, mtime: number) => utimes(this.getAbsolutePath(path), atime, mtime);
  unlink = (path: string) => unlink(this.getAbsolutePath(path));
  rename = (src: string, dest: string) => rename(this.getAbsolutePath(src), this.getAbsolutePath(dest));
  // Note that target should NOT be resolved here, but kept as-is
  symlink = (target: string, path: string) => symlink(target, this.getAbsolutePath(path));
  link = (target: string, path: string) => link(this.getAbsolutePath(target), this.getAbsolutePath(path));
  mkdir = (path: string, mode: number) => mkdir(this.getAbsolutePath(path), { mode });
  rmdir = (path: string) => rmdir(this.getAbsolutePath(path));



  getOrOpenFile = async (path: string, fd: number, mode: number): Promise<FileHandle | undefined> => {
    if (!fd || !this.isFileOpen(fd)) {
      debug(`Warn: No file open for ${path}`);
      fd = await this.open(path, mode);
    }
    return this.getFileHandle(fd);
  }

  getFileHandle = (fd: Fd): FileHandle | undefined => {
    return this.#openFiles.get(fd);
  }

  isFileOpen = (fd: Fd): boolean => {
    return this.#openFiles.has(fd);
  }


}
