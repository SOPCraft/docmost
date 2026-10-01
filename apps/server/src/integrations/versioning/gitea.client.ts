import { Injectable } from '@nestjs/common';
import { DeliveryError, readGiteaConfig } from './gitea.config';
import { assertSha } from './version-delivery.validation';

@Injectable()
export class GiteaClient {
  readonly config = readGiteaConfig();

  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    if (!this.config.enabled) throw new DeliveryError('SYNC_DISABLED', true);
    if (!path.startsWith('/') || path.startsWith('//'))
      throw new DeliveryError('INVALID_API_PATH', true);
    let response: Response;
    try {
      response = await fetch(`${this.config.url}/api/v1${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(this.config.timeoutMs),
        headers: {
          Authorization: `token ${this.config.token}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new DeliveryError('GITEA_UNREACHABLE');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new DeliveryError(
        `GITEA_HTTP_${response.status}`,
        [400, 401, 403, 409, 422].includes(response.status),
        response.status,
      );
    }
    if (response.status === 204) return undefined as T;
    try {
      const reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 12 * 1024 * 1024) {
          await reader.cancel();
          throw new DeliveryError('GITEA_RESPONSE_TOO_LARGE', true);
        }
        parts.push(value);
      }
      return JSON.parse(Buffer.concat(parts).toString('utf8')) as T;
    } catch (error) {
      if (error instanceof DeliveryError) throw error;
      throw new DeliveryError('GITEA_INVALID_RESPONSE');
    }
  }

  async optional<T>(path: string): Promise<T | null> {
    try {
      return await this.request<T>(path);
    } catch (error) {
      if (error instanceof DeliveryError && error.status === 404) return null;
      throw error;
    }
  }

  repoPath(org: string, repo: string): string {
    return `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;
  }
  async head(root: string, branch: string): Promise<string | null> {
    const info = await this.optional<{ commit: { id: string } }>(
      `${root}/branches/${encodeURIComponent(branch)}`,
    );
    return info ? assertSha(info.commit?.id) : null;
  }
  async file(
    root: string,
    path: string,
    ref: string,
  ): Promise<{ sha: string; content: string } | null> {
    assertSha(ref);
    return this.optional(`${root}/contents/${path}?ref=${ref}`);
  }
}
