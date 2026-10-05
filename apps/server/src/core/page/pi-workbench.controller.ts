import { Body, Controller, Post, HttpCode, HttpStatus, Header, UseGuards } from '@nestjs/common';
import { IsUUID, IsArray, ArrayMaxSize, IsObject, IsInt, Min, Max, IsString, Matches, IsOptional, IsBoolean } from 'class-validator';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { RequireSessionAuth } from '../../common/decorators/require-session-auth.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User } from '../../database/types/entity.types';
import { PiWorkbenchService } from './services/pi-workbench.service';

export class WorkbenchPageDto { @IsUUID() pageId:string; }
export class WorkbenchSessionDto { @IsUUID() sessionId:string; }
export class WorkbenchSourcesDto extends WorkbenchSessionDto { @IsArray() @ArrayMaxSize(10) @IsUUID('all',{each:true}) pageIds:string[]; }
export class WorkbenchViewDto extends WorkbenchSessionDto { @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) after:number; }
export class WorkbenchCommandDto extends WorkbenchSessionDto { @IsObject() command:object; }
export class WorkbenchResponseDto extends WorkbenchSessionDto { @IsObject() response:object; }
export class WorkbenchModelDto { @IsObject() model:object; @IsUUID() revision:string; @IsOptional() @IsBoolean() remove?:boolean; }
export class WorkbenchArtifactDto extends WorkbenchSessionDto { @IsString() @Matches(/^[a-zA-Z0-9_.-]{1,200}$/) name:string; }

@UseGuards(JwtAuthGuard)
@RequireSessionAuth()
@Controller('pages/pi-workbench')
export class PiWorkbenchController {
  constructor(private readonly workbench:PiWorkbenchService) {}
  @Post('status') @HttpCode(HttpStatus.OK) @Header('Cache-Control','private, no-store')
  status(@Body() body:WorkbenchPageDto,@AuthUser() user:User){return this.workbench.status(body.pageId,user);}
  @Post('model-settings') @HttpCode(HttpStatus.OK) @Header('Cache-Control','private, no-store')
  modelSettings(@AuthUser() user:User){return this.workbench.modelSettings(user);}
  @Post('save-model') @HttpCode(HttpStatus.OK) @Header('Cache-Control','private, no-store')
  saveModel(@Body() body:WorkbenchModelDto,@AuthUser() user:User){return this.workbench.saveModel(body,user);}
  @Post('list') @HttpCode(HttpStatus.OK) @Header('Cache-Control','private, no-store')
  list(@AuthUser() user:User){return this.workbench.list(user);}
  @Post('create') @HttpCode(HttpStatus.OK) @Header('Cache-Control','private, no-store')
  create(@Body() body:WorkbenchSourcesDto,@AuthUser() user:User){return this.workbench.create(body,user);}
  @Post('attach') @HttpCode(HttpStatus.OK) @Header('Cache-Control','private, no-store')
  attach(@Body() body:WorkbenchSourcesDto,@AuthUser() user:User){return this.workbench.attach(body,user);}
  @Post('view') @HttpCode(HttpStatus.OK) @Header('Cache-Control','private, no-store')
  view(@Body() body:WorkbenchViewDto,@AuthUser() user:User){return this.workbench.view(body,user);}
  @Post('command') @HttpCode(HttpStatus.OK) @Header('Cache-Control','private, no-store')
  command(@Body() body:WorkbenchCommandDto,@AuthUser() user:User){return this.workbench.command(body,user);}
  @Post('respond') @HttpCode(HttpStatus.OK) @Header('Cache-Control','private, no-store')
  respond(@Body() body:WorkbenchResponseDto,@AuthUser() user:User){return this.workbench.respond(body,user);}
  @Post('artifacts') @HttpCode(HttpStatus.OK) @Header('Cache-Control','private, no-store')
  artifacts(@Body() body:WorkbenchSessionDto,@AuthUser() user:User){return this.workbench.artifacts(body,user);}
  @Post('artifact') @HttpCode(HttpStatus.OK) @Header('Cache-Control','private, no-store')
  artifact(@Body() body:WorkbenchArtifactDto,@AuthUser() user:User){return this.workbench.artifact(body,user);}
}
