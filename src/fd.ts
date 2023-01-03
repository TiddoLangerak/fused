/// For whatever reason the reference is needed for the language-server
/// <reference path="../types/fuse-native.d.ts" />
import Fuse from "fuse-native";
import { Fd } from "./handlers.js";

const MAX_FD = Math.pow(2, 31) - 1;
const MAX_FD_ATTEMPTS = 1024;

export class FdMapper<T> {
  #nextFd: Fd = 1;
  #fdMap: Map<Fd, T> = new Map();

  insert(file: T): Fd {
    const upstream = this.#getNextFreeFd();
    this.#fdMap.set(upstream, file);
    return upstream;
  }

  get(upstream: Fd): T | undefined {
    return this.#fdMap.get(upstream);
  }

  clear(fd: Fd) {
    this.#fdMap.delete(fd);
  }

  #getNextFreeFd(): Fd {
    // High-level: we just take the next successive FD available.
    // Edge-cases:
    // - On overflow, we wrap around to 1
    // - Because we wrap around, we need to ensure we haven't already issued the FD
    // - If we have already issued the fd, then we skip to the next one (repeatedly)
    // - To protect ourselves against edge cases and infinite loops, we cap the number of attempts we take to get the next FD. If we can't find it on time, we return an ENFILE error (no more FDs available)
    for (let attempt = 0; attempt < MAX_FD_ATTEMPTS; attempt++) {
      const candidate = this.#nextFd;
      this.#incrementFd();
      if (!this.#fdMap.has(candidate)) {
        return candidate;
      }
    }
    throw new NoFdAvailableError();
  }

  #incrementFd() {
      this.#nextFd = ((this.#nextFd + 1) % MAX_FD) || 1;
  }

}

export class NoFdAvailableError extends Error {
  errno = Fuse.ENFILE; // Error code that we've run out of fds.
  constructor() {
    super("No file descriptors available");
  }
}
