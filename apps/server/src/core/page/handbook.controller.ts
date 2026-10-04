import { Body, Controller, Get, Post, HttpCode, HttpStatus, Param, Query, Req, Res, UseGuards, NotFoundException } from '@nestjs/common';
import { IsUUID, IsObject, IsBoolean, IsOptional, IsString, Matches, IsIn } from 'class-validator';
import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OAuthScope } from '../../common/decorators/oauth-scope.decorator';
import { User } from '../../database/types/entity.types';
import { HandbookService } from './services/handbook.service';
import { handbookReaderRuntime } from './handbook-reader-runtime';
export class HandbookPageDto { @IsUUID() pageId:string; @IsOptional() @IsUUID() jobId?:string; }
export class HandbookConfigurationDto extends HandbookPageDto { @IsObject() binding:object; @IsBoolean() autoUpdate:boolean; }
export class HandbookAutomaticDto extends HandbookPageDto { @IsBoolean() enabled:boolean; }
export class HandbookLayoutDto extends HandbookPageDto {
  @IsString() @Matches(/^[a-z][a-z0-9-]{0,63}$/) templateId:string;
  @IsString() @Matches(/^\d+\.\d+\.\d+$/) templateVersion:string;
  @IsIn(['comfortable','compact']) density:string;
}
export class HandbookLayoutApplyDto extends HandbookLayoutDto { @IsString() @Matches(/^[a-f0-9]{64}$/) proposalHash:string; @IsBoolean() autoUpdate:boolean; }
@UseGuards(JwtAuthGuard)
@Controller('pages/handbook')
export class HandbookController {
  constructor(private readonly handbooks:HandbookService){}
  @Post('status') @HttpCode(HttpStatus.OK) @OAuthScope('read')
  status(@Body() dto:HandbookPageDto,@AuthUser() user:User){return this.handbooks.status(dto.pageId,user,dto.jobId);}
  @Post('layout-options') @HttpCode(HttpStatus.OK) @OAuthScope('read')
  options(@Body() dto:HandbookPageDto,@AuthUser() user:User){return this.handbooks.layoutOptions(dto.pageId,user);}
  @Post('layout-preview') @HttpCode(HttpStatus.OK) @OAuthScope('write')
  preview(@Body() dto:HandbookLayoutDto,@AuthUser() user:User){return this.handbooks.previewLayout(dto.pageId,{id:dto.templateId,version:dto.templateVersion,density:dto.density},user);}
  @Post('layout-apply') @HttpCode(HttpStatus.OK) @OAuthScope('write')
  apply(@Body() dto:HandbookLayoutApplyDto,@AuthUser() user:User){return this.handbooks.applyLayout(dto.pageId,{id:dto.templateId,version:dto.templateVersion,density:dto.density},dto.proposalHash,dto.autoUpdate,user);}
  @Post('configure') @HttpCode(HttpStatus.OK) @OAuthScope('write')
  configure(@Body() dto:HandbookConfigurationDto,@AuthUser() user:User){return this.handbooks.configure(dto.pageId,dto.binding,dto.autoUpdate,user);}
  @Post('refresh') @HttpCode(HttpStatus.OK) @OAuthScope('write')
  refresh(@Body() dto:HandbookPageDto,@AuthUser() user:User){return this.handbooks.refresh(dto.pageId,user);}
  @Post('automatic') @HttpCode(HttpStatus.OK) @OAuthScope('write')
  automatic(@Body() dto:HandbookAutomaticDto,@AuthUser() user:User){return this.handbooks.automatic(dto.pageId,dto.enabled,user);}
  @Get('open/:pageId') @OAuthScope('read')
  async open(@Param('pageId') pageId:string,@AuthUser() user:User,@Res() res:FastifyReply,@Query('view') view?:string){
    const status=await this.handbooks.status(pageId,user);
    if(!status.current)throw new NotFoundException('No permitted complete handbook');
    return res.code(303).header('Cache-Control','private, no-store').header('Location',view==='source'?status.current.url.replace('index.html','source.html'):status.current.url).send();
  }
  @Get('runtime.js') @OAuthScope('read')
  runtime(@Res() res:FastifyReply){return res.type('text/javascript').header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').send(handbookReaderRuntime);}
  @Get('view/:pageId/:jobId/*') @OAuthScope('read')
  async file(@Param('pageId') pageId:string,@Param('jobId') jobId:string,@Req() req:FastifyRequest,@Res() res:FastifyReply,@AuthUser() user:User){
    const file=(req.params as any)['*'];const {bytes,job}=await this.handbooks.file(pageId,jobId,file,user);
    const types={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',png:'image/png',jpg:'image/jpeg',webp:'image/webp',mp4:'video/mp4'};
    const extension=file.split('.').pop();if(!types[extension])throw new NotFoundException();
    res.headers({'Content-Type':types[extension],'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache',
      'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-SOP-Source-Build':job.manifest.pageId,
      'Content-Security-Policy':"default-src 'none'; img-src 'self'; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; form-action 'none'"});
    if(extension==='html'){
      const notice=`<aside id="handbook-live-notice" role="status" style="padding:12px 20px;background:#fff0ca;color:#453000;border-bottom:1px solid #cbbc93;font:14px/1.8 sans-serif"><span>固定第${job.revision}版 · 正在核对原稿与访问权限</span> <a hidden id="handbook-new-version">打开新版</a></aside>`;
      const html=bytes.toString('utf8').replace('<html ',`<html data-managed-handbook="${pageId}" data-handbook-job="${jobId}" `)
        .replace(/(<body[^>]*>)/,`$1${notice}`).replace('</body>','<script defer src="/api/pages/handbook/runtime.js"></script></body>');
      return res.send(html);
    }
    if(extension==='mp4'){
      res.header('Accept-Ranges','bytes');if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
        const start=m?Number(m[1]):-1,end=m&&m[2]?Math.min(Number(m[2]),bytes.length-1):bytes.length-1;
        if(!m||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=bytes.length)return res.code(416).header('Content-Range',`bytes */${bytes.length}`).send();
        return res.code(206).header('Content-Range',`bytes ${start}-${end}/${bytes.length}`).header('Content-Length',end-start+1).send(bytes.subarray(start,end+1));
      }
    }
    return res.header('Content-Length',bytes.length).send(bytes);
  }
}
