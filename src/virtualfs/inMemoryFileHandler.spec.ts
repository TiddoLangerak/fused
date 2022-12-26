import { InMemoryFileHandler } from "./inMemoryFileHandler.js";

describe('inMemoryFileHandler', () => {
  const handler = new InMemoryFileHandler('/foo/bar/baz', '12345');
  beforeEach(() => handler.content = '12345');

  describe('handles', () => {
    it('handles files with matching path', async () => {
      expect(await handler.handlesFile('/foo/bar/baz')).toBe(true);
    });
    it(`doesn't handle files with different paths`, async () => {
      expect(await handler.handlesFile('/foo')).toBe(false);
      expect(await handler.handlesFile('/foo/bar/baz/qux')).toBe(false);
      expect(await handler.handlesFile('/bar')).toBe(false);
    });
  });

  // TODO: handlesFolder
  describe('listFiles', () => {
    it('lists the file for the current folder', async () => {
      expect(await handler.listFiles('/foo/bar')).toEqual(['baz']);
    });
    it('throws if the passed in folder has the wrong path', () => {
      expect(async() => await handler.listFiles('foo')).toThrow();
    });
  });

  describe('readFile', () => {
    it('returns the file content', async () => {
      expect(await handler.readFile('/foo/bar/baz')).toEqual(['12345']);
    });
    it('throws if the passed in folder has the wrong path', () => {
      expect(async() => await handler.readFile('foo')).toThrow();
    });
  });

  describe('writeFile', () => {
    it('changes the files content', async () => {
      await handler.writeFile('/foo/bar/baz', 'something new');
      expect(handler.content).toBe('something new');
      expect(await handler.readFile('/foo/bar/baz')).toEqual(['something new']);
    });
    it('throws if the passed in folder has the wrong path', () => {
      expect(async() => await handler.writeFile('foo', 'something new')).toThrow();
    });
  });
});
