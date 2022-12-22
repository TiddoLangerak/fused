/// For whatever reason the reference is needed for the language-server
/// <reference path="../types/fuse-native.d.ts" />
import Fuse from 'fuse-native';
import { basename, dirname } from 'node:path';
import { getProgramOpts } from './opts.js';
import { resolver } from './path.js';
import { makeHandlers } from './handlers.js';

// TODO: clean up this monstrousity
//

const opts = await getProgramOpts();

const fuse = new Fuse(
  opts.mountPath,
  makeHandlers(opts),
  { force: true, mkdir: true, autoUnmount: true, defaultPermissions: true }
);

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
      process.exit(-1);
    }
    process.exit(0);
  });
});


type FileContent = string;

type VirtualFile = {
  path: string,
  load(): FileContent,
  write(f: FileContent): unknown,
}

// dir -> filename -> file
const virtualFiles : Map<string, Map<string, VirtualFile>> = new Map();;

function registerVirtualFile(file: VirtualFile) {
  // TODO: move out resolver
  const fullPath = resolver(opts)(file.path);
  const filename = basename(fullPath);
  const dir = dirname(fullPath);
  if (!virtualFiles.has(dir)) {
    virtualFiles.set(dir, new Map());
  }
  virtualFiles.get(dir)!.set(filename, file);
}

registerVirtualFile({
  path: 'virtual.virt',
  load() { throw new Error("TODO"); },
  write(_f: FileContent) { throw new Error("TODO"); }
});

