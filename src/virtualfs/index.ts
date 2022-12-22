export { InMemoryFileHandler } from './inMemoryFileHandler.js';
export { VirtualFileHandler } from './virtualFile.js';

import { VirtualFileHandler } from './virtualFile.js';

/**
 * Use cases:
 * 1. Insert a package.json file into every /lib/ folder
 * 2. Auto lazily compile every .ts file to .js
 */

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


