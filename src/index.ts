import Fuse from 'fuse-native';
import { getProgramOpts } from './opts.js';
import { makeHandlers } from './handlers.js';
import { VirtualFileHandler, VirtualFs } from './virtualfs/index.js';
import { RealFs } from './realFs.js';

const opts = await getProgramOpts();

const realFs = new RealFs(opts);

const handler: VirtualFileHandler = {
  handles(path) {
    if (path.endsWith('/phantom.virt')) {
      return 'self';
    }
    return 'other_with_fallback';
  },
  listFiles(folder) {
    console.log("Listing files...");
    return ['phantom.virt'];
  },
  readFile(path) {
    return 'Phantom data';
  },
  writeFile(_path, _content) {
    // dev nulling
    return;
  },
  stat(path) {
    if (path.endsWith('/phantom.virt')) {
      return {
        type: 'file',
        writeable: false,
        modificationTime: new Date(2022, 1, 1, 0, 0, 0),
        size: "Phantom data".length,
        executable: false
      }
    } else {
      return {
        type: 'folder'
      }
    }
  }
};

const { gid, uid } = await realFs.getattr('/');

const virtualFs = new VirtualFs(handler, gid, uid);


const handlers = makeHandlers(new RealFs(opts), virtualFs);

const fuse = new Fuse(
  opts.mountPath,
  handlers,
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
      console.error("Couldn't cleanly unmount");
      process.exit(-1);
    }
    process.exit(0);
  });
});


