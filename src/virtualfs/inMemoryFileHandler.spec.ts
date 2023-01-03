import { InMemoryFileHandler } from "./inMemoryFileHandler.js";

describe('inMemoryFileHandler', () => {
  let handler = new InMemoryFileHandler('/foo/bar/baz', '12345');
  beforeEach(() => handler.content = '12345');

  describe('handles', () => {
    it('handles files with matching path', () => {
      expect(handler.handles('/foo/bar/baz')).toBe('self');
    });
    it('handles parent folders as fallbacks', () => {
      expect(handler.handles('/foo/bar')).toBe('other_with_fallback');
      expect(handler.handles('/foo')).toBe('other_with_fallback');
      expect(handler.handles('/')).toBe('other_with_fallback');
    });
    it(`doesn't handle files with different paths`, () => {
      expect(handler.handles('/for')).toBe('other');
      expect(handler.handles('/foo/bar/baz/qux')).toBe('other');
      expect(handler.handles('/bar')).toBe('other');
    });
  });

  describe('listFiles', () => {
    it('lists the file for the current folder', () => {
      expect(handler.listFiles('/foo/bar')).toEqual(['baz']);
    });
    it('list the path to the containing folder', () => {
      expect(handler.listFiles('/foo')).toEqual(['bar']);
      expect(handler.listFiles('/')).toEqual(['foo']);
    });
    it('returns empty when passed an unknown path',  () => {
      expect(handler.listFiles('/bar')).toEqual([]);
    });
  });

  describe('readFile', () => {
    it('returns the file content', () => {
      expect(handler.readFile('/foo/bar/baz')).toEqual('12345');
    });
    it('throws if the passed in folder has the wrong path',  () => {
      expect(() => handler.readFile('foo'))
      .rejects
      .toThrow();
    });
  });

  describe('writeFile', () => {
    it('changes the files content', () => {
      handler.writeFile('/foo/bar/baz', 'something new');
      expect(handler.content).toBe('something new');
      expect(handler.readFile('/foo/bar/baz')).toEqual('something new');
    });
    it('throws if the passed in folder has the wrong path',  () => {
      expect(() => handler.writeFile('foo', 'something new'))
      .rejects
      .toThrow();
    });
  });
});
