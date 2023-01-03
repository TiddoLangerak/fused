import { Stat } from "fuse-native";
import { Awaitable } from "../awaitable.js";
import { Handles } from "../handlers.js";

export type FileContent = string | Buffer;
export { Stat };

export type MiniStat = {
  type: 'file',
  writeable: boolean,
  modificationTime: Date,
  size: number,
  executable: boolean
} | {
  type: 'folder',
}


// TODO: can probably do better by exposing a more complete interface, involving absolute + relative aths
// TODO: cachable?
export type VirtualFileHandler = {
  handles(path: string): Awaitable<Handles>;
  listFiles(folder: string): Awaitable<string[]>;
  readFile(path: string): Awaitable<FileContent>;
  writeFile(path: string, content: Buffer): Awaitable<void>;
  stat: (path: string) => Awaitable<MiniStat>;
  updateModificationTime?: (path: string, modificationTime: Date) => Awaitable<void>;
}

