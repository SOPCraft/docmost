import { Module } from '@nestjs/common';
import { PageService } from './services/page.service';
import { PageController } from './page.controller';
import { PageHistoryService } from './services/page-history.service';
import { TrashCleanupService } from './services/trash-cleanup.service';
import { BacklinkService } from './services/backlink.service';
import { StorageModule } from '../../integrations/storage/storage.module';
import { CollaborationModule } from '../../collaboration/collaboration.module';
import { WatcherModule } from '../watcher/watcher.module';
import { TransclusionModule } from './transclusion/transclusion.module';
import { LabelModule } from '../label/label.module';
import { VersioningModule } from '../../integrations/versioning/versioning.module';
import { VersionedTrashService } from './services/versioned-trash.service';
import { VersionHistoryService } from './services/version-history.service';
import { VersionHistoryController } from './version-history.controller';
import { HandbookController } from './handbook.controller';
import { HandbookService } from './services/handbook.service';
import { HandbookJobStore } from './services/handbook-job.store';

@Module({
  controllers: [PageController, VersionHistoryController, HandbookController],
  providers: [
    PageService,
    VersionedTrashService,
    VersionHistoryService,
    HandbookService,
    HandbookJobStore,
    PageHistoryService,
    TrashCleanupService,
    BacklinkService,
  ],
  exports: [PageService, PageHistoryService],
  imports: [
    VersioningModule,
    StorageModule,
    CollaborationModule,
    WatcherModule,
    TransclusionModule,
    LabelModule,
  ],
})
export class PageModule {}
