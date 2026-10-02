import { TestingModule } from '@nestjs/testing';
import { createUnitModule } from 'src/test-support/unit-module';

import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import SpaceAbilityFactory from 'src/core/casl/abilities/space-ability.factory';
import { EnvironmentService } from 'src/integrations/environment/environment.service';
import { PublicSpaceService } from '../public-space/public-space.service';
import { PageRepo } from 'src/database/repos/page/page.repo';
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

const createMocks = () => {
  const ability = { cannot: jest.fn().mockReturnValue(false) };
  return {
    ability,
    search: {
      searchPage: jest.fn().mockResolvedValue({ items: [] }),
      searchSuggestions: jest.fn(),
    },
    factory: { createForUser: jest.fn().mockResolvedValue(ability) },
    env: { getSearchDriver: () => 'database' },
    public: {},
    pages: {},
  };
};
describe('SearchController', () => {
  let module: TestingModule, subject: SearchController;
  let m: ReturnType<typeof createMocks>;
  beforeEach(async () => {
    m = createMocks();
    module = await createUnitModule(
      SearchController,
      [
        [SearchService, m.search],
        [SpaceAbilityFactory, m.factory],
        [EnvironmentService, m.env],
        [PublicSpaceService, m.public],
        [PageRepo, m.pages],
      ],
      [JwtAuthGuard],
    );
    subject = module.get(SearchController);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await module?.close();
  });
  it('should be defined', () => expect(subject).toBeDefined());

  it('retains the authenticated route guard', () =>
    expect(Reflect.getMetadata(GUARDS_METADATA, SearchController)).toContain(
      JwtAuthGuard,
    ));
  it('removes anonymous share scope from authenticated search', async () => {
    const user = { id: 'user-a', workspaceId: 'workspace-a' } as any;
    const workspace = { id: 'workspace-a' } as any;
    const dto = { query: '字幕', shareId: 'untrusted', spaceId: undefined };
    await subject.pageSearch(dto, user, workspace);
    expect(m.search.searchPage).toHaveBeenCalledWith(
      { query: '字幕' },
      { userId: user.id, workspaceId: workspace.id },
    );
  });
  it('rejects a forbidden space before issuing search', async () => {
    const user = { id: 'user-a', workspaceId: 'workspace-a' } as any;
    const workspace = { id: 'workspace-a' } as any;
    m.ability.cannot.mockReturnValue(true);
    await expect(
      subject.pageSearch({ query: '字幕', spaceId: 's' }, user, workspace),
    ).rejects.toThrow(ForbiddenException);
    expect(m.search.searchPage).not.toHaveBeenCalled();
  });
  it('requires a share id for anonymous share search', async () => {
    const user = { id: 'user-a', workspaceId: 'workspace-a' } as any;
    const workspace = { id: 'workspace-a' } as any;
    await expect(
      subject.searchShare({ query: '字幕' } as any, workspace),
    ).rejects.toThrow(BadRequestException);
    expect(m.search.searchPage).not.toHaveBeenCalled();
  });
  it('forwards the authenticated identity to search suggestions', async () => {
    const user = { id: 'user-a', workspaceId: 'workspace-a' } as any;
    const workspace = { id: 'workspace-a' } as any;
    const dto = { query: 'name', includeUsers: true };
    await subject.searchSuggestions(dto, user, workspace);
    expect(m.search.searchSuggestions).toHaveBeenCalledWith(
      dto,
      user.id,
      workspace.id,
    );
  });
});
describe('SearchController public-space-search gate', () => {
  function makeController(overrides: any = {}) {
    const searchService = { searchPage: jest.fn().mockResolvedValue([]) };
    const environmentService = {
      getSearchDriver: jest.fn().mockReturnValue('postgres'),
    };
    const publicSpaceService = {
      getPublicSpace: jest
        .fn()
        .mockRejectedValue(new NotFoundException('Space not found')),
      ...overrides.publicSpaceService,
    };
    const pageRepo = {
      getSpacePagesExcludingRestricted: jest
        .fn()
        .mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]),
    };
    const controller = new SearchController(
      searchService as any,
      {} as any,
      environmentService as any,
      publicSpaceService as any,
      pageRepo as any,
      {} as any,
    );
    return { controller, searchService, publicSpaceService, pageRepo };
  }

  const workspace = { id: 'ws1' } as any;

  it('does not read pages or search when the public space gate rejects', async () => {
    const { controller, searchService, pageRepo } = makeController();
    await expect(
      controller.searchPublicSpace(
        { query: 'roadmap', spaceSlug: 'handbook' } as any,
        workspace,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(pageRepo.getSpacePagesExcludingRestricted).not.toHaveBeenCalled();
    expect(searchService.searchPage).not.toHaveBeenCalled();
  });

  it('searches only the unrestricted pages of the gated space, ignoring client filters', async () => {
    const { controller, searchService, publicSpaceService, pageRepo } =
      makeController({
        publicSpaceService: {
          getPublicSpace: jest
            .fn()
            .mockResolvedValue({ space: { id: 's1' }, publicSpace: {} }),
        },
      });
    await controller.searchPublicSpace(
      {
        query: 'roadmap',
        spaceSlug: 'handbook',
        spaceId: 'attacker-space',
        shareId: 'share1',
        creatorId: 'u1',
        labelIds: ['l1'],
      } as any,
      workspace,
    );
    expect(publicSpaceService.getPublicSpace).toHaveBeenCalledWith(
      'handbook',
      workspace,
    );
    expect(pageRepo.getSpacePagesExcludingRestricted).toHaveBeenCalledWith(
      's1',
    );
    expect(searchService.searchPage).toHaveBeenCalledWith(
      { query: 'roadmap', spaceSlug: 'handbook' },
      { workspaceId: 'ws1', publicPageIds: ['p1', 'p2'] },
    );
  });
});
