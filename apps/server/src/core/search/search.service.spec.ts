import { TestingModule } from '@nestjs/testing';
import { createUnitModule } from 'src/test-support/unit-module';

import { SearchService } from './search.service';
import { KYSELY_MODULE_CONNECTION_TOKEN } from 'nestjs-kysely';
import { PageRepo } from 'src/database/repos/page/page.repo';
import { ShareRepo } from 'src/database/repos/share/share.repo';
import { SpaceMemberRepo } from 'src/database/repos/space/space-member.repo';
import { PagePermissionRepo } from 'src/database/repos/page/page-permission.repo';

const createMocks = () => {
  return {
    db: {
      selectFrom: jest.fn(() => {
        throw new Error('Unexpected database query');
      }),
    },
    pages: {},
    shares: {},
    members: {},
    permissions: {},
  };
};
describe('SearchService', () => {
  let module: TestingModule, subject: SearchService;
  let m: ReturnType<typeof createMocks>;
  beforeEach(async () => {
    m = createMocks();
    module = await createUnitModule(SearchService, [
      [KYSELY_MODULE_CONNECTION_TOKEN(), m.db],
      [PageRepo, m.pages],
      [ShareRepo, m.shares],
      [SpaceMemberRepo, m.members],
      [PagePermissionRepo, m.permissions],
    ]);
    subject = module.get(SearchService);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await module?.close();
  });
  it('should be defined', () => expect(subject).toBeDefined());

  it.each(['', ' ', '\n\t'])(
    'does not query documents for an empty search: %s',
    async (query) => {
      expect(
        await subject.searchPage(
          { query, spaceId: undefined },
          { workspaceId: 'w', userId: 'u' },
        ),
      ).toEqual({ items: [] });
      expect(m.db.selectFrom).not.toHaveBeenCalled();
    },
  );
  it('returns no suggestion classes unless explicitly requested', async () => {
    expect(
      await subject.searchSuggestions({ query: '字幕' }, 'u', 'w'),
    ).toEqual({ users: [], groups: [], pages: [] });
    expect(m.db.selectFrom).not.toHaveBeenCalled();
  });
  it('propagates a real query setup error rather than silently returning an empty result', async () => {
    await expect(
      subject.searchPage(
        { query: '字幕', spaceId: undefined },
        { workspaceId: 'w', userId: 'u' },
      ),
    ).rejects.toThrow('Unexpected database query');
  });
});
