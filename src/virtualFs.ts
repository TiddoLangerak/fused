import { basename, dirname } from 'path';
import { resolver, Resolver } from './path.js';

export type FileContent = string;

export type VirtualFile = {
  path: string,
  load(): FileContent,
  write(f: FileContent): unknown,
}

// dir -> filename -> file
const virtualFiles : Map<string, Map<string, VirtualFile>> = new Map();;

export type VirtualFsOpts = {
  sourcePath: string,
  mountPath: string
}

export class VirtualFs {
  #getAbsolutePath: Resolver;
  constructor(opts: VirtualFsOpts) {
    this.#getAbsolutePath = resolver(opts);
  }

  registerVirtualFile(file: VirtualFile) {
    const fullPath = this.#getAbsolutePath(file.path);
    const filename = basename(fullPath);
    const dir = dirname(fullPath);
    if (!virtualFiles.has(dir)) {
      virtualFiles.set(dir, new Map());
    }
    virtualFiles.get(dir)!.set(filename, file);
  }

  list(dirPath: string): Iterable<string> {
    const fullPath = this.#getAbsolutePath(dirPath);
    return virtualFiles.get(fullPath)?.keys() || [] as string[];
  }
}


