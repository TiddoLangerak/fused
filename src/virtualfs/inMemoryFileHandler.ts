import { basename, dirname } from 'path';
import { assert } from '../assert.js';
import { FileContent, VirtualFileHandler } from "./virtualFile.js";
import { Awaitable } from '../awaitable.js';

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
