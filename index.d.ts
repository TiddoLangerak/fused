declare module 'fuse-native' {
  export type Handlers = unknown;
  export type Options = unknown;
  export default class Fuse {
    constructor(mnt: string, handlers: Handlers, opts?: Options)
  }
}
