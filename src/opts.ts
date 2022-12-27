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

  return {sourcePath, mountPath};
}
