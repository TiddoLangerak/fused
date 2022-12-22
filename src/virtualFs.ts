import { basename, dirname } from 'path';
import { assert } from './assert.js';
import { Awaitable } from './awaitable.js';
import { resolver, Resolver } from './path.js';

export type FileContent = string | Buffer;

/**
 * Use cases:
 * 1. Insert a package.json file into every /lib/ folder
 * 2. Auto lazily compile every .ts file to .js
 */


// TODO: can probably do better by exposing a more complete interface, involving absolute + relative aths
export type VirtualFileHandler = {
  handles(folder: string, file?: string): Awaitable<boolean>;
  listFiles(folder: string): Awaitable<string[]>;
  // TODO: error handling
  readFile(path: string): Awaitable<FileContent | undefined>;
  writeFile(path: string, content: FileContent): Awaitable<void>;
}
export class InMemoryFileHandler implements VirtualFileHandler {
  #path: string;
  #folder: string;
  #file: string;
  content: FileContent;
  constructor(path: string, content: FileContent) {
    this.#path = path;
    this.content = content;
    this.#folder = dirname(path);
    this.#file = basename(path);
    console.log(this.#path, this.#folder, this.#file);
  }
  handles(folder: string, file?: string): Awaitable<boolean> {
    return folder === this.#folder && (!file || file === this.#file);
  }
  listFiles(folder: string): Awaitable<string[]>{
    assert(folder === this.#folder, "Requesting static file from incorrect folder");
    return [this.#file];
  }
  readFile(path: string): Awaitable<FileContent> {
    assert(path === this.#path, "Requesting static file with incorrect path");
    return this.content;
  }
  writeFile(path: string, content: FileContent): Awaitable<void> {
    assert(path === this.#path, "Writing static file with incorrect path");
    this.content = content;
  }
}

export type VirtualFsOpts = {
  sourcePath: string,
  mountPath: string
}

export class VirtualFs {
  #handlers: VirtualFileHandler[] = [];
  registerHandler(handler: VirtualFileHandler) {
    this.#handlers.push(handler);
  }

  async list(dirPath: string): Promise<string[]> {
    // TODO: fancy functional interface
    const res: string[] = [];
    for (const handler of this.#handlers) {
      if (await handler.handles(dirPath)) {
        res.push(...await handler.listFiles(dirPath));
      }
    }
    return res;
  }
}


