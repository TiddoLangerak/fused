export function assert(c: boolean, msg: string | Error): asserts c {
  if (!c) {
    if (typeof msg === 'string') {
      throw new Error(msg);
    } else {
      throw msg;
    }
  }
}

export function todo(msg: string) : never {
  throw new Error(`Not yet implemented : ${msg}`);
}

export function unreachable(_: never): never {
  throw new Error("We shouldn't have reached here");
}
