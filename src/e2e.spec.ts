import { resolve } from 'path';
import { FusedHandle } from './lib.js';
import { InMemoryFileHandler } from './virtualfs/inMemoryFileHandler.js';
import * as fs from 'node:fs/promises';
import { Stats } from 'node:fs';
import { S_IFREG, S_IRGRP, S_IROTH, S_IRUSR, S_IWGRP, S_IWUSR } from 'node:constants';
import { Awaitable } from './awaitable.js';
import { pick } from './util.js';
import * as childProcess from 'node:child_process';
import { debug } from './debug.js';
import { exists, withFile } from './file.js';
import { DualReadResult, testFs } from './test/fs.js';
import './matchers/file.js';

const opts = {
  sourcePath: resolve(__dirname, '../test/src'),
  mountPath: resolve(__dirname, '../test/mnt')
};

const sourceFiles = {
  'dir/foo': 'foo',
  'file': 'file',
};

const virtualFiles = () => [
    new InMemoryFileHandler('/foo/bar', 'content'),
    new InMemoryFileHandler('/foo/baz', 'readonly content', { readonly: true })
];

const { mnt, src, paths, init, cleanup, checkContents } = testFs(
  opts,
  sourceFiles,
  virtualFiles
);

describe('fused', () => {
  let fusedHandle: FusedHandle;

  beforeEach(async () => fusedHandle = await init());
  afterEach(() => fusedHandle && cleanup(fusedHandle));

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
         check('/foo', ["bar", "baz"]));
      it('shows the correct folder content for folders without virtual content', () =>
         check("/dir", ["foo"]));
    }
  });

  describe('access', () => {
    const checkRw = (file: string) =>
      fs.access(mnt(file), fs.constants.R_OK | fs.constants.W_OK);
    const checkR = async (file: string) => {
      await fs.access(mnt(file), fs.constants.R_OK);
      await expect(() => fs.access(mnt(file), fs.constants.W_OK))
        .rejects
        .toThrow("EACCES");
    }

    it('tests actual permissions for real files', () => checkRw('/file'));
    it('tests permissions for virtual files', () => checkRw('/foo/bar'));
    it('tests permissions for readonly virtual files', () => checkR('/foo/baz'));
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
         check('/foo/bar', 'data', { mnt: 'contentdata', src: false}));
    }


  });

  describe('stat', () => {
    let gid: number;
    let uid: number;

    beforeAll(async() => {
      const stat = await fs.lstat(opts.mountPath);
      gid = stat.gid;
      uid = stat.uid;
    });

    describe('fs.lstat', () => test(fs.stat));
    describe('file.stat', () => test(path => withFile(path, 'r', file => file.stat())));

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
      it('Stats virtual readonly files', () => check('/foo/baz', {
        // Other props are hard to test, so we'll leave it at these for now
        size: "readonly content".length,
        gid,
        uid,
        mode: S_IRUSR | S_IRGRP | S_IROTH | S_IFREG
      }));
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
      expect(() => fs.rmdir(`${opts.mountPath}/foo`))
        .rejects
        .toThrow("EPERM");

      expect(`${opts.mountPath}/foo`).toExist();
    });
  });

  describe('truncate', () => {
    describe('sh -c truncate', () => test((path, len) => run(`truncate -s ${len} ${path}`)));
    describe('truncate', () => test(fs.truncate));
    describe('file.truncate', () => test((path, len) => withFile(path, 'r+', file => file.truncate(len))));

    type TruncateFn = (path: string, len: number) => Awaitable<unknown>;
    function test(truncateFn: TruncateFn) {
      async function check(path: string, len: number, results: DualReadResult) {
        await truncateFn(mnt(path), len);
        await checkContents(path, results);
      }

      it('fully truncates real files', () => check('/file', 0, { src: "", mnt: "" }));
      it('partially truncates real files', () => check('/file', 2, { src: "fi", mnt: "fi" }));
      it('fully truncates virtual files', () => check('/foo/bar', 0, { src: false, mnt: "" }));
      it('partially truncates virtual files', () => check('/foo/bar', 2, { src: false, mnt: "co" }));
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
      // It seems that some linux (lstat?) caches aren't cleared immediately.
      // Symptoms:
      // - /x and /foo/bar are on different devices (no they're not)
      // - ENOENT on /file
      //
      // To avoid this, we first check if mnt(src) exists, which seems to force an update
      await exists(mnt(src));
      expect(() => fs.rename(mnt(src), mnt(dest)))
        .rejects
        .toThrow("ENOSYS");
    }
    describe("real -> real", () => {
      it("Renames the files", async () => {
        await fs.rename(mnt("/file"), mnt("/newfile"));
        await checkContents("/newfile", { src: "file", mnt: "file" });
        await checkContents("/file", { src: false, mnt: false });
      });
    });
    describe("virtual -> real", () => {
      it("Is not supported", () => checkUnsupported("/foo/bar", "/x"));
    });
    describe("real -> virtual", () => {
      it("Is not supported", () => checkUnsupported("/file", "/foo/bar"));
    });
    describe("virtual -> virtual", () => {
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
