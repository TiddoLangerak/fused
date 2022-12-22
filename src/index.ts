/// For whatever reason the reference is needed for the language-server
/// <reference path="../types/fuse-native.d.ts" />
import Fuse from 'fuse-native';
import { getProgramOpts } from './opts.js';
import { makeHandlers } from './handlers.js';
import { VirtualFs, FileContent } from './virtualFs.js';

const opts = await getProgramOpts();

const virtualFs = new VirtualFs(opts);
const handlers = makeHandlers(opts, virtualFs);

const fuse = new Fuse(
  opts.mountPath,
  handlers,
  { force: true, mkdir: true, autoUnmount: true, defaultPermissions: true }
);

virtualFs.registerVirtualFile({
  path: 'virtual.virt',
  load() { throw new Error("TODO"); },
  write(_f: FileContent) { throw new Error("TODO"); }
});

fuse.mount(err => {
  console.log("Mounted, ready for action");
  if (err) {
    console.error("Couldn't mount", err);
    process.exit(-1);
  }
});

process.on('SIGINT', (_code) => {
  // TODO: clean this up
  Fuse.unmount(opts.mountPath, (err) => {
    if(err) {
      console.error("Couldn't cleanly unmount");
      process.exit(-1);
    }
    process.exit(0);
  });
});


