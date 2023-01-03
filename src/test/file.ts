import '../matchers/file.js';

export type ReadResult = string | false;
export async function checkContent(fullPath: string, result: ReadResult) {
  if (result === false) {
    await expect(fullPath).not.toExist();
  } else {
    await expect(fullPath).toHaveContent(result);
  }
}

