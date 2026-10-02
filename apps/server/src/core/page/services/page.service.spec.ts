import { TestingModule } from '@nestjs/testing';
import { createUnitModule } from 'src/test-support/unit-module';

import { PageService } from './page.service';
import { PageRepo } from 'src/database/repos/page/page.repo';
import { PagePermissionRepo } from 'src/database/repos/page/page-permission.repo';
import { AttachmentRepo } from 'src/database/repos/attachment/attachment.repo';
import { KYSELY_MODULE_CONNECTION_TOKEN } from 'nestjs-kysely';
import { StorageService } from 'src/integrations/storage/storage.service';
import { getQueueToken } from '@nestjs/bullmq';
import { QueueName } from 'src/integrations/queue/constants';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CollaborationGateway } from 'src/collaboration/collaboration.gateway';
import { WatcherService } from 'src/core/watcher/watcher.service';
import { TransclusionService } from '../transclusion/transclusion.service';
import { VersionCaptureService } from 'src/integrations/versioning/version-capture.service';
import { VersionedTrashService } from './versioned-trash.service';
import { ConflictException } from '@nestjs/common';

const createMocks = () => {
  return {
    pages: {
      findById: jest.fn(),
      removePage: jest.fn(),
      restorePage: jest.fn(),
    },
    permissions: {},
    attachments: {},
    db: {},
    storage: {},
    queue: { add: jest.fn() },
    events: {},
    collaboration: {},
    watchers: {},
    transclusion: {},
    capture: { config: { enabled: false } },
    trash: { change: jest.fn() },
  };
};
describe('PageService', () => {
  let module: TestingModule, subject: PageService;
  let m: ReturnType<typeof createMocks>;
  beforeEach(async () => {
    m = createMocks();
    module = await createUnitModule(PageService, [
      [PageRepo, m.pages],
      [PagePermissionRepo, m.permissions],
      [AttachmentRepo, m.attachments],
      [KYSELY_MODULE_CONNECTION_TOKEN(), m.db],
      [StorageService, m.storage],
      [getQueueToken(QueueName.ATTACHMENT_QUEUE), m.queue],
      [getQueueToken(QueueName.AI_QUEUE), m.queue],
      [getQueueToken(QueueName.GENERAL_QUEUE), m.queue],
      [EventEmitter2, m.events],
      [CollaborationGateway, m.collaboration],
      [WatcherService, m.watchers],
      [TransclusionService, m.transclusion],
      [VersionCaptureService, m.capture],
      [VersionedTrashService, m.trash],
    ]);
    subject = module.get(PageService);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await module?.close();
  });
  it('should be defined', () => expect(subject).toBeDefined());

  it('passes all requested content and collaboration read options', async () => {
    const page = { id: 'p', content: { type: 'doc' } };
    m.pages.findById.mockResolvedValue(page);
    expect(await subject.findById('p', true, true, true)).toBe(page);
    expect(m.pages.findById).toHaveBeenCalledWith('p', {
      includeContent: true,
      includeYdoc: true,
      includeSpace: true,
    });
  });
  it('retains native soft-delete behavior when capture is disabled', async () => {
    await subject.removePage('p', 'u', 'w');
    expect(m.pages.removePage).toHaveBeenCalledWith('p', 'u', 'w');
    expect(m.trash.change).not.toHaveBeenCalled();
  });
  it('uses the transactional versioned trash service when capture is enabled', async () => {
    m.capture.config.enabled = true;
    await subject.removePage('p', 'u', 'w');
    expect(m.trash.change).toHaveBeenCalledWith('p', 'w', 'u', true);
    expect(m.pages.removePage).not.toHaveBeenCalled();
  });
  it('restores through the same versioned path without claiming historical restore', async () => {
    m.capture.config.enabled = true;
    await subject.restoreTrashedPage('p', 'w', 'u');
    expect(m.trash.change).toHaveBeenCalledWith('p', 'w', 'u', false);
    expect(m.pages.restorePage).not.toHaveBeenCalled();
  });
  it('blocks unsupported destructive operations while capture is enabled', async () => {
    m.capture.config.enabled = true;
    await expect(subject.forceDelete('p', 'w')).rejects.toThrow(
      ConflictException,
    );
    await expect(
      subject.movePageToSpace({ id: 'p' } as any, 'other', 'u'),
    ).rejects.toThrow(ConflictException);
  });
});
