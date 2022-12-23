const enableDebug = !!process.env.FUSED_DEBUG || false;

export const debug = enableDebug
  ? (...args: any[]) => console.log(...args)
  : (...args: any[]) => {}
