import { resolve } from 'node:path';

export const resolver = (sourcePath: string, mountPath: string) => (pathSegment: string) => {
  const path = resolve(sourcePath, `./${pathSegment}`);
  if (!path.startsWith(sourcePath)) {
    throw new Error("Couldn't construct path: path is not a subpath of source");
  }
  if (path.startsWith(mountPath)) {
    throw new Error("Recursive mounting. Not good");
  }
  return path;
}
