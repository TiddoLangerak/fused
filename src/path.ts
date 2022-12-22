import { resolve } from 'node:path';

export class PathNotInSourceError extends Error {
  constructor() {
    super("Requested path is not in the source folder");
  }
}

export class RecursiveMountingError extends Error {
  constructor() {
    super("Source and mount paths must not overlap.")
  }
}

export type ResolverOpts = {
  sourcePath: string;
  mountPath: string;
}

export const resolver = ({ sourcePath, mountPath } : ResolverOpts) => (pathSegment: string) => {
  const path = resolve(sourcePath, `./${pathSegment}`);
  if (!path.startsWith(sourcePath)) {
    throw new PathNotInSourceError();
  }
  if (path.startsWith(mountPath)) {
    throw new RecursiveMountingError();
  }
  return path;
}
