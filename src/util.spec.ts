import { pick } from "./util.js";

describe('pick', () => {
  function check<T>(input: T, fields: (keyof T)[], output: Object) {
    expect(pick(input, fields)).toEqual(output);
  }

  it('picks an empty object', () => check({}, [], {}));
  it('picks known keys', () => check({x: 3, y: 4, z: 5}, ['x', 'y'], {x: 3, y: 4}));
  it('ignores unknown keys', () => check({x: 3}, ['x', 'y'] as any[], {x: 3}));
});
