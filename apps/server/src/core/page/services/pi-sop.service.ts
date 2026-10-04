import {
  Injectable, BadRequestException, ConflictException, ForbiddenException,
  ServiceUnavailableException, HttpException,
} from '@nestjs/common';
import { User } from '../../../database/types/entity.types';
import { UserRepo } from '../../../database/repos/user/user.repo';
import { VersionHistoryService } from './version-history.service';
import { PiSopRuntimeService } from './pi-sop-runtime.service';

export interface PiSelection { pageId: string; versionId: string }
export interface PiGenerateRequest {
  selections: PiSelection[];
  instruction: string;
  skillId: string;
  configurationId: string;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function exact(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key)))
    throw new BadRequestException('PI_REQUEST_INVALID');
}
export function validatePiSelections(value: unknown): asserts value is PiSelection[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10)
    throw new BadRequestException('PI_SOURCE_LIMIT');
  const seen = new Set<string>();
  for (const selection of value) {
    exact(selection, ['pageId', 'versionId']);
    if (!uuid.test(selection.pageId) || !uuid.test(selection.versionId) ||
        seen.has(selection.pageId.toLowerCase())) throw new BadRequestException('PI_SOURCE_SELECTION_INVALID');
    seen.add(selection.pageId.toLowerCase());
  }
}

@Injectable()
export class PiSopService {
  // Per-process resource guard, not a distributed billing/quota system.
  private readonly active = new Set<string>();
  constructor(
    private readonly users: UserRepo,
    private readonly history: VersionHistoryService,
    private readonly runtime: PiSopRuntimeService,
  ) {}

  private async actor(user: User) {
    const current = await this.users.findById(user.id, user.workspaceId);
    if (!current || current.id !== user.id || current.workspaceId !== user.workspaceId ||
        current.deletedAt || current.deactivatedAt) throw new ForbiddenException('PI_ACCOUNT_UNAVAILABLE');
    return current;
  }

  private checkSignal(signal?: AbortSignal) {
    if (signal?.aborted) throw new ConflictException('PI_CANCELLED');
  }

  async status(pageId: string, user: User) {
    if (!uuid.test(pageId)) throw new BadRequestException('PI_SOURCE_SELECTION_INVALID');
    const actor = await this.actor(user);
    await this.history.displayAccess(pageId, actor);
    const description = await this.runtime.describe();
    if (!description.enabled || description.workspaceId !== actor.workspaceId.toLowerCase())
      return { enabled: false };
    return {
      enabled: true, configurationId: description.configurationId,
      model: description.model, skill: description.skill,
      runtimeVersion: description.runtimeVersion, saved: false,
    };
  }

  async prepare(body: { pageIds: string[] }, user: User) {
    exact(body, ['pageIds']);
    if (!Array.isArray(body.pageIds) || body.pageIds.length < 1 || body.pageIds.length > 10 ||
        body.pageIds.some(id => typeof id !== 'string' || !uuid.test(id)) ||
        new Set(body.pageIds.map(id => id.toLowerCase())).size !== body.pageIds.length)
      throw new BadRequestException('PI_SOURCE_SELECTION_INVALID');
    const items = [];
    for (const pageId of body.pageIds) {
      const actor = await this.actor(user);
      await this.history.displayAccess(pageId, actor);
      const versions = await this.history.list(pageId, actor, undefined, { summaries: false });
      const latest = versions.items[0];
      if (!latest || latest.status !== 'synced') throw new ConflictException('PI_SOURCE_VERSION_PENDING');
      const source = await this.history.displaySource(pageId, latest.id, actor);
      items.push({ pageId: source.pageId, versionId: source.versionId,
        revision: source.revision, title: source.title });
    }
    // Do not return earlier sources after a later source revoked their access.
    await this.revalidate({ selections: items.map(({ pageId, versionId }) => ({ pageId, versionId })) }, user);
    return { items };
  }

  private async source(selection: PiSelection, user: User, signal?: AbortSignal) {
    this.checkSignal(signal);
    const actor = await this.actor(user);
    await this.history.displayAccess(selection.pageId, actor);
    const result = await this.history.displaySource(selection.pageId, selection.versionId, actor);
    this.checkSignal(signal);
    return result;
  }

  async revalidate(body: { selections: PiSelection[] }, user: User) {
    exact(body, ['selections']);
    validatePiSelections(body.selections);
    for (const selection of body.selections) await this.source(selection, user);
    await this.actor(user);
    return { valid: true };
  }

  async generate(body: PiGenerateRequest, user: User, signal?: AbortSignal) {
    exact(body, ['selections', 'instruction', 'skillId', 'configurationId']);
    validatePiSelections(body.selections);
    if (body.skillId !== 'sop-organizer' || typeof body.instruction !== 'string' || body.instruction.length > 4000 ||
        typeof body.configurationId !== 'string' || !/^[a-f0-9]{64}$/.test(body.configurationId))
      throw new BadRequestException('PI_REQUEST_INVALID');
    const input = structuredClone(body);
    const key = `${user.workspaceId}:${user.id}`;
    if (this.active.has(key) || this.active.size >= 2) throw new ConflictException('PI_GENERATION_BUSY');
    this.active.add(key);
    try {
      this.checkSignal(signal);
      const actor = await this.actor(user);
      const config = await this.runtime.describe();
      if (!config.enabled || config.workspaceId !== actor.workspaceId.toLowerCase())
        throw new ServiceUnavailableException('PI_HOST_DISABLED');
      if (config.configurationId !== input.configurationId) throw new ConflictException('PI_MODEL_CONFIGURATION_CHANGED');
      const selections = input.selections.map(item => ({ pageId: item.pageId.toLowerCase(), versionId: item.versionId.toLowerCase() }));
      // Check the entire selection before invoking any model capability.
      for (const selection of selections) await this.source(selection, actor, signal);
      this.checkSignal(signal);
      const result = await this.runtime.organize({
        context: { actorId: actor.id, workspaceId: actor.workspaceId },
        request: { skillId: input.skillId, instruction: input.instruction, selections },
        authorize: async ({ selection, signal: callbackSignal }) => {
          this.checkSignal(callbackSignal);
          const current = await this.actor(actor);
          await this.history.displayAccess(selection.pageId, current);
          this.checkSignal(callbackSignal);
          return true;
        },
        readSource: ({ selection, signal: callbackSignal }) => this.source(selection, actor, callbackSignal),
        signal,
      });
      this.checkSignal(signal);
      await this.revalidate({ selections }, actor);
      const after = await this.runtime.describe();
      if (!after.enabled || after.configurationId !== input.configurationId || after.workspaceId !== actor.workspaceId.toLowerCase())
        throw new ConflictException('PI_MODEL_CONFIGURATION_CHANGED');
      if (result?.schema !== 'sop.draft-envelope/1' || result.reviewRequired !== true ||
          result.provenance?.actorId !== actor.id || result.provenance?.workspaceId !== actor.workspaceId ||
          JSON.stringify(result.provenance?.sources?.map(({ pageId, versionId }) => ({ pageId, versionId }))) !== JSON.stringify(selections))
        throw new ServiceUnavailableException('PI_RESULT_IDENTITY_INVALID');
      this.checkSignal(signal);
      return { ...result, saved: false };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Never expose provider exceptions, credentials, source fragments or thinking.
      const safe = new Set(['PI_CANCELLED', 'PI_TIMEOUT', 'SOURCE_ACCESS_DENIED', 'SOURCE_ACCESS_CHECK_FAILED',
        'SOURCE_READ_FAILED', 'SOURCE_CHANGED_DURING_GENERATION', 'UNSUPPORTED_SOURCE_STRUCTURE',
        'SOURCE_TOO_LARGE_NO_TRUNCATION', 'SOURCE_COVERAGE_INCOMPLETE', 'PI_HOST_CONFIGURATION_CHANGED']);
      const candidate = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      const code = typeof candidate === 'string' && safe.has(candidate) ? candidate : 'PI_GENERATION_FAILED';
      throw new ServiceUnavailableException(code);
    } finally {
      this.active.delete(key);
    }
  }
}
