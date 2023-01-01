import { basename, dirname, join, resolve } from 'path';
// TODO: move main to separate file
import { FusedHandle, main, Unmount } from './lib.js';
import { ProgramOpts } from './opts.js';
import { InMemoryFileHandler } from './virtualfs/inMemoryFileHandler.js';
import * as fs from 'node:fs/promises';
import rimraf from 'rimraf';
import { Stats } from 'node:fs';
import { S_IFREG, S_IRGRP, S_IROTH, S_IRUSR, S_IWGRP, S_IWUSR } from 'node:constants';
import { FileHandle } from 'node:fs/promises';
import { Awaitable } from './awaitable.js';

const sourcePath = resolve(__dirname, '../test/src')
const mountPath = resolve(__dirname, '../test/mnt');
const opts: ProgramOpts = { sourcePath, mountPath };

const sourceFiles = {
  'dir/foo': 'foo',
  'file': 'file',
};

async function setupFileSystem(): Promise<FusedHandle> {
  const files = [
    new InMemoryFileHandler('/foo/bar', 'content')
  ];
  await createFileTree(sourcePath);
  return await main(opts, files);
}


// TODO: Something properly crashes when we open a file but not close it.
// Can we test this?

async function withFile<T>(path: string, cb: ((file: FileHandle)=> Awaitable<T>)): Promise<T> {
  const file = await fs.open(path);
  try {
    return await cb(file);
  } finally {
    await file.close();
  }
}


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

async function cleanup(handle: FusedHandle) {
  await handle.unmount();
  await rmrf(sourcePath);
}

describe('fused', () => {
  let fusedHandle: FusedHandle;
  beforeEach(async () => fusedHandle = await setupFileSystem());
  afterEach(() => cleanup(fusedHandle));

  describe("readdir", () => {
    async function check(folder: string, expectedContent: string[]) {
      const path = join(mountPath, folder);
      const content = await fs.readdir(path);
      expect(content.sort()).toEqual(expectedContent.sort());
    }
    it('shows the correct folder content at root', () =>
       check('/', ["dir", "file", "foo"]));
    it('shows the correct folder content for virtual folders', () =>
       check('/foo', ["bar"]));
    it('shows the correct folder content for folders without virtual content', () =>
       check("/dir", ["foo"]));
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
        it(`.${field}`, async () => {
          expect(mntStat[field]).toEqual(realStat[field])
        });
      }
    });

    it('Stats virtual files', async () => {
      const { gid, uid } = await fs.lstat(mountPath);
      const stat = await fs.lstat(`${mountPath}/foo/bar`);
      expect(stat).toMatchObject({
        // Other props are hard to test...
        size: "content".length,
        gid,
        uid,
        mode: S_IWUSR | S_IWGRP | S_IRUSR | S_IRGRP | S_IROTH | S_IFREG
      });
      // TODO: test readonly files
    });
  });

  describe('file.stat', () => {
    describe('Stats real files', () => {
      let realStat: Stats;
      let mntStat: Stats;
      // TODO: can we do beforeall?
      beforeEach(async () => {
        realStat = await withFile(`${sourcePath}/file`, file => file.stat());
        mntStat = await withFile(`${mountPath}/file`, file => file.stat());
      });
      // Not all fields match.
      // E.g. all ms times get rounded
      const matchingFields: (keyof Stats)[] = [
        'atime', 'blksize', 'blocks', 'ctime', 'gid', 'mode', 'mtime', 'nlink', 'rdev', 'size', 'uid'
      ];
      for (const field of matchingFields) {
        it(`.${field}`, async () => {
          expect(mntStat[field]).toEqual(realStat[field])
        });
      }
    });

    // TODO: I wanted to test fgetattr, but it seems this isn't triggered due to kernel bug:
    // https://github.com/libfuse/libfuse/issues/62
    it('Stats virtual files', async () => {
      const { gid, uid } = await fs.lstat(mountPath);
      const stat = await withFile(`${mountPath}/foo/bar`, file => file.stat());
      expect(stat).toMatchObject({
        // Other props are hard to test...
        size: "content".length,
        gid,
        uid,
        mode: S_IWUSR | S_IWGRP | S_IRUSR | S_IRGRP | S_IROTH | S_IFREG
      });
      // TODO: test readonly files
    });
  });

  describe('mkdir/rmdir', () => {
    async function check(folder: string) {
      const inMnt = join(mountPath, folder);
      const inSrc = join(sourcePath, folder);
      await fs.mkdir(inMnt);
      expect((await fs.lstat(inSrc)).isDirectory()).toBe(true);
      expect((await fs.lstat(inMnt)).isDirectory()).toBe(true);

      await fs.rmdir(inMnt);
      expect(() => fs.lstat(inMnt))
        .rejects
        .toThrow("ENOENT");
      expect(() => fs.lstat(inSrc))
        .rejects
        .toThrow("ENOENT");
    }

    it('creates & removes real folders', () => check('bla'));
    it('creates & removes real folders through virtual folders', () => check('foo/foo'));

    it(`can't remove virtual folders`, async () => {
      expect(() => fs.rmdir(`${mountPath}/foo`))
        .rejects
        .toThrow("EPERM");

      // Just checking that it doesn't error
      await fs.lstat(`${mountPath}/foo`);
    });
  });
});
