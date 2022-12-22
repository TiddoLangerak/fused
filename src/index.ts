import Fuse from 'fuse-native';
import { getProgramOpts } from './opts.js';
import { makeHandlers } from './handlers.js';
import { VirtualFs, FileContent } from './virtualFs.js';

const opts = await getProgramOpts();

const virtualFs = new VirtualFs();
const handlers = makeHandlers(opts, virtualFs);

const fuse = new Fuse(
  opts.mountPath,
  handlers,
  { force: true, mkdir: true, autoUnmount: true, defaultPermissions: true }
);

virtualFs.registerHandler({
  handles(folder, file) {
    return !file || file === 'phantom.virt';
  },
  listFiles(folder) {
    return ['phantom.virt'];
  },
  readFile(path) {
    return 'Phantom data';
  },
  writeFile(_path, _content) {
    // dev nulling
    return;
  }
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


