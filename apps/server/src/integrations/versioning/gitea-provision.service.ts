import { Injectable } from '@nestjs/common';
import { GiteaClient } from './gitea.client';
import { DeliveryError } from './gitea.config';
import { ClaimedVersion } from './version-delivery.types';
import { VersionDeliveryStore } from './version-delivery.store';

interface RepositoryInfo {
  id: number;
  private: boolean;
  description: string;
  empty: boolean;
}
@Injectable()
export class GiteaProvisionService {
  constructor(
    private readonly client: GiteaClient,
    private readonly store: VersionDeliveryStore,
  ) {}
  async ensure(claim: ClaimedVersion): Promise<void> {
    const { binding: b, task } = claim;
    const orgPath = `/orgs/${encodeURIComponent(b.orgName)}`;
    const root = this.client.repoPath(b.orgName, b.repoName);
    const orgMarker = `sop-workspace/1:${this.client.config.instanceId}:${task.workspaceId}`;
    const repoMarker = `sop-space/1:${this.client.config.instanceId}:${task.workspaceId}:${task.spaceId}`;
    let org = await this.client.optional<{
      description: string;
      visibility: string;
    }>(orgPath);
    if (!org && b.repoId) throw new DeliveryError('ORGANIZATION_MISSING', true);
    if (!org) {
      try {
        org = await this.client.request('/orgs', 'POST', {
          username: b.orgName,
          description: orgMarker,
          visibility: 'private',
        });
      } catch (error) {
        if (
          !(error instanceof DeliveryError) ||
          ![409, 422].includes(error.status)
        )
          throw error;
        org = await this.client.optional(orgPath);
      }
    }
    if (!org || org.description !== orgMarker || org.visibility !== 'private')
      throw new DeliveryError('ORGANIZATION_BINDING_CONFLICT', true);
    let repo = await this.client.optional<RepositoryInfo>(root);
    if (!repo && b.repoId) throw new DeliveryError('REPOSITORY_MISSING', true);
    if (!repo) {
      try {
        repo = await this.client.request(`${orgPath}/repos`, 'POST', {
          name: b.repoName,
          description: repoMarker,
          private: true,
          auto_init: true,
          default_branch: 'main',
          default_trust_model: 'committer',
        });
      } catch (error) {
        if (
          !(error instanceof DeliveryError) ||
          ![409, 422].includes(error.status)
        )
          throw error;
        repo = await this.client.optional(root);
      }
    }
    if (
      !repo ||
      repo.private !== true ||
      repo.description !== repoMarker ||
      !Number.isSafeInteger(repo.id)
    )
      throw new DeliveryError('REPOSITORY_BINDING_CONFLICT', true);
    if (b.repoId && String(repo.id) !== String(b.repoId))
      throw new DeliveryError('REPOSITORY_ID_CHANGED', true);
    if (!b.repoId) {
      const head = await this.client.head(root, 'main');
      if (!head) throw new DeliveryError('INITIAL_BRANCH_MISSING', true);
      const commits = await this.client.request<Array<{ sha: string }>>(
        `${root}/commits?sha=main&limit=2`,
      );
      if (commits.length !== 1 || commits[0].sha !== head)
        throw new DeliveryError('UNTRUSTED_INITIAL_HISTORY', true);
      const files = await this.client.request<
        Array<{ name: string; type: string }>
      >(`${root}/contents?ref=${head}`);
      if (
        files.length !== 1 ||
        files[0].name !== 'README.md' ||
        files[0].type !== 'file'
      )
        throw new DeliveryError('UNTRUSTED_INITIAL_TREE', true);
      if (!(await this.store.bindRepository(claim, String(repo.id), head)))
        throw new DeliveryError('LEASE_LOST');
      b.repoId = String(repo.id);
      b.headSha = head;
    }
  }
}
