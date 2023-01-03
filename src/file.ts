import { FileHandle, lstat, open } from 'node:fs/promises';
import { Awaitable } from './awaitable.js';
import { isEnoent } from './error.js';

export async function withFile<T>(path: string, cb: ((file: FileHandle)=> Awaitable<T>)): Promise<T> {
  const file = await open(path, 'r+');
  try {
    return await cb(file);
  } finally {
    await file.close();
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (e) {
    if (isEnoent(e)) {
      return false;
    }
    throw e;
  }
}

