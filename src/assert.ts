export function assert(c: boolean, msg: string): asserts c {
  if (!c) {
    throw new Error(msg);
  }
}
