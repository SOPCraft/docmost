import { TestingModule } from '@nestjs/testing';
import { createUnitModule } from 'src/test-support/unit-module';

import { SpaceController } from './space.controller';
import { SpaceService } from './services/space.service';
import { SpaceMemberService } from './services/space-member.service';
import { SpaceMemberRepo } from 'src/database/repos/space/space-member.repo';
import SpaceAbilityFactory from 'src/core/casl/abilities/space-ability.factory';
import WorkspaceAbilityFactory from 'src/core/casl/abilities/workspace-ability.factory';
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

const createMocks = () => {
  const ability = { cannot: jest.fn().mockReturnValue(false), rules: [] };
  return {
    ability,
    spaces: { createSpace: jest.fn(), getSpaceInfo: jest.fn() },
    members: { getUserSpaces: jest.fn() },
    repo: { getUserRolesForSpaces: jest.fn(), getUserSpaceRoles: jest.fn() },
    spaceAbility: { createForUser: jest.fn().mockResolvedValue(ability) },
    workspaceAbility: { createForUser: jest.fn().mockReturnValue(ability) },
  };
};
describe('SpaceController', () => {
  let module: TestingModule, subject: SpaceController;
  let m: ReturnType<typeof createMocks>;
  beforeEach(async () => {
    m = createMocks();
    module = await createUnitModule(
      SpaceController,
      [
        [SpaceService, m.spaces],
        [SpaceMemberService, m.members],
        [SpaceMemberRepo, m.repo],
        [SpaceAbilityFactory, m.spaceAbility],
        [WorkspaceAbilityFactory, m.workspaceAbility],
      ],
      [JwtAuthGuard],
    );
    subject = module.get(SpaceController);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await module?.close();
  });
  it('should be defined', () => expect(subject).toBeDefined());

  it('retains the authenticated route guard', () =>
    expect(Reflect.getMetadata(GUARDS_METADATA, SpaceController)).toContain(
      JwtAuthGuard,
    ));
  it.each([{}, { userId: 'u', groupId: 'g' }])(
    'rejects ambiguous membership subjects',
    (dto) =>
      expect(() => subject.validateIds(dto as any)).toThrow(
        BadRequestException,
      ),
  );
  it.each([{ userId: 'u' }, { groupId: 'g' }])(
    'accepts exactly one membership subject',
    (dto) => expect(() => subject.validateIds(dto as any)).not.toThrow(),
  );
  it('rejects missing spaces', async () => {
    const user = { id: 'user-a', workspaceId: 'workspace-a' } as any;
    const workspace = { id: 'workspace-a' } as any;
    m.spaces.getSpaceInfo.mockResolvedValue(null);
    await expect(
      subject.getSpaceInfo({ spaceId: 's' }, user, workspace),
    ).rejects.toThrow(NotFoundException);
  });
  it('prevents unauthorized space creation', () => {
    const user = { id: 'user-a', workspaceId: 'workspace-a' } as any;
    const workspace = { id: 'workspace-a' } as any;
    m.ability.cannot.mockReturnValue(true);
    expect(() =>
      subject.createSpace({ name: 'Team', slug: 'team' }, user, workspace),
    ).toThrow(ForbiddenException);
    expect(m.spaces.createSpace).not.toHaveBeenCalled();
  });
  it('uses the strongest actual membership role when listing spaces', async () => {
    const user = { id: 'user-a', workspaceId: 'workspace-a' } as any;
    const workspace = { id: 'workspace-a' } as any;
    m.members.getUserSpaces.mockResolvedValue({
      items: [{ id: 's' }],
      hasNextPage: false,
    });
    m.repo.getUserRolesForSpaces.mockResolvedValue([
      { spaceId: 's', role: 'reader' },
      { spaceId: 's', role: 'writer' },
    ]);
    const result = await subject.getWorkspaceSpaces({ limit: 20 } as any, user);
    expect(result.items[0]).toMatchObject({
      membership: { userId: user.id, role: 'writer' },
    });
    expect(m.repo.getUserRolesForSpaces).toHaveBeenCalledWith(user.id, ['s']);
  });
  it('does not reveal a space after its access check fails', async () => {
    const user = { id: 'user-a', workspaceId: 'workspace-a' } as any;
    const workspace = { id: 'workspace-a' } as any;
    m.spaces.getSpaceInfo.mockResolvedValue({ id: 's' });
    m.ability.cannot.mockReturnValue(true);
    await expect(
      subject.getSpaceInfo({ spaceId: 's' }, user, workspace),
    ).rejects.toThrow(ForbiddenException);
    expect(m.repo.getUserSpaceRoles).not.toHaveBeenCalled();
  });
});
