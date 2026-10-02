import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { SetupGuard } from './guards/setup.guard';
import { TestingModule } from '@nestjs/testing';
import { createUnitModule } from 'src/test-support/unit-module';

import { AuthController } from './auth.controller';
import { AuthService } from './services/auth.service';
import { SessionService } from '../session/session.service';
import { EnvironmentService } from 'src/integrations/environment/environment.service';
import { AUDIT_SERVICE } from 'src/integrations/audit/audit.service';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ThrottlerGuard } from '@nestjs/throttler';

const createMocks = () => {
  return {
    auth: {
      setup: jest.fn(),
      passwordReset: jest.fn(),
      changePassword: jest.fn(),
      getCollabToken: jest.fn(),
    },
    sessions: { revokeSession: jest.fn() },
    env: {
      getCookieExpiresIn: () => new Date('2030-01-01'),
      isHttps: jest.fn().mockReturnValue(true),
    },
    audit: { log: jest.fn() },
    reply: { setCookie: jest.fn(), clearCookie: jest.fn() },
  };
};
describe('AuthController', () => {
  let module: TestingModule, subject: AuthController;
  let m: ReturnType<typeof createMocks>;
  beforeEach(async () => {
    m = createMocks();
    module = await createUnitModule(
      AuthController,
      [
        [AuthService, m.auth],
        [SessionService, m.sessions],
        [EnvironmentService, m.env],
        [AUDIT_SERVICE, m.audit],
      ],
      [ThrottlerGuard, JwtAuthGuard, SetupGuard],
    );
    subject = module.get(AuthController);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await module?.close();
  });
  it('should be defined', () => expect(subject).toBeDefined());

  it('keeps the authentication rate limiter attached', () =>
    expect(Reflect.getMetadata(GUARDS_METADATA, AuthController)).toContain(
      ThrottlerGuard,
    ));
  it('sets an HTTP-only same-site cookie with the configured secure flag', () => {
    subject.setAuthCookie(m.reply as any, 'test-token');
    expect(m.reply.setCookie).toHaveBeenCalledWith('authToken', 'test-token', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      expires: new Date('2030-01-01'),
      secure: true,
    });
  });
  it('returns workspace setup data without including its auth token', async () => {
    m.auth.setup.mockResolvedValue({
      workspace: { id: 'w' },
      authToken: 'test-token',
    });
    expect(
      await subject.setupWorkspace(m.reply as any, { name: 'Admin' } as any),
    ).toEqual({ id: 'w' });
    expect(m.reply.setCookie).toHaveBeenCalledTimes(1);
  });
  it('does not set a cookie when password reset still requires login', async () => {
    m.auth.passwordReset.mockResolvedValue({ requiresLogin: true });
    expect(
      await subject.passwordReset(m.reply as any, {} as any, {} as any),
    ).toEqual({ requiresLogin: true });
    expect(m.reply.setCookie).not.toHaveBeenCalled();
  });
  it('propagates failed setup without setting an auth cookie', async () => {
    m.auth.setup.mockRejectedValue(new Error('setup failed'));
    await expect(
      subject.setupWorkspace(m.reply as any, {} as any),
    ).rejects.toThrow('setup failed');
    expect(m.reply.setCookie).not.toHaveBeenCalled();
  });
  it('revokes only the authenticated current session on logout', async () => {
    const user = { id: 'user-a', workspaceId: 'workspace-a' } as any;
    const workspace = { id: 'workspace-a' } as any;
    await subject.logout(
      user,
      { raw: { sessionId: 'session-a' } } as any,
      m.reply as any,
    );
    expect(m.sessions.revokeSession).toHaveBeenCalledWith(
      'session-a',
      user.id,
      user.workspaceId,
    );
    expect(m.reply.clearCookie).toHaveBeenCalledWith('authToken');
  });
});
