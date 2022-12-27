import { VirtualFs, InMemoryFileHandler } from "./virtualfs/index.js";

describe('virtualFs', () => {
  describe('list', () => {
    const fs = new VirtualFs(new InMemoryFileHandler('/foo/bar', 'content'), 1, 1);
    it('lists files returned by its handlers', async () => {
      expect(await fs.readdir("/foo")).toEqual(["bar"]);
    });
    it(`doesn't list files in other folders`, async () => {
      expect(await fs.readdir("/bar")).toEqual([]);
    });
  });
});
