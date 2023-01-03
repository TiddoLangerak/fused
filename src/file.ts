import { FileHandle, open } from 'node:fs/promises';
import { Awaitable } from './awaitable.js';

export async function withFile<T>(path: string, cb: ((file: FileHandle)=> Awaitable<T>)): Promise<T> {
  const file = await open(path, 'r+');
  try {
    return await cb(file);
  } finally {
    await file.close();
  }
}

