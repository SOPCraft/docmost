import { randomUUID } from 'node:crypto';
import { readGiteaConfig } from './gitea.config';

const valid = () => ({
  SOP_VERSION_CAPTURE_ENABLED: 'true',
  SOP_GITEA_SYNC_ENABLED: 'true',
  SOP_GITEA_URL: 'https://versions.example.invalid',
  SOP_GITEA_TOKEN: 'test-only-not-a-real-token',
  SOP_GITEA_INSTANCE_ID: randomUUID(),
});
describe('Gitea transport configuration', () => {
  it('is disabled by default without requesting credentials', () =>
    expect(readGiteaConfig({})).toMatchObject({ enabled: false }));
  it('requires capture before delivery', () =>
    expect(() =>
      readGiteaConfig({ ...valid(), SOP_VERSION_CAPTURE_ENABLED: 'false' }),
    ).toThrow('requires'));
  it.each(['', 'true ', 'TRUE', '1'])(
    'rejects malformed enabled flag %s',
    (value) => {
      if (value === '')
        expect(
          readGiteaConfig({ ...valid(), SOP_GITEA_SYNC_ENABLED: value })
            .enabled,
        ).toBe(false);
      else
        expect(() =>
          readGiteaConfig({ ...valid(), SOP_GITEA_SYNC_ENABLED: value }),
        ).toThrow();
    },
  );
  it.each([
    'https://user:pass@example.invalid',
    'https://example.invalid/api',
    'https://example.invalid/?q=secret',
    'https://example.invalid/#fragment',
    'ftp://example.invalid',
    'not a URL',
  ])('rejects unsafe or malformed origin %s', (url) => {
    expect(() => readGiteaConfig({ ...valid(), SOP_GITEA_URL: url })).toThrow();
  });
  it('permits private HTTP only with explicit opt-in', () => {
    const env = { ...valid(), SOP_GITEA_URL: 'http://gitea:3000' };
    expect(() => readGiteaConfig(env)).toThrow('HTTPS');
    expect(readGiteaConfig({ ...env, SOP_GITEA_ALLOW_HTTP: 'true' }).url).toBe(
      'http://gitea:3000',
    );
  });
  it.each(['', 'bad token', 'token\n'])(
    'rejects missing or whitespace credentials',
    (token) =>
      expect(() =>
        readGiteaConfig({ ...valid(), SOP_GITEA_TOKEN: token }),
      ).toThrow('token'),
  );
  it.each(['', '------------------------------------', 'a'.repeat(36)])(
    'requires a canonical installation identifier',
    (id) =>
      expect(() =>
        readGiteaConfig({ ...valid(), SOP_GITEA_INSTANCE_ID: id }),
      ).toThrow('UUID'),
  );
  it('freezes the resolved configuration', () =>
    expect(Object.isFrozen(readGiteaConfig(valid()))).toBe(true));
});
