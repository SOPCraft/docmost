import { createHash } from 'node:crypto';
import { canonicalJson } from './version-snapshot';
import { DeliveryError } from './gitea.config';
import {
  VersionTask,
  UUID_PATTERN,
  SHA_PATTERN,
} from './version-delivery.types';

export function assertUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new DeliveryError('INVALID_ID', true);
  return value;
}
export function assertSha(value: string): string {
  if (!SHA_PATTERN.test(value || ''))
    throw new DeliveryError('INVALID_COMMIT', true);
  return value;
}
export function snapshotBytes(task: VersionTask): string {
  const s = task.snapshot;
  if (
    s?.schema !== 'sop.page-snapshot/1' ||
    s.page?.id !== task.pageId ||
    s.page?.workspaceId !== task.workspaceId ||
    s.page?.spaceId !== task.spaceId ||
    !Array.isArray(s.actors) ||
    !s.actors.length
  )
    throw new DeliveryError('SNAPSHOT_SCOPE_MISMATCH', true);
  [task.id, task.pageId, task.workspaceId, task.spaceId].forEach(assertUuid);
  s.actors.forEach((a) => {
    assertUuid(a.id);
    if (typeof a.name !== 'string')
      throw new DeliveryError('INVALID_ACTOR', true);
  });
  const bytes = canonicalJson(s);
  if (Buffer.byteLength(bytes) > 8 * 1024 * 1024)
    throw new DeliveryError('SNAPSHOT_TOO_LARGE', true);
  if (
    createHash('sha256').update(bytes).digest('hex') !==
    task.snapshotSha256.trim()
  )
    throw new DeliveryError('SNAPSHOT_DIGEST_MISMATCH', true);
  return bytes;
}
export function gitActorName(name: string): string {
  const clean = Array.from(name).map(character => {
    const code = character.codePointAt(0);
    return code < 32 || code === 127 || character === '<' || character === '>' ? ' ' : character;
  }).join('').trim();
  return clean.slice(0, 120) || 'Document contributor';
}
