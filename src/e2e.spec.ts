import { dirname, join, resolve } from 'path';
import { FusedHandle, main } from './lib.js';
import { ProgramOpts } from './opts.js';
import { InMemoryFileHandler } from './virtualfs/inMemoryFileHandler.js';
import * as fs from 'node:fs/promises';
import rimraf from 'rimraf';
import { Stats } from 'node:fs';
import { S_IFREG, S_IRGRP, S_IROTH, S_IRUSR, S_IWGRP, S_IWUSR } from 'node:constants';
import { FileHandle } from 'node:fs/promises';
import { Awaitable } from './awaitable.js';

const sourceRoot = resolve(__dirname, '../test/src')
const mountRoot = resolve(__dirname, '../test/mnt');
const opts: ProgramOpts = { sourcePath: sourceRoot, mountPath: mountRoot };

const sourceFiles = {
  'dir/foo': 'foo',
  'file': 'file',
};

// TODO: organize all the helpers

async function setupFileSystem(): Promise<FusedHandle> {
  const files = [
    new InMemoryFileHandler('/foo/bar', 'content')
  ];
  await createFileTree(sourceRoot);
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

function paths(path: string) {
  return {
    srcPath: src(path),
    mntPath: mnt(path)
  };
}

function mnt(path: string) {
  return join(mountRoot, path);
}

function src(path: string) {
  return join(sourceRoot, path);
}

type ReadResult = string | { err: string };
async function checkContent(fullPath: string, result: ReadResult) {
  const content = fs.readFile(fullPath, 'utf8');
  if (typeof result === 'string') {
    expect(await content).toEqual(result);
  } else {
    expect(() => content).rejects.toThrow(result.err);
  }
}

async function rmrf(path: string) {
  await new Promise((resolve, reject) => rimraf(path, err => err ? reject(err) : resolve(undefined)));
}

async function createFileTree(sourcePath: string) {
  await rmrf(sourcePath);
  await fs.mkdir(sourcePath, { recursive: true });

  for (let [path, content] of Object.entries(sourceFiles)) {
    const dir = dirname(path);
    if (dir) {
      await fs.mkdir(resolve(sourcePath, dir), { recursive: true });
    }
    await fs.writeFile(resolve(sourcePath, path), content);
  }
}

async function cleanup(handle: FusedHandle) {
  await handle.unmount();
  await rmrf(sourceRoot);
}

describe('fused', () => {
  let fusedHandle: FusedHandle;
  beforeEach(async () => fusedHandle = await setupFileSystem());
  afterEach(() => cleanup(fusedHandle));

  describe("readdir", () => {
    async function check(folder: string, expectedContent: string[]) {
      const path = mnt(folder);
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
    const checkRw = (file: string) =>
      fs.access(mnt(file), fs.constants.R_OK | fs.constants.W_OK);

    it('tests actual permissions for real files', () => checkRw('/file'));
    it('tests permissions for virtual files', () => checkRw('/foo/bar'));
    // TODO: test for read only
  });

  describe('appendFile', () => {
    type Expected = { src: ReadResult, mnt: ReadResult };

    async function check(file: string, append: string, expected: Expected) {
      const { mntPath, srcPath } = paths(file);
      await fs.appendFile(mntPath, append);

      checkContent(srcPath, expected.src);
      checkContent(mntPath, expected.mnt);
    }

    it('Appends to actual files in the source & mnt tree', () =>
       check('/file', 'data', { mnt: 'filedata', src: 'filedata' }));
    it('Appends virtual files, without altering the source tree ', () =>
       check('/foo/bar', 'data', { mnt: 'contentdata', src: { err: 'ENOENT' }}));
  });

  describe('lstat', () => {
    describe('Stats real files', () => {
      let realStat: Stats;
      let mntStat: Stats;
      beforeEach(async () => {
        realStat = await fs.lstat(`${sourceRoot}/file`);
        mntStat = await fs.lstat(`${mountRoot}/file`);
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
      const { gid, uid } = await fs.lstat(mountRoot);
      const stat = await fs.lstat(`${mountRoot}/foo/bar`);
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
        realStat = await withFile(`${sourceRoot}/file`, file => file.stat());
        mntStat = await withFile(`${mountRoot}/file`, file => file.stat());
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
      const { gid, uid } = await fs.lstat(mountRoot);
      const stat = await withFile(`${mountRoot}/foo/bar`, file => file.stat());
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
      const { mntPath, srcPath } = paths(folder);
      await fs.mkdir(mntPath);
      expect((await fs.lstat(srcPath)).isDirectory()).toBe(true);
      expect((await fs.lstat(mntPath)).isDirectory()).toBe(true);

      await fs.rmdir(mntPath);
      expect(() => fs.lstat(mntPath))
        .rejects
        .toThrow("ENOENT");
      expect(() => fs.lstat(srcPath))
        .rejects
        .toThrow("ENOENT");
    }

    it('creates & removes real folders', () => check('bla'));
    it('creates & removes real folders through virtual folders', () => check('foo/foo'));

    it(`can't remove virtual folders`, async () => {
      expect(() => fs.rmdir(`${mountRoot}/foo`))
        .rejects
        .toThrow("EPERM");

      // Just checking that it doesn't error
      await fs.lstat(`${mountRoot}/foo`);
    });
  });
});
