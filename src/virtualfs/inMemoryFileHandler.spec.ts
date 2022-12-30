import { InMemoryFileHandler } from "./inMemoryFileHandler.js";

describe('inMemoryFileHandler', () => {
  let handler = new InMemoryFileHandler('/foo/bar/baz', '12345');
  beforeEach(() => handler.content = '12345');

  describe('handles', () => {
    it('handles files with matching path', async () => {
      expect(await handler.handles('/foo/bar/baz')).toBe('self');
    });
    it('handles parent folders as fallbacks', async() => {
      expect(await handler.handles('/foo/bar')).toBe('other_with_fallback');
      expect(await handler.handles('/foo')).toBe('other_with_fallback');
      expect(await handler.handles('/')).toBe('other_with_fallback');
    });
    it(`doesn't handle files with different paths`, async () => {
      expect(await handler.handles('/for')).toBe('other');
      expect(await handler.handles('/foo/bar/baz/qux')).toBe('other');
      expect(await handler.handles('/bar')).toBe('other');
    });
  });

  // TODO: handlesFolder
  describe('listFiles', () => {
    it('lists the file for the current folder', async () => {
      expect(await handler.listFiles('/foo/bar')).toEqual(['baz']);
    });
    it('list the path to the containing folder', async () => {
      await expect(await handler.listFiles('/foo')).toEqual(['bar']);
      await expect(await handler.listFiles('/')).toEqual(['foo']);
    });
    it('returns empty when passed an unknown path', async () => {
      await expect(await handler.listFiles('/bar')).toEqual([]);
    });
  });

  describe('readFile', () => {
    it('returns the file content', async () => {
      expect(await handler.readFile('/foo/bar/baz')).toEqual('12345');
    });
    it('throws if the passed in folder has the wrong path', async () => {
      await expect(async() => await handler.readFile('foo'))
        .rejects
        .toThrow();
    });
  });

  describe('writeFile', () => {
    it('changes the files content', async () => {
      await handler.writeFile('/foo/bar/baz', 'something new');
      expect(handler.content).toBe('something new');
      expect(await handler.readFile('/foo/bar/baz')).toEqual('something new');
    });
    it('throws if the passed in folder has the wrong path', async () => {
      await expect(async() => await handler.writeFile('foo', 'something new'))
        .rejects
        .toThrow();
    });
  });
});
