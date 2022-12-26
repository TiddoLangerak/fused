import { basename, dirname } from 'path';
import { assert, todo } from '../assert.js';
import { FileContent, MiniStat, VirtualFileHandler } from "./virtualFile.js";
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
  // TODO: this is broken, we should also deal with prefixes. Otherwise /foo/bar/baz is unreachable if there's no /foo/bar on the real FS
  handlesFile(file: string): Awaitable<boolean> {
    return file === this.#file;
  }
  handlesFolder(folder: string): Awaitable<boolean> {
    // TODO: need to do subfolders
    return folder === this.#folder;
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
  stat(path: string): Awaitable<MiniStat | undefined> {
    todo("Stat");
  }
}
