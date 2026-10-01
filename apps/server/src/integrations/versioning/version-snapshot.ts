import { createHash } from 'node:crypto';

export interface SnapshotActor {
  id: string;
  name: string;
}

export interface SnapshotPage {
  id: string;
  workspaceId: string;
  spaceId: string;
  slugId: string;
  title: string | null;
  icon: string | null;
  coverPhoto: string | null;
  parentPageId: string | null;
  position: string;
  content: unknown;
  ydoc: Uint8Array | null;
  deletedAt: Date | null;
}

export function canonicalJson(value: unknown): string {
  const normalized = normalize(value);
  return JSON.stringify(normalized);
}

function normalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (
      Object.prototype.toString.call(value) !== '[object Object]' ||
      (prototype !== null && Object.getPrototypeOf(prototype) !== null)
    ) {
      throw new TypeError('Snapshot requires plain JSON objects');
    }
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          normalize((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  throw new TypeError('Snapshot contains a non-JSON value');
}

export function buildPageSnapshot(page: SnapshotPage, actors: SnapshotActor[]) {
  if (!actors.length)
    throw new Error('Version capture requires an authenticated actor');
  const uniqueActors = [
    ...new Map(actors.map((actor) => [actor.id, actor])).values(),
  ].sort((a, b) => a.id.localeCompare(b.id));
  const json = canonicalJson({
    schema: 'sop.page-snapshot/1',
    scope: 'page-body-and-metadata',
    actors: uniqueActors,
    page: {
      id: page.id,
      workspaceId: page.workspaceId,
      spaceId: page.spaceId,
      slugId: page.slugId,
      title: page.title ?? null,
      icon: page.icon ?? null,
      coverPhoto: page.coverPhoto ?? null,
      parentPageId: page.parentPageId ?? null,
      position: page.position,
      content: page.content ?? null,
      ydoc: page.ydoc ? Buffer.from(page.ydoc).toString('base64') : null,
      deletedAt: page.deletedAt ? new Date(page.deletedAt).toISOString() : null,
    },
    exclusions: ['comment-history', 'attachment-bytes', 'external-references'],
  });
  return { json, sha256: createHash('sha256').update(json).digest('hex') };
}
