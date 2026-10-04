import {
  Body, Controller, Post, HttpCode, HttpStatus, Header, UseGuards, Req, Res,
  ConflictException, GatewayTimeoutException,
} from '@nestjs/common';
import { IsArray, ArrayMinSize, ArrayMaxSize, IsUUID, IsString, MaxLength, Equals, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { RequireSessionAuth } from '../../common/decorators/require-session-auth.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User } from '../../database/types/entity.types';
import { PiSopService } from './services/pi-sop.service';

class PiPageDto { @IsUUID() pageId: string; }
class PiPrepareDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsUUID('all', { each: true }) pageIds: string[];
}
class PiSelectionDto {
  @IsUUID() pageId: string;
  @IsUUID() versionId: string;
}
class PiSelectionsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10)
  @ValidateNested({ each: true }) @Type(() => PiSelectionDto) selections: PiSelectionDto[];
}
class PiGenerateDto extends PiSelectionsDto {
  @IsString() @MaxLength(4000) instruction: string;
  @Equals('sop-organizer') skillId: string;
  @Matches(/^[a-f0-9]{64}$/) configurationId: string;
}

@UseGuards(JwtAuthGuard)
@RequireSessionAuth()
@Controller('pages/pi-sop')
export class PiSopController {
  constructor(private readonly sop: PiSopService) {}

  @Post('status') @HttpCode(HttpStatus.OK) @Header('Cache-Control', 'private, no-store')
  status(@Body() body: PiPageDto, @AuthUser() user: User) { return this.sop.status(body.pageId, user); }

  @Post('prepare') @HttpCode(HttpStatus.OK) @Header('Cache-Control', 'private, no-store')
  prepare(@Body() body: PiPrepareDto, @AuthUser() user: User) { return this.sop.prepare(body, user); }

  @Post('revalidate') @HttpCode(HttpStatus.OK) @Header('Cache-Control', 'private, no-store')
  revalidate(@Body() body: PiSelectionsDto, @AuthUser() user: User) { return this.sop.revalidate(body, user); }

  @Post('generate') @HttpCode(HttpStatus.OK) @Header('Cache-Control', 'private, no-store')
  async generate(@Body() body: PiGenerateDto, @AuthUser() user: User,
    @Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    const controller = new AbortController();
    const disconnect = () => { if (!res.raw.writableEnded) controller.abort(new ConflictException('PI_CANCELLED')); };
    req.raw.once('aborted', disconnect);
    res.raw.once('close', disconnect);
    const timer = setTimeout(() => controller.abort(new GatewayTimeoutException('PI_TIMEOUT')), 65000);
    timer.unref();
    let stop: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      stop = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', stop, { once: true });
    });
    if (req.raw.aborted) disconnect();
    try {
      return await Promise.race([this.sop.generate(body, user, controller.signal), cancelled]);
    } finally {
      clearTimeout(timer);
      req.raw.off('aborted', disconnect);
      res.raw.off('close', disconnect);
      controller.signal.removeEventListener('abort', stop);
    }
  }
}
