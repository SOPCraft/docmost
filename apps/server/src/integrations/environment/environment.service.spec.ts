import { TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EnvironmentService } from './environment.service';
import { createUnitModule } from '../../test-support/unit-module';

describe('EnvironmentService', () => {
  let module: TestingModule, service: EnvironmentService;
  let values: Record<string, string>;
  beforeEach(async () => {
    values = {};
    const config = {
      get: (key: string, fallback?: string) => values[key] ?? fallback,
    };
    module = await createUnitModule(EnvironmentService, [
      [ConfigService, config],
    ]);
    service = module.get(EnvironmentService);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await module?.close();
  });
  it('should be defined', () => expect(service).toBeDefined());
  it('uses safe self-hosted defaults without depending on the developer environment', () => {
    expect(service.getPort()).toBe(3000);
    expect(service.getAppUrl()).toBe('http://localhost:3000');
    expect(service.getStorageDriver()).toBe('local');
    expect(service.isSelfHosted()).toBe(true);
  });
  it('normalizes the configured application URL to its origin', () => {
    values.APP_URL = 'https://docs.example.invalid/a/path';
    expect(service.getAppUrl()).toBe('https://docs.example.invalid');
    expect(service.isHttps()).toBe(true);
  });
  it.each(['', 'not-a-url', 'http://localhost:3026'])(
    'does not mark a non-HTTPS origin as secure: %s',
    (url) => {
      values.APP_URL = url;
      expect(service.isHttps()).toBe(false);
    },
  );
  it('uses the configured cookie duration', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    values.JWT_TOKEN_EXPIRES_IN = '2h';
    expect(service.getCookieExpiresIn().getTime()).toBe(Date.now() + 7_200_000);
  });
  it.each([
    'invalid-duration',
    '',
    'NaN',
    '1e999 days',
    '999999999999999999999 days',
  ])('falls back to ninety days for invalid cookie duration: %s', (value) => {
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    values.JWT_TOKEN_EXPIRES_IN = value;
    expect(service.getCookieExpiresIn().getTime()).toBe(
      Date.now() + 90 * 86400_000,
    );
  });
  it('normalizes blocked mail recipient domains', () => {
    values.MAIL_BLOCKED_RECIPIENT_DOMAINS = ' EXAMPLE.ORG, , test.invalid ';
    expect(service.getMailBlockedRecipientDomains()).toEqual([
      'example.org',
      'test.invalid',
    ]);
  });
  it('keeps optional security features disabled unless explicitly enabled', () => {
    expect(service.isIframeEmbedAllowed()).toBe(false);
    expect(service.isBetaPublicSpaces()).toBe(false);
    values.IFRAME_EMBED_ALLOWED = 'TRUE';
    expect(service.isIframeEmbedAllowed()).toBe(true);
  });
  it.each([
    ['0', 0],
    ['-1s', -1000],
  ] as const)(
    'does not extend an explicitly expired cookie: %s',
    (value, offset) => {
      jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
      values.JWT_TOKEN_EXPIRES_IN = value;
      expect(service.getCookieExpiresIn().getTime()).toBe(Date.now() + offset);
    },
  );
});
