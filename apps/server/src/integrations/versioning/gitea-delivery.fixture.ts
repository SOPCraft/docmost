// Contract simulation only. This is NOT a substitute for a real Gitea integration run.
import { createHash } from 'node:crypto';
import { GiteaClient } from './gitea.client';
import { DeliveryError } from './gitea.config';
interface FakeCommit {
  sha: string;
  parents: Array<{ sha: string }>;
  files: Array<{ filename: string }>;
  tree: Map<string, string>;
}
interface FakeRepository {
  id: number;
  private: boolean;
  description: string;
  empty: boolean;
  branches: Map<string, string>;
  commits: Map<string, FakeCommit>;
}
const sha = (value: string) => createHash('sha1').update(value).digest('hex');
export class MemoryGitea extends GiteaClient {
  orgs = new Map<string, { description: string; visibility: string }>();
  repos = new Map<string, FakeRepository>();
  writes = 0;
  requests: Array<{ path: string; method: string; body: any }> = [];
  fault:
    | 'before-stage'
    | 'after-stage'
    | 'before-main'
    | 'after-main'
    | 'race-main'
    | null = null;
  async request<T>(path: string, method = 'GET', body?: any): Promise<T> {
    this.requests.push({ path, method, body });
    const url = new URL(path, 'http://fixture.invalid');
    const parts = url.pathname
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent);
    const notFound = () => {
      throw new DeliveryError('GITEA_HTTP_404', false, 404);
    };
    if (parts[0] === 'orgs') {
      if (method === 'POST' && parts.length === 1) {
        if (this.orgs.has(body.username))
          throw new DeliveryError('GITEA_HTTP_422', true, 422);
        const org = {
          description: body.description,
          visibility: body.visibility,
        };
        this.orgs.set(body.username, org);
        return org as T;
      }
      if (method === 'GET') return (this.orgs.get(parts[1]) ?? notFound()) as T;
      if (parts[2] === 'repos' && method === 'POST') {
        const key = `${parts[1]}/${body.name}`;
        if (this.repos.has(key))
          throw new DeliveryError('GITEA_HTTP_409', true, 409);
        const base = sha(key);
        const initial = {
          sha: base,
          parents: [],
          files: [{ filename: 'README.md' }],
          tree: new Map([['README.md', 'test repository']]),
        };
        const repo: FakeRepository = {
          id: this.repos.size + 1,
          private: body.private,
          description: body.description,
          empty: false,
          branches: new Map([['main', base]]),
          commits: new Map([[base, initial]]),
        };
        this.repos.set(key, repo);
        return repo as T;
      }
    }
    const key = `${parts[1]}/${parts[2]}`;
    const repo = this.repos.get(key) ?? notFound();
    if (parts.length === 3 && method === 'GET') return repo as T;
    if (parts[3] === 'branches') {
      if (method === 'GET')
        return {
          commit: { id: repo.branches.get(parts[4]) ?? notFound() },
        } as T;
      if (method === 'POST') {
        if (repo.branches.has(body.new_branch_name))
          throw new DeliveryError('GITEA_HTTP_409', true, 409);
        if (!repo.commits.has(body.old_ref_name)) notFound();
        repo.branches.set(body.new_branch_name, body.old_ref_name);
        return {} as T;
      }
      if (method === 'PUT') {
        this.throwFault('before-main');
        if (
          body.force !== false ||
          repo.branches.get(parts[4]) !== body.old_commit_id
        )
          throw new DeliveryError('GITEA_HTTP_409', true, 409);
        repo.branches.set(parts[4], body.new_commit_id);
        this.writes++;
        this.throwFault('after-main');
        return undefined as T;
      }
    }
    if (parts[3] === 'commits' && method === 'GET') {
      let id = repo.branches.get(url.searchParams.get('sha'));
      const commits = [];
      while (id && commits.length < 2) {
        const c = repo.commits.get(id);
        commits.push({ sha: id });
        id = c.parents[0]?.sha;
      }
      return commits as T;
    }
    if (parts[3] === 'git' && parts[4] === 'commits')
      return (repo.commits.get(parts[5]) ?? notFound()) as T;
    if (parts[3] === 'contents') {
      if (method === 'GET') {
        const commit =
          repo.commits.get(url.searchParams.get('ref')) ?? notFound();
        if (parts.length === 4)
          return [...commit.tree.keys()].map((name) => ({
            name,
            type: 'file',
          })) as T;
        const filename = parts.slice(4).join('/');
        const value = commit.tree.get(filename);
        if (value === undefined) return notFound();
        return {
          sha: sha(value),
          content: Buffer.from(value).toString('base64'),
        } as T;
      }
      if (method === 'POST') {
        this.throwFault('before-stage');
        const parent = repo.branches.get(body.branch);
        const old = repo.commits.get(parent);
        const tree = new Map(old.tree);
        for (const file of body.files) {
          if (file.operation === 'create' && tree.has(file.path))
            throw new DeliveryError('GITEA_HTTP_422', true, 422);
          if (
            ['update', 'delete'].includes(file.operation) &&
            sha(tree.get(file.path) ?? '') !== file.sha
          )
            throw new DeliveryError('GITEA_HTTP_409', true, 409);
          if (file.operation === 'delete') tree.delete(file.path);
          else
            tree.set(
              file.path,
              Buffer.from(file.content, 'base64').toString('utf8'),
            );
        }
        const id = sha(parent + JSON.stringify(body));
        repo.commits.set(id, {
          sha: id,
          parents: [{ sha: parent }],
          files: body.files.map((f) => ({ filename: f.path })),
          tree,
        });
        repo.branches.set(body.branch, id);
        if (this.fault === 'race-main') {
          this.fault = null;
          this.externalChange(key);
        }
        this.throwFault('after-stage');
        return { commit: { sha: id } } as T;
      }
    }
    throw new Error(`Unimplemented fixture route: ${method} ${path}`);
  }
  private throwFault(point: string) {
    if (this.fault === point) {
      this.fault = null;
      throw new DeliveryError('GITEA_UNREACHABLE');
    }
  }
  externalChange(key: string) {
    const repo = this.repos.get(key);
    const parent = repo.branches.get('main');
    const old = repo.commits.get(parent);
    const id = sha(parent + 'external');
    const tree = new Map(old.tree);
    tree.set('unexpected.txt', 'external edit');
    repo.commits.set(id, {
      sha: id,
      parents: [{ sha: parent }],
      files: [{ filename: 'unexpected.txt' }],
      tree,
    });
    repo.branches.set('main', id);
    return id;
  }
}
