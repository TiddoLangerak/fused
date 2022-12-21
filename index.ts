import Fuse from 'fuse-native';
import * as fs from 'fs';

const mountPath = "./mnt";

const fuse = new Fuse(mountPath, {}, { force: true, mkdir: true, autoUnmount: true });

fuse.mount(err => {
  console.log("Err?", err);
  console.log(Fuse.ENOENT);
});

process.on('SIGINT', (code) => {
  Fuse.unmount(mountPath, (err) => {
    if(err) {
      process.exit(-1);
    }
    process.exit(0);
  });
});
