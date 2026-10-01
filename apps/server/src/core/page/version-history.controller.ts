import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User } from '../../database/types/entity.types';
import { OAuthScope } from '../../common/decorators/oauth-scope.decorator';
import { VersionHistoryService } from './services/version-history.service';

export class VersionListDto {
  @IsUUID() pageId: string;
  @IsOptional() @IsInt() @Min(1) before?: number;
}
export class VersionReadDto {
  @IsUUID() pageId: string;
  @IsUUID() versionId: string;
}
@UseGuards(JwtAuthGuard)
@Controller('pages/versions')
export class VersionHistoryController {
  constructor(private readonly history: VersionHistoryService) {}
  @Post('list')
  @HttpCode(HttpStatus.OK)
  @OAuthScope('read')
  list(@Body() dto: VersionListDto, @AuthUser() user: User) {
    return this.history.list(dto.pageId, user, dto.before);
  }
  @Post('info')
  @HttpCode(HttpStatus.OK)
  @OAuthScope('read')
  info(@Body() dto: VersionReadDto, @AuthUser() user: User) {
    return this.history.read(dto.pageId, dto.versionId, user);
  }
}
