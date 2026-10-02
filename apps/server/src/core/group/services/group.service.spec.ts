import { TestingModule } from '@nestjs/testing';
import { createUnitModule } from 'src/test-support/unit-module';

import { GroupService } from './group.service';
import { GroupUserService } from './group-user.service';
import { GroupRepo } from 'src/database/repos/group/group.repo';
import { GroupUserRepo } from 'src/database/repos/group/group-user.repo';
import { SpaceMemberRepo } from 'src/database/repos/space/space-member.repo';
import { WatcherRepo } from 'src/database/repos/watcher/watcher.repo';
import { FavoriteRepo } from 'src/database/repos/favorite/favorite.repo';
import { KYSELY_MODULE_CONNECTION_TOKEN } from 'nestjs-kysely';
import { AUDIT_SERVICE } from 'src/integrations/audit/audit.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const createMocks = () => {
  return {
    groups: {
      findById: jest.fn(),
      findByName: jest.fn(),
      insertGroup: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    groupUsers: {},
    spaces: {},
    membership: { addUsersToGroupBatch: jest.fn() },
    watchers: {},
    favorites: {},
    db: {},
    audit: { log: jest.fn() },
  };
};
describe('GroupService', () => {
  let module: TestingModule, subject: GroupService;
  let m: ReturnType<typeof createMocks>;
  beforeEach(async () => {
    m = createMocks();
    module = await createUnitModule(GroupService, [
      [GroupRepo, m.groups],
      [GroupUserRepo, m.groupUsers],
      [SpaceMemberRepo, m.spaces],
      [GroupUserService, m.membership],
      [WatcherRepo, m.watchers],
      [FavoriteRepo, m.favorites],
      [KYSELY_MODULE_CONNECTION_TOKEN(), m.db],
      [AUDIT_SERVICE, m.audit],
    ]);
    subject = module.get(GroupService);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await module?.close();
  });
  it('should be defined', () => expect(subject).toBeDefined());

  it('rejects missing groups within the requested workspace', async () => {
    m.groups.findById.mockResolvedValue(null);
    await expect(subject.getGroupInfo('g', 'w')).rejects.toThrow(
      NotFoundException,
    );
    expect(m.groups.findById).toHaveBeenCalledWith('g', 'w', {
      includeMemberCount: true,
    });
  });
  it('refuses duplicate group names before inserting', async () => {
    m.groups.findByName.mockResolvedValue({ id: 'existing' });
    await expect(
      subject.createGroup({ id: 'u' } as any, 'w', { name: 'Editors' }),
    ).rejects.toThrow(BadRequestException);
    expect(m.groups.insertGroup).not.toHaveBeenCalled();
    expect(m.audit.log).not.toHaveBeenCalled();
  });
  it('creates with the correct author and applies requested membership', async () => {
    const created = { id: 'g', name: 'Editors', description: '' };
    m.groups.insertGroup.mockResolvedValue(created);
    expect(
      await subject.createGroup({ id: 'u' } as any, 'w', {
        name: 'Editors',
        userIds: ['a', 'b'],
      }),
    ).toBe(created);
    expect(m.groups.insertGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        creatorId: 'u',
        workspaceId: 'w',
        isDefault: false,
      }),
      undefined,
    );
    expect(m.membership.addUsersToGroupBatch).toHaveBeenCalledWith(
      ['a', 'b'],
      'g',
      'w',
    );
  });
  it('protects the default group from rename and deletion', async () => {
    m.groups.findById.mockResolvedValue({ id: 'g', isDefault: true });
    await expect(
      subject.updateGroup('w', { groupId: 'g', name: 'Other' }),
    ).rejects.toThrow(BadRequestException);
    await expect(subject.deleteGroup('g', 'w')).rejects.toThrow(
      BadRequestException,
    );
    expect(m.groups.update).not.toHaveBeenCalled();
    expect(m.groups.delete).not.toHaveBeenCalled();
  });
});
