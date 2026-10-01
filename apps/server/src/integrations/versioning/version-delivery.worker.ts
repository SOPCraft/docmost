import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { GiteaClient } from './gitea.client';
import { GiteaProvisionService } from './gitea-provision.service';
import { GiteaCommitService } from './gitea-commit.service';
import { VersionDeliveryStore } from './version-delivery.store';
import { DeliveryError } from './gitea.config';
import { snapshotBytes } from './version-delivery.validation';

@Injectable()
export class VersionDeliveryWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(VersionDeliveryWorker.name);
  private timer: ReturnType<typeof setTimeout>;
  private running: Promise<void> | null = null;
  private stopped = false;
  constructor(
    private readonly client: GiteaClient,
    private readonly store: VersionDeliveryStore,
    private readonly provision: GiteaProvisionService,
    private readonly commits: GiteaCommitService,
  ) {}
  onApplicationBootstrap() {
    if (!this.client.config.enabled) return;
    const next = () => {
      this.timer = setTimeout(async () => {
        try {
          await this.tick();
        } catch {
          this.logger.warn(
            'Version delivery unavailable; persistent tasks retained',
          );
        }
        if (!this.stopped) next();
      }, 1000);
      this.timer.unref();
    };
    next();
  }
  async onApplicationShutdown() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }
  async tick(): Promise<void> {
    if (!this.client.config.enabled || this.stopped) return;
    if (this.running) return this.running;
    this.running = this.run();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }
  private async run(): Promise<void> {
    for (const space of await this.store.candidates()) {
      if (this.stopped) return;
      const claim = await this.store.claim(space.workspaceId, space.spaceId);
      if (!claim) continue;
      try {
        snapshotBytes(claim.task);
        await this.provision.ensure(claim);
        const actors = await this.store.identities(claim.task);
        const sha = await this.commits.deliver(claim, actors);
        await this.store.finish(claim, sha);
      } catch (error) {
        const failure =
          error instanceof DeliveryError
            ? error
            : new DeliveryError('DELIVERY_INTERNAL_ERROR');
        await this.store.fail(claim, failure.code, failure.blocked);
        this.logger.warn(`Version task ${claim.task.id}: ${failure.code}`);
      }
    }
  }
}
