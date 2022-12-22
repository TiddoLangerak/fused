const enableDebug = !!process.env.FUSED_DEBUG || false;

export function debug(...args: any[]) {
  if (enableDebug) {
    console.log(...args);
  }
}

