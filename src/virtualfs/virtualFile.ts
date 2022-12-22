import { Stat } from "fuse-native";
import { Awaitable } from "../awaitable";

export type FileContent = string | Buffer;
export { Stat };
// TODO: can probably do better by exposing a more complete interface, involving absolute + relative aths
// TODO: cachable?
export type VirtualFileHandler = {
  handles(folder: string, file?: string): Awaitable<boolean>;
  listFiles(folder: string): Awaitable<string[]>;
  // TODO: error handling
  readFile(path: string): Awaitable<FileContent | undefined>;
  writeFile(path: string, content: FileContent): Awaitable<void>;
  stat?: () => Awaitable<Partial<Stat>>
}

