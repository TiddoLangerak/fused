import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { rmrf } from "../file";
import { FusedHandle, main } from "../lib";
import { ProgramOpts } from "../opts";
import { VirtualFileHandler } from "../virtualfs";

export type FileTree = {
  [k in string]: string
};

export type VirtualFiles = () => VirtualFileHandler[];

export type TestFs = {
  mnt: (p: string) => string,
  src: (p: string) => string,
  paths: (p: string) => { srcPath: string, mntPath: string },
  init: () => Promise<FusedHandle>,
  cleanup: (handle: FusedHandle) => Promise<void>
}

export function testFs(opts: ProgramOpts, realFiles: FileTree, virtualFiles: VirtualFiles): TestFs {
  const { mountPath, sourcePath } = opts;

  const mnt = (p: string) => join(mountPath, p);
  const src = (p: string) => join(sourcePath, p);
  const paths = (p: string) => ({ srcPath: src(p), mntPath: mnt(p) });

  const init = async () => {
    await createFileTree(sourcePath, realFiles);
    return await main(opts, virtualFiles());
  };

  const cleanup = async (handle: FusedHandle) => {
    await handle.unmount();
    await rmrf(sourcePath);
  };

  return {
    mnt,
    src,
    paths,
    init,
    cleanup
  };
}

async function createFileTree(sourcePath: string, files: FileTree) {
  await rmrf(sourcePath);
  await mkdir(sourcePath, { recursive: true });

  for (let [path, content] of Object.entries(files)) {
    const dir = dirname(path);
    if (dir) {
      await mkdir(resolve(sourcePath, dir), { recursive: true });
    }
    await writeFile(resolve(sourcePath, path), content);
  }
}
