import { TestingModule } from '@nestjs/testing';
import { createUnitModule } from 'src/test-support/unit-module';

import { AuthService } from './auth.service';
import { SignupService } from './signup.service';
import { TokenService } from './token.service';
import { SessionService } from '../../session/session.service';
import { UserSessionRepo } from 'src/database/repos/session/user-session.repo';
import { UserRepo } from 'src/database/repos/user/user.repo';
import { UserTokenRepo } from 'src/database/repos/user-token/user-token.repo';
import { MailService } from 'src/integrations/mail/mail.service';
import { DomainService } from 'src/integrations/environment/domain.service';
import { EnvironmentService } from 'src/integrations/environment/environment.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { KYSELY_MODULE_CONNECTION_TOKEN } from 'nestjs-kysely';
import { AUDIT_SERVICE } from 'src/integrations/audit/audit.service';
import { hashPassword } from 'src/common/helpers';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { UserTokenType } from '../auth.constants';

const createMocks = () => {
  return {
    signup: { signup: jest.fn() },
    tokens: { generateCollabToken: jest.fn() },
    sessions: {
      createSessionAndToken: jest.fn().mockResolvedValue('test-session'),
    },
    userSessions: {},
    users: { findByEmail: jest.fn(), updateLastLogin: jest.fn() },
    userTokens: { findById: jest.fn() },
    mail: {},
    domain: {},
    env: { isCloud: () => false, getAppSecret: () => 'synthetic-unit-secret' },
    events: {},
    db: {},
    audit: { log: jest.fn() },
  };
};
describe('AuthService', () => {
  let module: TestingModule, subject: AuthService;
  let m: ReturnType<typeof createMocks>;
  beforeEach(async () => {
    m = createMocks();
    module = await createUnitModule(AuthService, [
      [SignupService, m.signup],
      [TokenService, m.tokens],
      [SessionService, m.sessions],
      [UserSessionRepo, m.userSessions],
      [UserRepo, m.users],
      [UserTokenRepo, m.userTokens],
      [MailService, m.mail],
      [DomainService, m.domain],
      [EnvironmentService, m.env],
      [EventEmitter2, m.events],
      [KYSELY_MODULE_CONNECTION_TOKEN(), m.db],
      [AUDIT_SERVICE, m.audit],
    ]);
    subject = module.get(AuthService);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await module?.close();
  });
  it('should be defined', () => expect(subject).toBeDefined());

  it('rejects a missing user without generating a session', async () => {
    m.users.findByEmail.mockResolvedValue(null);
    await expect(
      subject.login({ email: 'a@example.invalid', password: 'wrong' }, 'w'),
    ).rejects.toThrow(UnauthorizedException);
    expect(m.users.findByEmail).toHaveBeenCalledWith('a@example.invalid', 'w', {
      includePassword: true,
    });
    expect(m.sessions.createSessionAndToken).not.toHaveBeenCalled();
  });
  it.each(['deletedAt', 'deactivatedAt'])(
    'rejects a %s account before password verification',
    async (field) => {
      m.users.findByEmail.mockResolvedValue({ id: 'a', [field]: new Date() });
      await expect(
        subject.login({ email: 'a@example.invalid', password: 'wrong' }, 'w'),
      ).rejects.toThrow(UnauthorizedException);
      expect(m.users.updateLastLogin).not.toHaveBeenCalled();
      expect(m.sessions.createSessionAndToken).not.toHaveBeenCalled();
    },
  );
  it('checks real password hashes and refuses a mismatch without a session', async () => {
    const password = await hashPassword('unit-valid-password');
    m.users.findByEmail.mockResolvedValue({
      id: 'a',
      workspaceId: 'w',
      password,
    });
    await expect(
      subject.login({ email: 'a@example.invalid', password: 'wrong' }, 'w'),
    ).rejects.toThrow(UnauthorizedException);
    expect(m.sessions.createSessionAndToken).not.toHaveBeenCalled();
  });
  it('updates the successful login before issuing its session', async () => {
    const user = {
      id: 'a',
      workspaceId: 'w',
      password: await hashPassword('unit-valid-password'),
    };
    m.users.findByEmail.mockResolvedValue(user);
    expect(
      await subject.login(
        { email: 'a@example.invalid', password: 'unit-valid-password' },
        'w',
      ),
    ).toBe('test-session');
    expect(m.users.updateLastLogin).toHaveBeenCalledWith('a', 'w');
    expect(m.sessions.createSessionAndToken).toHaveBeenCalledWith(user);
    expect(m.users.updateLastLogin.mock.invocationCallOrder[0]).toBeLessThan(
      m.sessions.createSessionAndToken.mock.invocationCallOrder[0],
    );
  });
  it('does not issue a session after failed registration', async () => {
    m.signup.signup.mockRejectedValue(new Error('registration failed'));
    await expect(subject.register({} as any, 'w')).rejects.toThrow(
      'registration failed',
    );
    expect(m.sessions.createSessionAndToken).not.toHaveBeenCalled();
  });
  it.each(['missing', 'expired', 'wrong-type'])(
    'rejects a %s reset token',
    async (kind) => {
      const value =
        kind === 'missing'
          ? null
          : {
              type:
                kind === 'wrong-type'
                  ? 'invalid'
                  : UserTokenType.FORGOT_PASSWORD,
              expiresAt: new Date(
                Date.now() + (kind === 'expired' ? -60000 : 60000),
              ),
            };
      m.userTokens.findById.mockResolvedValue(value);
      await expect(
        subject.verifyUserToken(
          { token: 't', type: UserTokenType.FORGOT_PASSWORD },
          'w',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(m.userTokens.findById).toHaveBeenCalledWith('t', 'w');
    },
  );
  it('returns the collaboration token produced for the authenticated user', async () => {
    const user = { id: 'a' } as any;
    m.tokens.generateCollabToken.mockResolvedValue('collab-test');
    expect(await subject.getCollabToken(user, 'w')).toEqual({
      token: 'collab-test',
    });
    expect(m.tokens.generateCollabToken).toHaveBeenCalledWith(user, 'w');
  });
});
