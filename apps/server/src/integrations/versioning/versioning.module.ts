import { Module } from '@nestjs/common';
import { VersionCaptureService } from './version-capture.service';
import { VersionDeliveryStore } from './version-delivery.store';
import { VersionDeliveryWorker } from './version-delivery.worker';
import { GiteaClient } from './gitea.client';
import { GiteaProvisionService } from './gitea-provision.service';
import { GiteaCommitService } from './gitea-commit.service';

@Module({
  providers: [
    VersionCaptureService,
    VersionDeliveryStore,
    GiteaClient,
    GiteaProvisionService,
    GiteaCommitService,
    VersionDeliveryWorker,
  ],
  exports: [VersionCaptureService, GiteaClient, VersionDeliveryStore],
})
export class VersioningModule {}
