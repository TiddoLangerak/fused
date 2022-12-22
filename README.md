# UNDER CONSTRUCTION

## Fused: virtual file system overlay

Fused reduces config duplication by overlaying "virtual files" onto the file system.

Fused creates a new virtual file system, backed by some source folder, and adds virtual files on top of this. The virtual files don't actually exist on disk, but to any tool - npm, webpack, jest - it will appear to be there. These files are dynamically "generated" when requested. This allows us to avoid copying package.json, tsconfigs, etc. to every subpackage that would otherwise need them.

Usage:

```
fused source mount
```

Note: currently it's just a transparent layer, we don't yet have the generation of files.

