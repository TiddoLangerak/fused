type PickResult<T, K extends keyof T> = { [K2 in K]: T[K2] };

export function pick<T, K extends keyof T>(obj: T, keys: K[]): PickResult<T, K> {
  const res: Partial<PickResult<T, K>> = {};
  for (const k of keys) {
    res[k] = obj[k];
  }
  return res as PickResult<T, K>;
}
