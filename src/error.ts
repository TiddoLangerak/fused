import Fuse from "fuse-native";

export class IOError extends Error {
  constructor(public errno: number, msg: string) {
    super(msg);
  }
}

export class FileNotFoundError extends IOError {
  constructor(file: string) {
    super(Fuse.ENOENT, `File not found: ${file}`);
  }
}
