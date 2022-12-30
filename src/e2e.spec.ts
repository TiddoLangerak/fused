import { basename, dirname, resolve } from 'path';
// TODO: move main to separate file
import { main } from './lib.js';
import { ProgramOpts } from './opts.js';
import { InMemoryFileHandler } from './virtualfs/inMemoryFileHandler.js';
import * as fs from 'node:fs/promises';
import rimraf from 'rimraf';
import { Stats } from 'node:fs';

const sourcePath = resolve(__dirname, '../test/src')
const mountPath = resolve(__dirname, '../test/mnt');

const sourceFiles = {
  'dir/foo': 'foo',
  'file': 'file',
};

async function rmrf(path: string) {
  await new Promise((resolve, reject) => rimraf(sourcePath, err => err ? reject(err) : resolve(undefined)));
}

async function createFileTree(sourcePath: string) {
  await rmrf(sourcePath);
  await fs.mkdir(sourcePath, { recursive: true });

  for (let [path, content] of Object.entries(sourceFiles)) {
    const dir = dirname(path);
    const file = basename(path);
    if (dir) {
      await fs.mkdir(resolve(sourcePath, dir), { recursive: true });
    }
    await fs.writeFile(resolve(sourcePath, path), content);
  }
}


const opts: ProgramOpts = { sourcePath, mountPath };
const files = [
  new InMemoryFileHandler('/foo/bar', 'content')
];

describe('fused', () => {
  let unmount: undefined | (()=>void);
  beforeEach(async () => {
    await createFileTree(sourcePath);
    unmount = (await main(opts, files)).unmount;
  })
  afterEach(async () => {
    unmount && await unmount();
    await rmrf(sourcePath);
  });

  describe("readdir", () => {
    it('shows the correct folder content at root', async () => {
      const content = await fs.readdir(mountPath);
      expect(content.sort()).toEqual(["dir", "file", "foo"]);
    });
    it('shows the correct folder content for virtual folders', async () => {
      const content = await fs.readdir(`${mountPath}/foo`);
      expect(content.sort()).toEqual(["bar"]);
    });
    it('shows the correct folder content for folders without virtual content', async () => {
      const content = await fs.readdir(`${mountPath}/dir`);
      expect(content.sort()).toEqual(["foo"]);
    });
  });

  describe('access', () => {
    it('tests actual permissions for real files', async () => {
      await fs.access(`${mountPath}/file`, fs.constants.R_OK | fs.constants.W_OK);
    });
    it('tests actual permissions for real files', async () => {
      await fs.access(`${mountPath}/foo/bar`, fs.constants.R_OK | fs.constants.W_OK);
    });
    // TODO: test for read only
  });

  describe('appendFile', () => {
    it('Appends to actual files in the source & mnt tree', async () => {
      await fs.appendFile(`${mountPath}/file`, 'data');
      const srcContent = await fs.readFile(`${sourcePath}/file`, 'utf8');
      expect(srcContent).toEqual('filedata');
      const mntContent = await fs.readFile(`${mountPath}/file`, 'utf8');
      expect(mntContent).toEqual('filedata');
    });
    it('Appends virtual files, without altering the source tree ', async () => {
      await fs.appendFile(`${mountPath}/foo/bar`, 'data');
      const mntContent = await fs.readFile(`${mountPath}/foo/bar`, 'utf8');
      expect(mntContent).toEqual('contentdata');
      expect(() => fs.readFile(`${sourcePath}/foo/bar`, 'utf8'))
        .rejects
        .toThrow('ENOENT');
    });
  });

  describe('lstat', () => {
    describe('Stats real files', () => {
      let realStat: Stats;
      let mntStat: Stats;
      beforeEach(async () => {
        realStat = await fs.lstat(`${sourcePath}/file`);
        mntStat = await fs.lstat(`${mountPath}/file`);
      });
      // Not all fields match.
      // E.g. all ms times get rounded
      const matchingFields: (keyof Stats)[] = [
        'atime', 'blksize', 'blocks', 'ctime', 'gid', 'mode', 'mtime', 'nlink', 'rdev', 'size', 'uid'
      ];
      for (const field of matchingFields) {
        it(`.${field}`, async () =>
          expect(mntStat[field]).toEqual(realStat[field])
        );
      }
    });
  });

});
