export function assert(c: boolean, msg: string): asserts c {
  if (!c) {
    throw new Error(msg);
  }
}

export function todo(msg: string) : never {
  throw new Error(`Not yet implemented : ${msg}`);
}
