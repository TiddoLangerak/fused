import Fuse from 'fuse-native';
import { ProgramOpts } from './opts.js';
import { makeHandlers } from './handlers.js';
import { VirtualFileHandler, VirtualFs } from './virtualfs/index.js';
import { RealFs } from './realFs.js';
import { stat } from 'fs/promises';

async function validateOpts({ sourcePath, mountPath }: ProgramOpts) {
  const sourceIsDir = (await stat(sourcePath)).isDirectory();
  if (!sourceIsDir) {
    throw new Error("Source must be a folder");
  }

  if (sourcePath.startsWith(mountPath) || mountPath.startsWith(sourcePath)) {
    throw new Error("Source and mount paths cannot overlap.");
  }
}

export type Unmount = () => Promise<void>;
export type FusedHandle = {
  unmount: Unmount
};

export async function main(opts: ProgramOpts, files: VirtualFileHandler[]): Promise<FusedHandle> {
  await validateOpts(opts);
  const realFs = new RealFs(opts);
  const { gid, uid } = await realFs.getattr('/');

  const overlays = files.map(file => new VirtualFs(file, opts, gid, uid));

  const handlers = makeHandlers(new RealFs(opts), overlays);

  const fuse = new Fuse(
    opts.mountPath,
    handlers,
    { force: true, mkdir: true, autoUnmount: true, defaultPermissions: true }
  );

  await new Promise((resolve, reject) => {
    fuse.mount(async err => {
      if (err) {
        console.error("Couldn't mount", err);
        reject(err);
      }

      resolve(null);
    });
  });

  function unmount(): Promise<void> {
    return new Promise((resolve, reject) => {
      fuse.close((err) => {
        process.off('SIGINT', sigintHandler);
        if(err) {
          reject(err);
        } else {
          resolve(undefined);
        }
      });
    });
  }

  let unmounting = false;

  async function sigintHandler() {
    try {
      if (unmounting) {
        // Double siginit
        return;
      }
      unmounting = true;
      await unmount();
      console.log("Unmounted cleanly. Exiting");
    } catch (e) {
      console.error("Couldn't cleanly unmount. If the process doesn't end, press ctrl-c again", e);
      process.off('SIGINT', sigintHandler);
    }

  }

  process.on('SIGINT', sigintHandler);

  return { unmount };
}


