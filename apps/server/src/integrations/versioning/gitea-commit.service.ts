import { Injectable } from '@nestjs/common';
import { GiteaClient } from './gitea.client';
import { DeliveryError } from './gitea.config';
import { ClaimedVersion, GitIdentity } from './version-delivery.types';
import { assertSha, snapshotBytes } from './version-delivery.validation';
import { canonicalJson } from './version-snapshot';

@Injectable()
export class GiteaCommitService {
  constructor(private readonly client: GiteaClient) {}
  async deliver(claim: ClaimedVersion, actors: GitIdentity[]): Promise<string> {
    const { task, binding: b } = claim;
    snapshotBytes(task);
    const base = assertSha(b.headSha);
    const root = this.client.repoPath(b.orgName, b.repoName);
    const stage = `sop-task-${task.id}`;
    const eventPath = `.sop/versions/${task.id}.json`;
    const pagePath = `pages/${task.pageId}/document.json`;
    const envelope = canonicalJson({
      schema: 'sop.delivery/1',
      taskId: task.id,
      revision: task.revision,
      parent: base,
      snapshotSha256: task.snapshotSha256.trim(),
      snapshot: task.snapshot,
    });
    const current = canonicalJson(task.snapshot.page);
    const main = await this.client.head(root, 'main');
    // A lost response or worker crash can leave the exact task already committed.
    if (main !== base) {
      if (!main) throw new DeliveryError('REMOTE_HEAD_MISSING', true);
      await this.verify(
        root,
        main,
        base,
        eventPath,
        pagePath,
        envelope,
        current,
        !!task.snapshot.page.deletedAt,
      );
      return main;
    }
    let staged = await this.client.head(root, stage);
    if (!staged) {
      try {
        await this.client.request(`${root}/branches`, 'POST', {
          new_branch_name: stage,
          old_ref_name: base,
        });
      } catch (error) {
        if (
          !(error instanceof DeliveryError) ||
          ![409, 422].includes(error.status)
        )
          throw error;
      }
      staged = await this.client.head(root, stage);
      if (!staged) throw new DeliveryError('STAGING_BRANCH_MISSING');
    }
    if (staged === base) {
      const old = await this.client.file(root, pagePath, base);
      const files: Array<Record<string, string>> = [
        {
          operation: 'create',
          path: eventPath,
          content: Buffer.from(envelope).toString('base64'),
        },
      ];
      if (task.snapshot.page.deletedAt) {
        if (old)
          files.push({ operation: 'delete', path: pagePath, sha: old.sha });
      } else {
        files.push({
          operation: old ? 'update' : 'create',
          path: pagePath,
          content: Buffer.from(current).toString('base64'),
          ...(old ? { sha: old.sha } : {}),
        });
      }
      const message =
        `SOP version ${task.id}\n\n` +
        actors.map((a) => `Co-authored-by: ${a.name} <${a.email}>`).join('\n');
      try {
        const response = await this.client.request<{ commit: { sha: string } }>(
          `${root}/contents`,
          'POST',
          {
            branch: stage,
            files,
            force_push: false,
            message,
            author: { name: actors[0].name, email: actors[0].email },
            committer: {
              name: 'SOP version service',
              email: 'sync@sop.invalid',
            },
            dates: {
              author: new Date(task.createdAt).toISOString(),
              committer: new Date(task.createdAt).toISOString(),
            },
          },
        );
        staged = assertSha(response.commit?.sha);
      } catch (error) {
        if (
          !(error instanceof DeliveryError) ||
          ![409, 422].includes(error.status)
        )
          throw error;
        staged = await this.client.head(root, stage);
      }
    }
    assertSha(staged);
    await this.verify(
      root,
      staged,
      base,
      eventPath,
      pagePath,
      envelope,
      current,
      !!task.snapshot.page.deletedAt,
    );
    try {
      await this.client.request(`${root}/branches/main`, 'PUT', {
        old_commit_id: base,
        new_commit_id: staged,
        force: false,
      });
    } catch (error) {
      if (!(error instanceof DeliveryError) || error.status !== 409)
        throw error;
      if ((await this.client.head(root, 'main')) !== staged)
        throw new DeliveryError('REMOTE_HEAD_CONFLICT', true);
    }
    if ((await this.client.head(root, 'main')) !== staged)
      throw new DeliveryError('REMOTE_HEAD_CONFLICT', true);
    return staged;
  }

  private async verify(
    root: string,
    commit: string,
    base: string,
    eventPath: string,
    pagePath: string,
    envelope: string,
    page: string,
    deleted: boolean,
  ): Promise<void> {
    const info = await this.client.request<{
      sha: string;
      parents: Array<{ sha: string }>;
      files: Array<{ filename: string }>;
    }>(`${root}/git/commits/${assertSha(commit)}?files=true&stat=false`);
    if (
      info.sha !== commit ||
      info.parents?.length !== 1 ||
      info.parents[0].sha !== base ||
      !Array.isArray(info.files) ||
      !info.files.some((f) => f.filename === eventPath) ||
      info.files.some((f) => ![eventPath, pagePath].includes(f.filename))
    )
      throw new DeliveryError('REMOTE_COMMIT_CONFLICT', true);
    const event = await this.client.file(root, eventPath, commit);
    if (
      !event ||
      Buffer.from(event.content, 'base64').toString('utf8') !== envelope
    )
      throw new DeliveryError('REMOTE_SNAPSHOT_CONFLICT', true);
    const latest = await this.client.file(root, pagePath, commit);
    if (
      deleted
        ? latest !== null
        : !latest ||
          Buffer.from(latest.content, 'base64').toString('utf8') !== page
    )
      throw new DeliveryError('REMOTE_PAGE_CONFLICT', true);
  }
}
