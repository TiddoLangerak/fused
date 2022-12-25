import { VirtualFs, InMemoryFileHandler } from "./virtualfs";

describe('virtualFs', () => {
  describe('list', () => {
    const fs = new VirtualFs();
    fs.registerHandler(new InMemoryFileHandler("/foo/bar", "content"));
    fs.registerHandler(new InMemoryFileHandler("/foo/baz", "content"));
    it('lists files returned by its handlers', async () => {
      expect(await fs.readdir("/foo")).toEqual(["bar", "baz"]);
    });
    it(`doesn't list files in other folders`, async () => {
      expect(await fs.readdir("/bar")).toEqual([]);
    });
  });
});
