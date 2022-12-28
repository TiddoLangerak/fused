import { getProgramOpts } from './opts.js';
import { VirtualFileHandler } from './virtualfs/index.js';
import { main } from './lib.js';

const opts = await getProgramOpts();
const handler: VirtualFileHandler = {
  handles(path) {
    if (path.endsWith('/phantom.virt')) {
      return 'self';
    }
    return 'other_with_fallback';
  },
  listFiles(folder) {
    return ['phantom.virt'];
  },
  readFile(path) {
    return 'Phantom data';
  },
  writeFile(_path, _content) {
    // dev nulling
    console.log("Written", _path, _content.toString(), _content.length);
    return;
  },
  stat(path) {
    if (path.endsWith('/phantom.virt')) {
      return {
        type: 'file',
        writeable: true,
//        writeable: false,
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

main(opts, [handler]);






