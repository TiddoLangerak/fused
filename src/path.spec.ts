import { PathNotInSourceError, RecursiveMountingError, srcPathResolver } from './path.js';

describe('resolver', () => {
  const sourcePath = '/my/src';
  const mountPath = ' /their/mount';
  const res = srcPathResolver({ sourcePath, mountPath });

  it('resolves paths relative to the source path', () => {
    expect(res('foo')).toBe('/my/src/foo');
    expect(res('/foo')).toBe('/my/src/foo');
    expect(res('./foo')).toBe('/my/src/foo');
    expect(res('///foo')).toBe('/my/src/foo');
    expect(res('foo/bar')).toBe('/my/src/foo/bar');
  });

  it('errors when the resolved path would be outside of the source', () => {
    expect(() => res('../foo')).toThrow(PathNotInSourceError);
  })

  it('errors when the resolved path is inside the mount path', () => {
    // Need to use same source and mount path here, otherwise we can never end up in this situation (we'd get a PathNotInSourceError instead)
    const res = srcPathResolver({ sourcePath, mountPath: sourcePath });
    expect(() => res('./foo')).toThrow(RecursiveMountingError);
  });
});

