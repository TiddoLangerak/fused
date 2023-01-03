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
import * as childProcess from 'node:child_process';
import { debug } from './debug.js';

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
    describe('fs.readdir', () => test(fs.readdir));
    describe('ls', () => test(async (path) => (await run(`ls ${path}`))[0].trim().split(/\s+/)));

    type ReaddirFn = (path: string) => Promise<string[]>;
    function test(readdirFn: ReaddirFn) {
      async function check(folder: string, expectedContent: string[]) {
        const path = mnt(folder);
        const content = await readdirFn(path);
        expect(content.sort()).toEqual(expectedContent.sort());
      }
      it('shows the correct folder content at root', () =>
         check('/', ["dir", "file", "foo"]));
      it('shows the correct folder content for virtual folders', () =>
         check('/foo', ["bar"]));
      it('shows the correct folder content for folders without virtual content', () =>
         check("/dir", ["foo"]));
    }
  });

  describe('access', () => {
    const checkRw = (file: string) =>
      fs.access(mnt(file), fs.constants.R_OK | fs.constants.W_OK);

    it('tests actual permissions for real files', () => checkRw('/file'));
    it('tests permissions for virtual files', () => checkRw('/foo/bar'));
    // TODO: test for read only
  });

  describe('appendFile', () => {
    describe('fs.appendFile', () => test(fs.appendFile));
    describe('sh -c "printf >> file"', () => test((path, content) => run(`printf "${content}" >> ${path}`)));

    type AppendFn = (file: string, content: string) => Promise<unknown>;
    function test(appendFn: AppendFn) {
      async function check(file: string, append: string, expected: DualReadResult) {
        await appendFn(mnt(file), append);
        await checkContents(file, expected);
      }

      it('Appends to actual files in the source & mnt tree', () =>
         check('/file', 'data', { mnt: 'filedata', src: 'filedata' }));
      it('Appends virtual files, without altering the source tree ', () =>
         check('/foo/bar', 'data', { mnt: 'contentdata', src: { err: 'ENOENT' }}));
    }


  });

  describe('stat', () => {
    let gid: number;
    let uid: number;

    beforeAll(async() => {
      const stat = await fs.lstat(mountRoot);
      gid = stat.gid;
      uid = stat.uid;
    });

    describe('fs.lstat', () => test(fs.stat));
    describe('file.stat', () => test(path => withFile(path, file => file.stat())));

    type StatFn = (file: string) => Promise<Stats>;
    function test(statFn: StatFn) {
      async function check(file: string, expected: Object) {
        const stat = await statFn(mnt(file));
        expect(stat).toMatchObject(expected);
      }
      async function checkReal(file: string) {
        // Not all properties will match exactly with the source, e.g. times get rounded to nearest ms.
        // So we only assert on those that match exactly
        const expected = pick(
          await fs.lstat(src(file)),
          ['atime', 'blksize', 'blocks', 'ctime', 'gid', 'mode', 'mtime', 'nlink', 'rdev', 'size', 'uid']
        );
        await check(file, expected);
      }

      it('Stats real files', () => checkReal('/file'));
      it('Stats virtual files', () => check('/foo/bar', {
        // Other props are hard to test, so we'll leave it at these for now
        size: "content".length,
        gid,
        uid,
        mode: S_IWUSR | S_IWGRP | S_IRUSR | S_IRGRP | S_IROTH | S_IFREG
      }));
      // TODO: readonly
    }

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

  describe('truncate', () => {
    describe('sh -c truncate', () => test((path, len) => run(`truncate -s ${len} ${path}`)));
    describe('truncate', () => test(fs.truncate));
    describe('file.truncate', () => test((path, len) => withFile(path, file => file.truncate(len))));

    type TruncateFn = (path: string, len: number) => Awaitable<unknown>;
    function test(truncateFn: TruncateFn) {
      async function check(path: string, len: number, results: DualReadResult) {
        await truncateFn(mnt(path), len);
        await checkContents(path, results);
      }

      it('fully truncates real files', () => check('/file', 0, { src: "", mnt: "" }));
      it('partially truncates real files', () => check('/file', 2, { src: "fi", mnt: "fi" }));
      it('fully truncates virtual files', () => check('/foo/bar', 0, { src: { err: "ENOENT" }, mnt: "" }));
      it('partially truncates virtual files', () => check('/foo/bar', 2, { src: { err: "ENOENT" }, mnt: "co" }));
    }
  });
  describe("utimes", () => {
    it("updates modification time", async () => {
      const newDate = new Date();

      // Due to floating point shenannigans, we should only work with whole seconds here.
      // This is more of a JS thing rather than a unix thing.
      // Without this we get rounding errors
      const unixDate = Math.floor(newDate.valueOf() / 1000);
      const expectedDate = new Date(unixDate * 1000);

      await fs.utimes(mnt("/foo/bar"), unixDate, unixDate);
      const stat = await fs.stat(mnt("/foo/bar"));

      expect(stat.atime).toEqual(expectedDate);
      expect(stat.mtime).toEqual(expectedDate);
    });
  });

  describe("rename", () => {
    async function checkUnsupported(src: string, dest: string) {
        // TODO: some caches apparently aren't cleared immediately.
      // Symptoms:
      // - /x and /foo/bar are on different devices (no they're not)
      // - ENOENT on /file
         await new Promise((resolve) => setTimeout(() => resolve(null), 100));
        expect(() => fs.rename(mnt(src), mnt(dest)))
          .rejects
          .toThrow("ENOSYS"); // TODO: error code
    }
    describe("real -> real", () => {
      it("Renames the files", async () => {
        await fs.rename(mnt("/file"), mnt("/newfile"));
        await checkContents("/newfile", { src: "file", mnt: "file" });
        await checkContents("/file", { src: { err: "ENOENT" }, mnt: { err: "ENOENT" } });
      });
    });
    describe("virtual -> real", () => {
      it("Is not supported", () => checkUnsupported("/foo/bar", "/x"));
    });
    describe("real -> virtual", () => {
      it("Is not supported", () => checkUnsupported("/file", "/foo/bar"));
    });
      // TODO: fix test, currently only have 1 virtual file
    describe.skip("virtual -> virtual", () => {
      it("Is not supported", () => checkUnsupported("/foo/bar", "/foo/baz"));
    });
  });
});

function run(command: string): Promise<[string, string]> {
  return new Promise((resolve, reject) => {
    debug("Running", command);
    childProcess.exec(command, (err, stdout, stderr) => err ? reject(err) : resolve([stdout, stderr]));
  });
}
