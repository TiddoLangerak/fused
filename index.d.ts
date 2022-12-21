declare module 'fuse-native' {
  type CB<T> = (returnCode: number, val?: T) => unknown;
  export type Handlers = {

  };
  export type Options = { debug: boolean, force: boolean, mkdir: boolean, autoUnmount: boolean };
  export default class Fuse {
    static ENOENT: unknown;
    constructor(mnt: string, handlers: Handlers, opts?: Partial<Options>)
    mount(cb: (err: any) => unknown): unknown;
    static unmount(mnt: string, cb: (err: any) => unknown): unknown;
  }
}
