import { readFile } from "fs/promises";
import { diff } from 'jest-diff';
import { exists } from "../file";

async function toHaveContent(
  this: jest.MatcherContext,
  fullPath: string,
  expected: string
) {
  const hintOpts = {
    isNot: this.isNot,
    promise: this.promise,
  };

  const hint =
    this.utils.matcherHint("toHaveContent", "path", "content", hintOpts) +
    "\n\n";

  const content = await readFile(fullPath, 'utf8');
  const match = content === expected;
  const message = match
    ? `${hint}Expected file content for ${fullPath} to not match.`
    : `${hint}Expected file content for ${fullPath} to match.`
      + `\n\n${diff(expected, content)}`
  return {
    pass: match,
    message: () => message
  }
}

async function toExist(
  this: jest.MatcherContext,
  fullPath: string
) {
  const hintOpts = {
    isNot: this.isNot,
    promise: this.promise,
  };

  const hint =
    this.utils.matcherHint("toExist", "path", undefined, hintOpts) +
    "\n\n";

  const fileExists = await exists(fullPath);
  const message = fileExists
    ? `${hint}Expected file ${fullPath} to not exist.`
    : `${hint}Expected file ${fullPath} to exist.`;
  return {
    pass: fileExists,
    message: () => message
  };
}

expect.extend({
  toHaveContent,
  toExist
});

declare global {
  namespace jest {
    interface Matchers<R> {
      toHaveContent(expected: string): Promise<CustomMatcherResult>;
      toExist(): Promise<CustomMatcherResult>;
    }
  }
}
