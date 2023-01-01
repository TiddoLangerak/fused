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
import { pick } from './util.js';

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
  const file = await fs.open(path, 'r+');
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
type DualReadResult = { src: ReadResult, mnt: ReadResult };

async function checkContent(fullPath: string, result: ReadResult) {
  const content = fs.readFile(fullPath, 'utf8');
  if (typeof result === 'string') {
    expect(await content).toEqual(result);
  } else {
    expect(() => content).rejects.toThrow(result.err);
  }
}

async function checkContents(path: string, results: DualReadResult) {
  const { mntPath, srcPath } = paths(path);
  await checkContent(mntPath, results.mnt);
  await checkContent(srcPath, results.src);
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

    async function check(file: string, append: string, expected: DualReadResult) {
      await fs.appendFile(mnt(file), append);
      await checkContents(file, expected);
    }

    it('Appends to actual files in the source & mnt tree', () =>
       check('/file', 'data', { mnt: 'filedata', src: 'filedata' }));
    it('Appends virtual files, without altering the source tree ', () =>
       check('/foo/bar', 'data', { mnt: 'contentdata', src: { err: 'ENOENT' }}));
  });

  describe('stat', () => {
    let gid: number;
    let uid: number;

    beforeAll(async() => {
      const stat = await fs.lstat(mountRoot);
      gid = stat.gid;
      uid = stat.uid;
    });

    type StatFn = (file: string) => Promise<Stats>;
    async function check(file: string, statFn: StatFn, expected: Object) {
      const stat = await statFn(mnt(file));
      expect(stat).toMatchObject(expected);
    }
    async function checkReal(file: string, statFn: StatFn) {
      // Not all properties will match exactly with the source, e.g. times get rounded to nearest ms.
      // So we only assert on those that match exactly
      const expected = pick(
        await fs.lstat(src(file)),
        ['atime', 'blksize', 'blocks', 'ctime', 'gid', 'mode', 'mtime', 'nlink', 'rdev', 'size', 'uid']
      );
      await check(file, statFn, expected);
    }

    describe('fs.lstat', () => {
      it('Stats real files', () => checkReal('/file', fs.stat));

      it('Stats virtual files', () => check('/foo/bar', fs.stat, {
        // Other props are hard to test, so we'll leave it at these for now
        size: "content".length,
        gid,
        uid,
        mode: S_IWUSR | S_IWGRP | S_IRUSR | S_IRGRP | S_IROTH | S_IFREG
      }));
      // TODO: readonly
    });

    describe('file.stat', () => {
      const fileStat = (path: string) => withFile(path, file => file.stat());

      it('Stats real files', () => checkReal('/file', fileStat));

      it('Stats virtual files', () => check('/foo/bar', fileStat, {
          // Other props are hard to test, so we'll leave it at these for now
          size: "content".length,
          gid,
          uid,
          mode: S_IWUSR | S_IWGRP | S_IRUSR | S_IRGRP | S_IROTH | S_IFREG
      }));

      // TODO: readonly
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

  describe.only('file.truncate', () => {
    async function check(path: string, len: number, results: DualReadResult) {
      await withFile(mnt(path), file => file.truncate(len));
      await checkContents(path, results);
    }

    it('fully truncates real files', () => check('/file', 0, { src: "", mnt: "" }));
    it('partially truncates real files', () => check('/file', 2, { src: "fi", mnt: "fi" }));
    it('fully truncates virtual files', () => check('/foo/bar', 0, { src: { err: "ENOENT" }, mnt: "" }));
    it('partially truncates virtual files', () => check('/foo/bar', 2, { src: { err: "ENOENT" }, mnt: "co" }));
  });
});
