import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface PiHostDescription {
  enabled: boolean;
  workspaceId?: string;
  configurationId?: string;
  model?: { id: string; label: string; provider: string };
  skill?: { id: string; version: string; label: string };
  runtimeVersion?: string;
}

// Nest compiles this app as CommonJS; preserve native ESM import for Pi.
// The URL comes exclusively from administrator-owned server configuration.
const importModule = new Function('url', 'return import(url)') as
  (url: string) => Promise<any>;

@Injectable()
export class PiSopRuntimeService {
  private async module() {
    if (process.env.SOP_PI_ENABLED !== 'true') return null;
    const directory = process.env.SOP_PI_RUNTIME_PATH;
    if (!directory || !isAbsolute(directory))
      throw new ServiceUnavailableException('PI_HOST_CONFIGURATION_INVALID');
    try {
      const module = await importModule(pathToFileURL(join(directory, 'host.mjs')).href);
      if (module.HOST_CONTRACT !== 'sop.pi-host/1' ||
          typeof module.describeHost !== 'function' ||
          typeof module.organizeForHost !== 'function') throw new Error();
      return module;
    } catch {
      throw new ServiceUnavailableException('PI_HOST_RUNTIME_UNAVAILABLE');
    }
  }

  async describe(): Promise<PiHostDescription> {
    try {
      const module = await this.module();
      return module ? module.describeHost() : { enabled: false };
    } catch {
      throw new ServiceUnavailableException('PI_HOST_CONFIGURATION_INVALID');
    }
  }

  async organize(options: {
    context: { actorId: string; workspaceId: string };
    request: { skillId: string; instruction: string; selections: { pageId: string; versionId: string }[] };
    authorize: (input: any) => Promise<boolean>;
    readSource: (input: any) => Promise<any>;
    signal?: AbortSignal;
  }): Promise<any> {
    const module = await this.module();
    if (!module) throw new ServiceUnavailableException('PI_HOST_DISABLED');
    return module.organizeForHost(options);
  }
}
