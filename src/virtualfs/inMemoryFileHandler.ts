import { basename, dirname, relative, sep } from 'path';
import { assert } from '../assert.js';
import { FileContent, MiniStat, VirtualFileHandler } from "./virtualFile.js";
import { FileNotFoundError } from '../error.js';

export class InMemoryFileHandler implements VirtualFileHandler {
  #path: string;
  #folder: string;
  #file: string;
  #modificationTime: Date;
  content: FileContent;

  constructor(path: string, content: FileContent) {
    this.#path = path;
    this.content = content;
    this.#folder = dirname(path);
    this.#file = basename(path);
    this.#modificationTime = new Date();
  }
  #isAncestor(path: string): boolean {
    return relative(path, this.#path)[0] !== '.';
  }
  handles(path: string) {
    if (this.#path === path) {
      return 'self';
    } else if (this.#isAncestor(path)) {
      return 'other_with_fallback';
    }
    return 'other';
  }
  listFiles(folder: string): string[]{
    if (this.#folder === folder) {
      return [this.#file];
    } else if (this.#isAncestor(folder)) {
      return [relative(folder, this.#folder).split(sep)[0]];
    }

    return [];
  }
  readFile(path: string): FileContent {
    assert(path === this.#path, new FileNotFoundError(path));
    return this.content;
  }
  writeFile(path: string, content: FileContent): void {
    assert(path === this.#path, new FileNotFoundError(path));
    this.content = content;
    this.#modificationTime = new Date();
  }
  stat(path: string): MiniStat {
    if (path === this.#path) {
      return {
        type: 'file',
        writeable: true,
        modificationTime: this.#modificationTime,
        size: this.content.length,
        executable: false
      }
    } else if (this.#isAncestor(path)) {
      return {
        type: 'folder'
      }
    } else {
      throw new FileNotFoundError(path);
    }
  }
  updateModificationTime(path: string, mtime: Date) {
    assert(path === this.#path, new FileNotFoundError(path));
    this.#modificationTime = mtime;
  }
}
