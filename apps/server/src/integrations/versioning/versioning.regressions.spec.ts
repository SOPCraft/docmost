import { readVersioningConfig } from './versioning.config';
import { canonicalJson } from './version-snapshot';

describe('capture review regressions', () => {
  it.each(['5000\n', '5000\r\n', '5000\t', ' 5000'])(
    'rejects whitespace in configured wait',
    (value) => {
      expect(() =>
        readVersioningConfig({
          SOP_VERSION_CAPTURE_ENABLED: 'true',
          SOP_VERSION_DEBOUNCE_MS: value,
        }),
      ).toThrow();
    },
  );
  it('keeps special object keys as data without prototype mutation', () => {
    const source = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":"data"}',
    );
    expect(JSON.parse(canonicalJson(source))).toEqual(source);
    expect(({} as any).polluted).toBeUndefined();
  });
  it('rejects class instances instead of invoking custom serialization', () => {
    class HiddenData {
      toJSON() {
        return 'dropped';
      }
    }
    expect(() => canonicalJson(new HiddenData())).toThrow();
  });
});
