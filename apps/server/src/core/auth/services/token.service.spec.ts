import { TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { TokenService } from './token.service';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { createUnitModule } from '../../../test-support/unit-module';
import { JwtType } from '../dto/jwt-payload';
import { User } from '../../../database/types/entity.types';

describe('TokenService', () => {
  let module: TestingModule, service: TokenService, jwt: JwtService;
  const user = {
    id: 'test-user',
    email: 'test@example.invalid',
    workspaceId: 'test-workspace',
    deletedAt: null,
    deactivatedAt: null,
  } as User;
  beforeEach(async () => {
    const secret = randomBytes(32).toString('hex');
    jwt = new JwtService({ secret, signOptions: { expiresIn: '1h' } });
    module = await createUnitModule(TokenService, [
      [JwtService, jwt],
      [EnvironmentService, { getAppSecret: () => secret }],
    ]);
    service = module.get(TokenService);
  });
  afterEach(async () => {
    await module?.close();
  });
  it('should be defined', () => expect(service).toBeDefined());
  it('signs and verifies real access tokens with workspace and session identity', async () => {
    const token = await service.generateAccessToken(user, 'session-1');
    expect(await service.verifyJwt(token, JwtType.ACCESS)).toMatchObject({
      sub: user.id,
      workspaceId: user.workspaceId,
      sessionId: 'session-1',
      type: JwtType.ACCESS,
    });
  });
  it('rejects a token presented for another purpose', async () => {
    const token = await service.generateExchangeToken(
      user.id,
      user.workspaceId,
    );
    await expect(
      service.verifyJwt(token, JwtType.ACCESS),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('rejects invalid signatures and expired tokens using the real verifier', async () => {
    const forged = new JwtService({
      secret: randomBytes(32).toString('hex'),
    }).sign({ type: JwtType.ACCESS });
    await expect(service.verifyJwt(forged, JwtType.ACCESS)).rejects.toThrow();
    await expect(
      service.verifyJwt(
        jwt.sign({ type: JwtType.ACCESS }, { expiresIn: -1 }),
        JwtType.ACCESS,
      ),
    ).rejects.toThrow();
  });
  it.each(['deletedAt', 'deactivatedAt'])(
    'refuses all user-bound token types for a %s user',
    async (field) => {
      const disabled = { ...user, [field]: new Date() } as User;
      const issue = [
        () => service.generateAccessToken(disabled, 's'),
        () => service.generateCollabToken(disabled, user.workspaceId),
        () => service.generateMfaToken(disabled, user.workspaceId),
        () =>
          service.generateApiToken({
            apiKeyId: 'k',
            user: disabled,
            workspaceId: user.workspaceId,
          }),
      ];
      for (const createToken of issue) {
        await expect(createToken()).rejects.toBeInstanceOf(ForbiddenException);
      }
    },
  );
  it('gives collaboration and exchange tokens their documented time-to-live', async () => {
    const collaboration = await service.verifyJwt(
      await service.generateCollabToken(user, user.workspaceId),
      JwtType.COLLAB,
    );
    const exchange = await service.verifyJwt(
      await service.generateExchangeToken(user.id, user.workspaceId),
      JwtType.EXCHANGE,
    );
    expect(collaboration.exp - collaboration.iat).toBe(86400);
    expect(exchange.exp - exchange.iat).toBe(10);
  });
  it('binds an attachment token to its page and workspace', async () => {
    const opts = {
      attachmentId: 'attachment',
      pageId: 'page',
      workspaceId: user.workspaceId,
    };
    const token = await service.generateAttachmentToken(opts);
    expect(await service.verifyJwt(token, JwtType.ATTACHMENT)).toMatchObject(
      opts,
    );
  });
});
