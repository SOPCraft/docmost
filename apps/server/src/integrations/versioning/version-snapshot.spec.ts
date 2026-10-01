import {
  buildPageSnapshot,
  canonicalJson,
  SnapshotPage,
} from './version-snapshot';
import { createHash } from 'node:crypto';

const page: SnapshotPage = {
  id: 'page-a',
  workspaceId: 'workspace-a',
  spaceId: 'space-a',
  slugId: 'slug',
  title: '字幕检查',
  icon: null,
  coverPhoto: null,
  parentPageId: null,
  position: 'a0',
  content: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '人名、数字与单位不能遗漏。' }],
      },
    ],
  },
  ydoc: Uint8Array.from([0, 127, 128, 255]),
  deletedAt: null,
};
const actor = { id: 'actor-a', name: '同事甲' };

describe('immutable page snapshot', () => {
  it('preserves Chinese content and exact collaborative binary bytes', () => {
    const result = buildPageSnapshot(page, [actor]);
    const restored = JSON.parse(result.json);
    expect(restored.page.content).toEqual(page.content);
    expect(Buffer.from(restored.page.ydoc, 'base64')).toEqual(
      Buffer.from(page.ydoc),
    );
    expect(restored.scope).toBe('page-body-and-metadata');
  });
  it('is a value copy, not a pointer to mutable page content', () => {
    const source = structuredClone(page);
    const result = buildPageSnapshot(source, [actor]);
    source.title = '新的标题';
    (source.content as any).content.length = 0;
    expect(JSON.parse(result.json).page).toMatchObject({
      title: page.title,
      content: page.content,
    });
  });
  it('canonicalizes object keys but preserves array order', () => {
    expect(canonicalJson({ b: 2, a: [2, 1] })).toBe(
      canonicalJson({ a: [2, 1], b: 2 }),
    );
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });
  it('deduplicates and orders all contributors without overwriting them', () => {
    const b = { id: 'actor-b', name: '同事乙' };
    const result = buildPageSnapshot(page, [b, actor, actor]);
    expect(JSON.parse(result.json).actors).toEqual([actor, b]);
  });
  it('never substitutes an old editor when the current actor is missing', () => {
    expect(() => buildPageSnapshot(page, [])).toThrow('authenticated actor');
  });
  it('hashes the exact stored canonical representation', () => {
    const result = buildPageSnapshot(page, [actor]);
    expect(result.sha256).toBe(
      createHash('sha256').update(result.json).digest('hex'),
    );
  });
  it('changes the hash when only collaborative state changes', () => {
    expect(buildPageSnapshot(page, [actor]).sha256).not.toBe(
      buildPageSnapshot({ ...page, ydoc: Uint8Array.from([1]) }, [actor])
        .sha256,
    );
  });
  it.each([undefined, NaN, Infinity, new Date(), Buffer.from('bad')])(
    'rejects unsupported values instead of silently dropping them',
    (value) => {
      expect(() => canonicalJson({ value })).toThrow();
    },
  );
  it('explicitly discloses unversioned resources', () => {
    expect(
      JSON.parse(buildPageSnapshot(page, [actor]).json).exclusions,
    ).toEqual(['comment-history', 'attachment-bytes', 'external-references']);
  });
});
