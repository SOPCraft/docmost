import { readVersioningConfig } from './versioning.config';

describe('version capture configuration', () => {
  it('preserves upstream timings and makes capture opt-in', () => {
    expect(readVersioningConfig({})).toEqual({
      enabled: false,
      debounceMs: 10000,
      maxDebounceMs: 45000,
    });
  });
  it('uses five seconds and a thirty second maximum only when enabled', () => {
    expect(
      readVersioningConfig({ SOP_VERSION_CAPTURE_ENABLED: 'true' }),
    ).toEqual({ enabled: true, debounceMs: 5000, maxDebounceMs: 30000 });
  });
  it('does not mutate the supplied environment', () => {
    const env = Object.freeze({ SOP_VERSION_CAPTURE_ENABLED: 'true' });
    expect(Object.isFrozen(readVersioningConfig(env))).toBe(true);
  });
  it('ignores inactive timing options', () => {
    expect(
      readVersioningConfig({
        SOP_VERSION_CAPTURE_ENABLED: 'false',
        SOP_VERSION_DEBOUNCE_MS: 'bad',
      }).debounceMs,
    ).toBe(10000);
  });
  it.each(['yes', '1', 'TRUE', ' true '])(
    'rejects ambiguous opt-in %s',
    (flag) => {
      expect(() =>
        readVersioningConfig({ SOP_VERSION_CAPTURE_ENABLED: flag }),
      ).toThrow();
    },
  );
  it.each(['', '0', '999', '-1', '1.5', '60001', 'NaN', 'Infinity', '5000ms'])(
    'rejects invalid wait %s',
    (value) => {
      expect(() =>
        readVersioningConfig({
          SOP_VERSION_CAPTURE_ENABLED: 'true',
          SOP_VERSION_DEBOUNCE_MS: value,
        }),
      ).toThrow();
    },
  );
  it('rejects a maximum shorter than the debounce', () => {
    expect(() =>
      readVersioningConfig({
        SOP_VERSION_CAPTURE_ENABLED: 'true',
        SOP_VERSION_MAX_DEBOUNCE_MS: '1000',
      }),
    ).toThrow();
  });
  it('accepts both range boundaries', () => {
    expect(
      readVersioningConfig({
        SOP_VERSION_CAPTURE_ENABLED: 'true',
        SOP_VERSION_DEBOUNCE_MS: '1000',
        SOP_VERSION_MAX_DEBOUNCE_MS: '1000',
      }).debounceMs,
    ).toBe(1000);
    expect(
      readVersioningConfig({
        SOP_VERSION_CAPTURE_ENABLED: 'true',
        SOP_VERSION_DEBOUNCE_MS: '60000',
        SOP_VERSION_MAX_DEBOUNCE_MS: '300000',
      }).maxDebounceMs,
    ).toBe(300000);
  });
  it('rejects a maximum beyond the supported bound', () => {
    expect(() =>
      readVersioningConfig({
        SOP_VERSION_CAPTURE_ENABLED: 'true',
        SOP_VERSION_MAX_DEBOUNCE_MS: '300001',
      }),
    ).toThrow();
  });
});
