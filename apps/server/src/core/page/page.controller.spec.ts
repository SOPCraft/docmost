import { TestingModule } from '@nestjs/testing';
import { createUnitModule } from 'src/test-support/unit-module';

import { PageController } from './page.controller';
import { PageService } from './services/page.service';
import { PageRepo } from 'src/database/repos/page/page.repo';
import { PageHistoryService } from './services/page-history.service';
import SpaceAbilityFactory from 'src/core/casl/abilities/space-ability.factory';
import { PageAccessService } from './page-access/page-access.service';
import { BacklinkService } from './services/backlink.service';
import { LabelService } from '../label/label.service';
import { AUDIT_SERVICE } from 'src/integrations/audit/audit.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

const createMocks = () => {
  return {
    pages: { findById: jest.fn() },
    access: {
      validateCanViewWithPermissions: jest
        .fn()
        .mockResolvedValue({ canEdit: false, hasRestriction: true }),
    },
    service: {},
    history: {},
    ability: {},
    backlinks: {},
    labels: {},
    audit: { log: jest.fn() },
  };
};
describe('PageController', () => {
  let module: TestingModule, subject: PageController;
  let m: ReturnType<typeof createMocks>;
  beforeEach(async () => {
    m = createMocks();
    module = await createUnitModule(
      PageController,
      [
        [PageService, m.service],
        [PageRepo, m.pages],
        [PageHistoryService, m.history],
        [SpaceAbilityFactory, m.ability],
        [PageAccessService, m.access],
        [BacklinkService, m.backlinks],
        [LabelService, m.labels],
        [AUDIT_SERVICE, m.audit],
      ],
      [JwtAuthGuard],
    );
    subject = module.get(PageController);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await module?.close();
  });
  it('should be defined', () => expect(subject).toBeDefined());

  it('retains the authenticated route guard', () =>
    expect(Reflect.getMetadata(GUARDS_METADATA, PageController)).toContain(
      JwtAuthGuard,
    ));
  it('rejects a missing document before checking its permissions', async () => {
    const user = { id: 'user-a', workspaceId: 'workspace-a' } as any;
    const workspace = { id: 'workspace-a' } as any;
    m.pages.findById.mockResolvedValue(null);
    await expect(
      subject.getPage(
        { pageId: 'p', includeSpace: true, includeContent: true },
        user,
      ),
    ).rejects.toThrow(NotFoundException);
    expect(m.access.validateCanViewWithPermissions).not.toHaveBeenCalled();
  });
  it('never returns a document when page authorization rejects', async () => {
    const user = { id: 'user-a', workspaceId: 'workspace-a' } as any;
    const workspace = { id: 'workspace-a' } as any;
    m.pages.findById.mockResolvedValue({
      id: 'p',
      workspaceId: 'other',
      content: { type: 'doc' },
    });
    m.access.validateCanViewWithPermissions.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(
      subject.getPage(
        { pageId: 'p', includeSpace: true, includeContent: true },
        user,
      ),
    ).rejects.toThrow(ForbiddenException);
  });
  it('preserves rich content and reports the actual read-only permission', async () => {
    const user = { id: 'user-a', workspaceId: 'workspace-a' } as any;
    const workspace = { id: 'workspace-a' } as any;
    const content = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '检查字幕' }] },
      ],
    };
    const page = { id: 'p', workspaceId: user.workspaceId, content };
    m.pages.findById.mockResolvedValue(page);
    const result = await subject.getPage(
      { pageId: 'p', includeSpace: true, includeContent: true },
      user,
    );
    expect(result.content).toBe(content);
    expect(result.permissions).toEqual({
      canEdit: false,
      hasRestriction: true,
    });
    expect(m.access.validateCanViewWithPermissions).toHaveBeenCalledWith(
      page,
      user,
    );
  });
});
