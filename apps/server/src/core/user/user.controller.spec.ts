import { UpdateUserDto } from './dto/update-user.dto';
import { TestingModule } from '@nestjs/testing';
import { createUnitModule } from 'src/test-support/unit-module';

import { UserController } from './user.controller';
import { UserService } from './user.service';
import { WorkspaceRepo } from 'src/database/repos/workspace/workspace.repo';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

const createMocks = () => {
  return {
    users: { update: jest.fn() },
    workspaces: { getActiveUserCount: jest.fn().mockResolvedValue(3) },
  };
};
describe('UserController', () => {
  let module: TestingModule, subject: UserController;
  let m: ReturnType<typeof createMocks>;
  beforeEach(async () => {
    m = createMocks();
    module = await createUnitModule(
      UserController,
      [
        [UserService, m.users],
        [WorkspaceRepo, m.workspaces],
      ],
      [JwtAuthGuard],
    );
    subject = module.get(UserController);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await module?.close();
  });
  it('should be defined', () => expect(subject).toBeDefined());

  it('retains the authenticated route guard', () =>
    expect(Reflect.getMetadata(GUARDS_METADATA, UserController)).toContain(
      JwtAuthGuard,
    ));
  it('uses the authenticated workspace and never returns its license key', async () => {
    const user = { id: 'user-a', workspaceId: 'workspace-a' } as any;
    const workspace = { id: 'workspace-a' } as any;
    const result = await subject.getUserInfo(user, {
      ...workspace,
      licenseKey: 'test-license',
      name: 'Team',
    });
    expect(result.user).toBe(user);
    expect(result.workspace).toMatchObject({
      id: 'workspace-a',
      memberCount: 3,
    });
    expect(result.workspace).not.toHaveProperty('licenseKey');
    expect(m.workspaces.getActiveUserCount).toHaveBeenCalledWith('workspace-a');
  });
  it('updates only the authenticated user and propagates service errors', async () => {
    const user = { id: 'user-a', workspaceId: 'workspace-a' } as any;
    const workspace = { id: 'workspace-a' } as any;
    const dto = Object.assign(new UpdateUserDto(), { name: 'New name' });
    m.users.update.mockResolvedValue({ id: user.id, name: dto.name });
    expect(await subject.updateUser(dto, user, workspace)).toEqual({
      id: user.id,
      name: dto.name,
    });
    expect(m.users.update).toHaveBeenCalledWith(dto, user.id, workspace);
    m.users.update.mockRejectedValue(new Error('write failed'));
    await expect(subject.updateUser(dto, user, workspace)).rejects.toThrow(
      'write failed',
    );
  });
});
