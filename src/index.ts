import Fuse from 'fuse-native';
import { getProgramOpts } from './opts.js';
import { makeHandlers } from './handlers.js';
import { VirtualFs } from './virtualfs/index.js';
import { RealFs } from './realFs.js';

const opts = await getProgramOpts();

const realFs = new RealFs(opts);
const virtualFs = await VirtualFs.init(realFs);
const handlers = makeHandlers(new RealFs(opts), virtualFs);

const fuse = new Fuse(
  opts.mountPath,
  handlers,
  { force: true, mkdir: true, autoUnmount: true, defaultPermissions: true }
);

// TODO:
// It's surprisingly hard to come up with a good interface, since everything is lazy.
// E.g. how do we naturally translate `getattr(path)` to something, without knowing if it's a file or folder?
// Possibly we need a `stat(): Optional<>` here?
// But this might also need access to the underlying fs.
virtualFs.registerHandler({
  handlesFolder(folder) {
    return true;
  },
  handlesFile(file) {
    return file.endsWith('/phantom.virt');
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
    }
    return undefined;
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


