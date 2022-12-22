import { Dir } from 'node:fs';
import { open, FileHandle } from 'node:fs/promises';
import { debug } from './debug.js';
import { ProgramOpts } from './opts.js';
import { resolver } from './path.js';

export type Fd = number;

export class FusedFs {
  getAbsolutePath: (segment: string) => string;
  #openFiles: Map<Fd, FileHandle> = new Map();
  constructor(opts: ProgramOpts) {
    this.getAbsolutePath = resolver(opts.sourcePath, opts.mountPath);
  }

  async openFile(path: string, flags: number | string): Promise<Fd> {
    const handle = await open(this.getAbsolutePath(path), flags);
    this.#openFiles.set(handle.fd, handle);
    return handle.fd;
  }

  async getOrOpenFile(path: string, fd: number, mode: number): Promise<FileHandle | undefined> {
    if (!fd || !this.isOpen(fd)) {
      debug(`Warn: No file open for ${path}`);
      fd = await this.openFile(path, mode);
    }
    return this.getFileHandle(fd);
  }

  getFileHandle(fd: Fd): FileHandle | undefined {
    return this.#openFiles.get(fd);
  }

  isOpen(fd: Fd): boolean {
    return this.#openFiles.has(fd);
  }

  async close(fd: Fd): Promise<void> {
    const file = this.getFileHandle(fd);
    this.#openFiles.delete(fd);
    if (file) {
      await file.close()
    }
  }
}
