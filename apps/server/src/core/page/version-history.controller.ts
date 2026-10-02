import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User } from '../../database/types/entity.types';
import { OAuthScope } from '../../common/decorators/oauth-scope.decorator';
import { VersionHistoryService } from './services/version-history.service';

export class VersionListDto {
  @IsUUID() pageId: string;
  @IsOptional() @IsInt() @Min(1) before?: number;
  @IsOptional() @IsISO8601({ strict: true }) from?: string;
  @IsOptional() @IsISO8601({ strict: true }) until?: string;
  @IsOptional() @IsUUID() actorId?: string;
  @IsOptional() @IsBoolean() summaries?: boolean;
}
export class VersionReadDto {
  @IsUUID() pageId: string;
  @IsUUID() versionId: string;
}
export class VersionCompareDto extends VersionReadDto {
  @IsOptional() @IsUUID() baseVersionId?: string;
}
export class VersionOptionsDto {
  @IsUUID() pageId: string;
}
@UseGuards(JwtAuthGuard)
@Controller('pages/versions')
export class VersionHistoryController {
  constructor(private readonly history: VersionHistoryService) {}
  @Post('list')
  @HttpCode(HttpStatus.OK)
  @OAuthScope('read')
  list(@Body() dto: VersionListDto, @AuthUser() user: User) {
    return this.history.list(dto.pageId, user, dto.before, {
      from: dto.from,
      until: dto.until,
      actorId: dto.actorId,
      summaries: dto.summaries,
    });
  }
  @Post('info')
  @HttpCode(HttpStatus.OK)
  @OAuthScope('read')
  info(@Body() dto: VersionReadDto, @AuthUser() user: User) {
    return this.history.read(dto.pageId, dto.versionId, user);
  }
  @Post('options')
  @HttpCode(HttpStatus.OK)
  @OAuthScope('read')
  options(@Body() dto: VersionOptionsDto, @AuthUser() user: User) {
    return this.history.options(dto.pageId, user);
  }
  @Post('compare')
  @HttpCode(HttpStatus.OK)
  @OAuthScope('read')
  compare(@Body() dto: VersionCompareDto, @AuthUser() user: User) {
    return this.history.compare(
      dto.pageId,
      dto.versionId,
      user,
      dto.baseVersionId,
    );
  }
}
