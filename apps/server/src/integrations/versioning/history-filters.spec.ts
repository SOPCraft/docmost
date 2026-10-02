import { validateHistoryFilters } from './history-filters';
import {
  VersionListDto,
  VersionCompareDto,
} from '../../core/page/version-history.controller';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
const id = '11111111-1111-4111-8111-111111111111';
describe('history query validation', () => {
  it('accepts the local-day boundaries serialized with time zones', () =>
    expect(
      validateHistoryFilters({
        from: '2026-10-01T16:00:00.000Z',
        until: '2026-10-02T16:00:00.000Z',
        actorId: id,
      }),
    ).toHaveProperty('actorId', id));
  it.each(['2026-10-02', '2026-10-02T00:00:00', 'bad'])(
    'rejects dates without explicit time zones: %s',
    (from) => expect(() => validateHistoryFilters({ from })).toThrow(),
  );
  it('rejects inverted and zero-width intervals', () => {
    for (const until of ['2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'])
      expect(() =>
        validateHistoryFilters({ from: '2026-10-02T00:00:00Z', until }),
      ).toThrow();
  });
  it.each([-1, 0, 1.1, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid cursor %s',
    (cursor) => expect(() => validateHistoryFilters({}, cursor)).toThrow(),
  );
  it('rejects malicious contributor and summary values', () => {
    expect(() => validateHistoryFilters({ actorId: "' OR 1=1" })).toThrow();
    expect(() =>
      validateHistoryFilters({ summaries: 'true' as any }),
    ).toThrow();
  });
  it('validates DTO dates strictly', () =>
    expect(
      validateSync(
        plainToInstance(VersionListDto, {
          pageId: id,
          from: '2026-02-31T00:00:00Z',
        }),
      ),
    ).not.toHaveLength(0));
  it('accepts an explicit comparison baseline identifier', () =>
    expect(
      validateSync(
        plainToInstance(VersionCompareDto, {
          pageId: id,
          versionId: id,
          baseVersionId: id,
        }),
      ),
    ).toHaveLength(0));
  it.each([
    '2026-02-31T00:00:00Z',
    '2026-04-31T00:00:00Z',
    '2025-02-29T00:00:00Z',
  ])(
    'rejects invalid calendar dates even outside controller validation: %s',
    (from) => expect(() => validateHistoryFilters({ from })).toThrow(),
  );
  it('accepts a valid leap-day boundary with an explicit timezone', () => {
    expect(
      validateHistoryFilters({ from: '2024-02-29T00:00:00+08:00' }).from,
    ).toBe('2024-02-29T00:00:00+08:00');
  });
});
