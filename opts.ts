import { resolve } from 'node:path';
import * as fs from 'node:fs/promises';

export type ProgramOpts = {
  sourcePath: string,
  mountPath: string
}

export async function getProgramOpts(): Promise<ProgramOpts> {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    console.error("Usage: fused <src> <workspace>");
    process.exit(-1);
  }

  const sourcePath = resolve(args[0]);
  const mountPath = resolve(args[1]);

  let sourceIsDir;
  try {
    sourceIsDir = (await fs.stat(sourcePath)).isDirectory();
  } catch (e) {
    sourceIsDir = false;
  }
  if (!sourceIsDir) {
    console.error("Source must be a folder");
    process.exit(-1);
  }

  if (sourcePath.startsWith(mountPath) || mountPath.startsWith(sourcePath)) {
    console.error("Source and mount paths cannot overlap.");
    process.exit(-1);
  }

  return {sourcePath, mountPath};
}
