import { TestingModule } from '@nestjs/testing';
import { createUnitModule } from 'src/test-support/unit-module';

import { CommentService } from './comment.service';
import { CommentRepo } from 'src/database/repos/comment/comment.repo';
import { PageRepo } from 'src/database/repos/page/page.repo';
import { WsService } from 'src/ws/ws.service';
import { CollaborationGateway } from 'src/collaboration/collaboration.gateway';
import { getQueueToken } from '@nestjs/bullmq';
import { QueueName } from 'src/integrations/queue/constants';
import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';

const createMocks = () => {
  return {
    comments: {
      findById: jest.fn(),
      insertComment: jest.fn(),
      updateComment: jest.fn(),
      findPageComments: jest.fn(),
    },
    pages: { findById: jest.fn() },
    ws: { emitCommentEvent: jest.fn() },
    collaboration: {},
    general: { add: jest.fn().mockResolvedValue({}) },
    notification: { add: jest.fn().mockResolvedValue({}) },
  };
};
describe('CommentService', () => {
  let module: TestingModule, subject: CommentService;
  let m: ReturnType<typeof createMocks>;
  beforeEach(async () => {
    m = createMocks();
    module = await createUnitModule(CommentService, [
      [CommentRepo, m.comments],
      [PageRepo, m.pages],
      [WsService, m.ws],
      [CollaborationGateway, m.collaboration],
      [getQueueToken(QueueName.GENERAL_QUEUE), m.general],
      [getQueueToken(QueueName.NOTIFICATION_QUEUE), m.notification],
    ]);
    subject = module.get(CommentService);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await module?.close();
  });
  it('should be defined', () => expect(subject).toBeDefined());

  it('reports a missing comment', async () => {
    await expect(subject.findById('c')).rejects.toThrow(NotFoundException);
  });
  it('does not list comments for a missing page', async () => {
    await expect(subject.findByPageId('p', {} as any)).rejects.toThrow(
      BadRequestException,
    );
    expect(m.comments.findPageComments).not.toHaveBeenCalled();
  });
  it('refuses editing another user comment before writing or broadcasting', async () => {
    const comment = {
      id: 'c',
      creatorId: 'other',
      content: { type: 'doc' },
    } as any;
    await expect(
      subject.update(
        comment,
        { commentId: 'c', content: '{"type":"doc"}' } as any,
        { id: 'u' } as any,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(m.comments.updateComment).not.toHaveBeenCalled();
    expect(m.ws.emitCommentEvent).not.toHaveBeenCalled();
  });
  it.each([
    { pageId: 'other', parentCommentId: null },
    { pageId: 'p', parentCommentId: 'already-a-reply' },
  ])('rejects an invalid reply parent', async (parent) => {
    m.comments.findById.mockResolvedValue(parent);
    const opts = {
      page: { id: 'p', spaceId: 's' },
      workspaceId: 'w',
      user: { id: 'u' },
    } as any;
    await expect(
      subject.create(opts, {
        content: '{"type":"doc"}',
        parentCommentId: 'parent',
      } as any),
    ).rejects.toThrow(BadRequestException);
    expect(m.comments.insertComment).not.toHaveBeenCalled();
  });
  it('preserves a comment when inserting and records the actual author', async () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '请补充操作说明' }],
        },
      ],
    };
    m.comments.insertComment.mockResolvedValue({ id: 'c' });
    m.comments.findById.mockResolvedValue({ id: 'c', content });
    const result = await subject.create(
      {
        page: { id: 'p', spaceId: 's' },
        workspaceId: 'w',
        user: { id: 'u' },
      } as any,
      { content: JSON.stringify(content), selection: 'a'.repeat(300) } as any,
    );
    expect(result.content).toEqual(content);
    expect(m.comments.insertComment).toHaveBeenCalledWith(
      expect.objectContaining({
        creatorId: 'u',
        workspaceId: 'w',
        spaceId: 's',
        pageId: 'p',
        selection: 'a'.repeat(250),
      }),
    );
  });
  it('does not announce an edit when the database write fails', async () => {
    m.comments.updateComment.mockRejectedValue(new Error('save failed'));
    const comment = {
      id: 'c',
      creatorId: 'u',
      content: { type: 'doc' },
    } as any;
    await expect(
      subject.update(
        comment,
        { content: '{"type":"doc"}' } as any,
        { id: 'u' } as any,
      ),
    ).rejects.toThrow('save failed');
    expect(m.ws.emitCommentEvent).not.toHaveBeenCalled();
  });
});
