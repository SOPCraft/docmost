import { SnapshotActor } from './version-snapshot';

export interface SavedSnapshot {
  schema: 'sop.page-snapshot/1';
  scope: string;
  actors: SnapshotActor[];
  page: {
    id: string;
    workspaceId: string;
    spaceId: string;
    title: string | null;
    content: unknown;
    deletedAt: string | null;
    [key: string]: unknown;
  };
  exclusions: string[];
}
export interface VersionTask {
  id: string;
  workspaceId: string;
  spaceId: string;
  pageId: string;
  revision: number;
  snapshot: SavedSnapshot;
  snapshotSha256: string;
  status: string;
  attempts: number;
  commitSha: string | null;
  createdAt: Date;
  nextAttemptAt: Date;
}
export interface SpaceBinding {
  workspaceId: string;
  spaceId: string;
  orgName: string;
  repoName: string;
  repoId: string | null;
  headSha: string | null;
  leaseId: string | null;
  leaseUntil: Date | null;
}
export interface ClaimedVersion {
  task: VersionTask;
  binding: SpaceBinding;
  leaseId: string;
}
export interface GitIdentity {
  id: string;
  name: string;
  email: string;
}
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SHA_PATTERN = /^([0-9a-f]{40}|[0-9a-f]{64})$/;
