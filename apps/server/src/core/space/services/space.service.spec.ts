import { TestingModule } from '@nestjs/testing';
import { createUnitModule } from 'src/test-support/unit-module';

import { SpaceService } from './space.service';
import { SpaceRepo } from 'src/database/repos/space/space.repo';
import { SpaceMemberService } from './space-member.service';
import { ShareRepo } from 'src/database/repos/share/share.repo';
import { WorkspaceRepo } from 'src/database/repos/workspace/workspace.repo';
import { LicenseCheckService } from 'src/integrations/environment/license-check.service';
import { KYSELY_MODULE_CONNECTION_TOKEN } from 'nestjs-kysely';
import { getQueueToken } from '@nestjs/bullmq';
import { QueueName } from 'src/integrations/queue/constants';
import { AUDIT_SERVICE } from 'src/integrations/audit/audit.service';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';

const createMocks = () => {
  return {
    spaces: {
      findById: jest.fn(),
      slugExists: jest.fn(),
      insertSpace: jest.fn(),
      deleteSpace: jest.fn(),
    },
    members: {},
    shares: {},
    workspaces: {
      findById: jest.fn().mockResolvedValue({ licenseKey: null, plan: null }),
    },
    license: { hasFeature: () => false },
    db: {},
    queue: { add: jest.fn() },
    audit: { log: jest.fn() },
  };
};
describe('SpaceService', () => {
  let module: TestingModule, subject: SpaceService;
  let m: ReturnType<typeof createMocks>;
  beforeEach(async () => {
    m = createMocks();
    module = await createUnitModule(SpaceService, [
      [SpaceRepo, m.spaces],
      [SpaceMemberService, m.members],
      [ShareRepo, m.shares],
      [WorkspaceRepo, m.workspaces],
      [LicenseCheckService, m.license],
      [KYSELY_MODULE_CONNECTION_TOKEN(), m.db],
      [getQueueToken(QueueName.ATTACHMENT_QUEUE), m.queue],
      [AUDIT_SERVICE, m.audit],
    ]);
    subject = module.get(SpaceService);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await module?.close();
  });
  it('should be defined', () => expect(subject).toBeDefined());

  it('fails explicitly when a space is missing', async () => {
    await expect(subject.getSpaceInfo('s', 'w')).rejects.toThrow(
      NotFoundException,
    );
    expect(m.spaces.findById).toHaveBeenCalledWith('s', 'w', {
      includeMemberCount: true,
    });
  });
  it('rejects duplicate slugs before creating a space', async () => {
    m.spaces.slugExists.mockResolvedValue(true);
    await expect(
      subject.create('u', 'w', { name: 'Team', slug: 'team' }),
    ).rejects.toThrow(BadRequestException);
    expect(m.spaces.insertSpace).not.toHaveBeenCalled();
  });
  it('retains the creator and workspace on space creation', async () => {
    m.spaces.insertSpace.mockResolvedValue({ id: 's' });
    expect(
      await subject.create('u', 'w', { name: 'Team', slug: 'team' }),
    ).toEqual({ id: 's' });
    expect(m.spaces.insertSpace).toHaveBeenCalledWith(
      expect.objectContaining({
        creatorId: 'u',
        workspaceId: 'w',
        slug: 'team',
        isPersonal: false,
      }),
      undefined,
    );
  });
  it('does not bypass licensed setting checks', async () => {
    await expect(
      subject.updateSpace(
        {
          spaceId: 's',
          disablePublicSharing: true,
          allowViewerComments: undefined,
        },
        'w',
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(m.spaces.findById).not.toHaveBeenCalled();
  });
  it('queues attachment cleanup only after a successful delete', async () => {
    const space = { id: 's', name: 'Team' };
    m.spaces.findById.mockResolvedValue(space);
    await subject.deleteSpace('s', 'w');
    expect(m.spaces.deleteSpace).toHaveBeenCalledWith('s', 'w');
    expect(m.queue.add).toHaveBeenCalledWith(expect.any(String), space);
    expect(m.spaces.deleteSpace.mock.invocationCallOrder[0]).toBeLessThan(
      m.queue.add.mock.invocationCallOrder[0],
    );
  });
  it('does not queue cleanup when deleting a space fails', async () => {
    m.spaces.findById.mockResolvedValue({ id: 's' });
    m.spaces.deleteSpace.mockRejectedValue(new Error('delete failed'));
    await expect(subject.deleteSpace('s', 'w')).rejects.toThrow(
      'delete failed',
    );
    expect(m.queue.add).not.toHaveBeenCalled();
    expect(m.audit.log).not.toHaveBeenCalled();
  });
});
