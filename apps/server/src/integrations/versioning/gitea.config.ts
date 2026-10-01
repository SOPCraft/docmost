import { readVersioningConfig } from './versioning.config';
import { UUID_PATTERN } from './version-delivery.types';

export interface GiteaConfig {
  enabled: boolean;
  url: string;
  token: string;
  instanceId: string;
  timeoutMs: number;
}

export function readGiteaConfig(env = process.env): Readonly<GiteaConfig> {
  const flag = env.SOP_GITEA_SYNC_ENABLED;
  if (flag && !['true', 'false'].includes(flag))
    throw new Error('Invalid sync flag');
  if (flag !== 'true')
    return Object.freeze({
      enabled: false,
      url: '',
      token: '',
      instanceId: '',
      timeoutMs: 10000,
    });
  if (!readVersioningConfig(env).enabled)
    throw new Error('Sync requires version capture');
  let url: URL;
  try {
    url = new URL(env.SOP_GITEA_URL || '');
  } catch {
    throw new Error('Invalid Gitea origin');
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Invalid Gitea origin');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && env.SOP_GITEA_ALLOW_HTTP === 'true')
  )
    throw new Error(
      'Gitea requires HTTPS or explicit private HTTP configuration',
    );
  const token = env.SOP_GITEA_TOKEN || '';
  if (!token || /\s/.test(token))
    throw new Error('Missing or invalid Gitea token');
  const instanceId = env.SOP_GITEA_INSTANCE_ID || '';
  if (!UUID_PATTERN.test(instanceId))
    throw new Error('A persistent installation UUID is required');
  return Object.freeze({
    enabled: true,
    url: url.origin,
    token,
    instanceId,
    timeoutMs: 10000,
  });
}

export class DeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly blocked = false,
    readonly status?: number,
  ) {
    super(code);
    this.name = 'DeliveryError';
  }
}
