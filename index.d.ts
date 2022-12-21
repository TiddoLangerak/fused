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
    readdir(path: string, cb: CB<string[]>): void;
    getattr(path: string, cb: CB<Stat>): void;

  };
  export type Options = { debug: boolean, force: boolean, mkdir: boolean, autoUnmount: boolean };
  export default class Fuse {
    static ENOENT: number;
    constructor(mnt: string, handlers: Handlers, opts?: Partial<Options>)
    mount(cb: (err: any) => unknown): unknown;
    static unmount(mnt: string, cb: (err: any) => unknown): unknown;
  }
}
