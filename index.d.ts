declare module 'fuse-native' {
  export type CB<T> = (returnCode: number, val?: T) => unknown;
  type Stat = {
    mtime: Date,
    atime: Date,
    ctime: Date,
    size: number,
    mode: number,
    uid: number,
    gid: number
  };
  export type Handlers = {
    getattr(path: string, cb: CB<Stat>): void;
    open(path: string, flags: number, cb:CB<number>): void;
    read(path: string, fd: number, buffer: Buffer, length: number, position: number, cb: (bytesRead: number) => unknown): void;
    release(path: string, fd: number, cb: CB<void>): void;
    init(cb: CB<never>): void;
    access(path: string, mode: number, cb: CB<void>): void;
    fgetattr(path: string, fd: number, cb: CB<Stat>): void;
    fsync(path: string, fd: number, datasync: boolean, cb: CB<void>): void;
    flush(path: string, fd: number, cb: CB<void>): void;
    fsyncdir(path: string, fd: number, datasync: boolean, cb: CB<void>): void;
    readdir(path: string, cb: CB<string[]>): void;
    truncate(path: string, size: number, cb: CB<void>): void;
    ftruncate(path: string, fd: number, size: number, cb: CB<void>): void;
    readlink(path: string, cb: CB<string>): void;
    chown(path: string, uid: number, gid: number, cb: CB<void>): void;
    chmod(path: string, mode: number, cb: CB<void>): void;
    mknod(path: string, mode: number, dev: string, cb: CB<void>): void;
    opendir(path: string, flags: number, cb: CB<number | void>): void;
    write(path: string, fd: number, buffer: Buffer, length: number, position: number, cb: CB<number>): void;
    releasedir(path: string, fd: number, cb: CB<void>): void;
    create(path: string, mode: number, cb: CB<number>): void;
    utimens(path: string, atime: number, mtime: number, cb: CB<void>): void;
    unlink(path: string, cb: CB<void>): void;
    rename(src: string, dest: string, cb: CB<void>): void;
    symlink(src: string, dest: string, cb: CB<void>): void;
    link(target: string, path: string, cb: CB<void>): void;
    mkdir(path: string, mode: number, cb: CB<void>): void;
    rmdir(path: string, cb: CB<void>): void;
  };
  export type Options = {
    debug: boolean,
    force: boolean,
    mkdir: boolean,
    autoUnmount: boolean ,
    defaultPermissions: true,
    allowOther: true
  };
  export default class Fuse {
    static ENOENT: number;
    static EBADF: number;
    constructor(mnt: string, handlers: Partial<Handlers>, opts?: Partial<Options>)
    mount(cb: (err: any) => unknown): unknown;
    static unmount(mnt: string, cb: (err: any) => unknown): unknown;
  }
}
