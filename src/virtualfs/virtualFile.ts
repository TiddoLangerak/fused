import { Stat } from "fuse-native";
import { Awaitable } from "../awaitable.js";

export type FileContent = string | Buffer;
export { Stat };

// TODO: enhance
export type MiniStat = {
  type: 'file',
  writeable: boolean,
  modificationTime: Date,
  size: number,
  executable: boolean
} | {
  type: 'folder',
}

export type Handler = 'self' | 'other' | 'other_with_fallback';

// TODO: can probably do better by exposing a more complete interface, involving absolute + relative aths
// TODO: cachable?
export type VirtualFileHandler = {
  handles(path: string): Awaitable<Handler>;
  listFiles(folder: string): Awaitable<string[]>;
  // TODO: error handling
  readFile(path: string): Awaitable<FileContent | undefined>;
  writeFile(path: string, content: FileContent): Awaitable<void>;
  stat: (path: string) => Awaitable<MiniStat>
}

