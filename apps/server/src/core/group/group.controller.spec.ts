import { TestingModule } from '@nestjs/testing';
import { createUnitModule } from 'src/test-support/unit-module';

import { GroupController } from './group.controller';
import { GroupService } from './services/group.service';
import { GroupUserService } from './services/group-user.service';
import WorkspaceAbilityFactory from 'src/core/casl/abilities/workspace-ability.factory';
import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

const createMocks = () => {
  const ability = { cannot: jest.fn().mockReturnValue(false) };
  return {
    ability,
    factory: { createForUser: jest.fn().mockReturnValue(ability) },
    groups: {
      getGroupInfo: jest.fn(),
      createGroup: jest.fn(),
      deleteGroup: jest.fn(),
    },
    members: { addUsersToGroupBatch: jest.fn() },
  };
};
describe('GroupController', () => {
  let module: TestingModule, subject: GroupController;
  let m: ReturnType<typeof createMocks>;
  beforeEach(async () => {
    m = createMocks();
    module = await createUnitModule(
      GroupController,
      [
        [GroupService, m.groups],
        [GroupUserService, m.members],
        [WorkspaceAbilityFactory, m.factory],
      ],
      [JwtAuthGuard],
    );
    subject = module.get(GroupController);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await module?.close();
  });
  it('should be defined', () => expect(subject).toBeDefined());

  it('retains the authenticated route guard', () =>
    expect(Reflect.getMetadata(GUARDS_METADATA, GroupController)).toContain(
      JwtAuthGuard,
    ));
  it('scopes group reads and creates to the authenticated workspace', async () => {
    const user = { id: 'user-a', workspaceId: 'workspace-a' } as any;
    const workspace = { id: 'workspace-a' } as any;
    m.groups.getGroupInfo.mockResolvedValue({ id: 'g' });
    expect(await subject.getGroup({ groupId: 'g' }, user, workspace)).toEqual({
      id: 'g',
    });
    expect(m.groups.getGroupInfo).toHaveBeenCalledWith('g', workspace.id);
    const dto = { name: 'Editors' };
    await subject.createGroup(dto, user, workspace);
    expect(m.groups.createGroup).toHaveBeenCalledWith(user, workspace.id, dto);
  });
  it('refuses forbidden creation before reaching the write service', () => {
    const user = { id: 'user-a', workspaceId: 'workspace-a' } as any;
    const workspace = { id: 'workspace-a' } as any;
    m.ability.cannot.mockReturnValue(true);
    expect(() =>
      subject.createGroup({ name: 'Editors' }, user, workspace),
    ).toThrow(ForbiddenException);
    expect(m.groups.createGroup).not.toHaveBeenCalled();
  });
  it('refuses forbidden reads and membership changes', () => {
    const user = { id: 'user-a', workspaceId: 'workspace-a' } as any;
    const workspace = { id: 'workspace-a' } as any;
    m.ability.cannot.mockReturnValue(true);
    expect(() => subject.getGroup({ groupId: 'g' }, user, workspace)).toThrow(
      ForbiddenException,
    );
    expect(() =>
      subject.addGroupMember(
        { groupId: 'g', userIds: ['u'] } as any,
        user,
        workspace,
      ),
    ).toThrow(ForbiddenException);
    expect(m.groups.getGroupInfo).not.toHaveBeenCalled();
    expect(m.members.addUsersToGroupBatch).not.toHaveBeenCalled();
  });
  it('passes member additions with an explicit workspace identity', async () => {
    const user = { id: 'user-a', workspaceId: 'workspace-a' } as any;
    const workspace = { id: 'workspace-a' } as any;
    await subject.addGroupMember(
      { groupId: 'g', userIds: ['u'] } as any,
      user,
      workspace,
    );
    expect(m.members.addUsersToGroupBatch).toHaveBeenCalledWith(
      ['u'],
      'g',
      workspace.id,
    );
  });
});
