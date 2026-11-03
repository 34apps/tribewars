// Tribe forum routes (contract: packages/engine/src/api.ts). Rules live in ForumService.

import type { FastifyInstance } from 'fastify';
import type {
  CreateBoardRequest,
  CreateThreadRequest,
  EditPostRequest,
  ForumBoardDto,
  ForumBoardsResponse,
  ForumPostDto,
  ForumThreadResponse,
  ForumThreadSummaryDto,
  ForumThreadsResponse,
  ReplyRequest,
  UpdateBoardRequest,
  UpdateThreadRequest,
} from '@clanfire/engine';
import type { AppContext } from '../context.ts';
import { playerOf, requireAuth } from './auth.ts';

const ID = { type: 'string', pattern: '^[0-9]{1,15}$' } as const;
const PAGE = { type: 'string', pattern: '^[0-9]{1,4}$' } as const;
const idParams = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } } as const;
const pageQuery = { type: 'object', additionalProperties: false, properties: { page: PAGE } } as const;
const VISIBILITY = { type: 'string', enum: ['members', 'leadership'] } as const;

// Lengths are re-checked in characters by the service; these caps only bound the bytes parsed.
const boardCreate = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: { name: { type: 'string', maxLength: 400 }, visibility: VISIBILITY, postRule: VISIBILITY },
} as const;
const boardUpdate = {
  type: 'object',
  additionalProperties: false,
  properties: { name: { type: 'string', maxLength: 400 }, visibility: VISIBILITY, postRule: VISIBILITY },
} as const;
const threadCreate = {
  type: 'object',
  required: ['title', 'body'],
  additionalProperties: false,
  properties: { title: { type: 'string', maxLength: 800 }, body: { type: 'string', maxLength: 16000 } },
} as const;
const bodyOnly = {
  type: 'object',
  required: ['body'],
  additionalProperties: false,
  properties: { body: { type: 'string', maxLength: 16000 } },
} as const;
const threadUpdate = {
  type: 'object',
  additionalProperties: false,
  properties: { pinned: { type: 'boolean' }, locked: { type: 'boolean' } },
} as const;

export function forumRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { onRequest: requireAuth(ctx) };
  const svc = ctx.forum;
  type Id = { Params: { id: string } };
  type Paged = Id & { Querystring: { page?: string } };
  const page = (q: { page?: string }): number => (q.page === undefined ? 0 : Number(q.page));
  const base = '/api/tribe/forum';

  app.get(`${base}/boards`, auth, async (req): Promise<ForumBoardsResponse> => svc.boards(playerOf(req), req.nowMs));

  app.post<{ Body: CreateBoardRequest }>(`${base}/boards`, { ...auth, schema: { body: boardCreate } }, async (req, reply): Promise<ForumBoardDto> => {
    const res = svc.createBoard(playerOf(req), req.body, req.nowMs);
    void reply.code(201);
    return res;
  });

  app.put<Id & { Body: UpdateBoardRequest }>(
    `${base}/boards/:id`,
    { ...auth, schema: { params: idParams, body: boardUpdate } },
    async (req): Promise<ForumBoardDto> => svc.updateBoard(playerOf(req), Number(req.params.id), req.body),
  );

  app.delete<Id>(`${base}/boards/:id`, { ...auth, schema: { params: idParams } }, async (req, reply): Promise<void> => {
    svc.deleteBoard(playerOf(req), Number(req.params.id));
    void reply.code(204);
  });

  app.get<Paged>(
    `${base}/boards/:id/threads`,
    { ...auth, schema: { params: idParams, querystring: pageQuery } },
    async (req): Promise<ForumThreadsResponse> => svc.threads(playerOf(req), Number(req.params.id), page(req.query)),
  );

  app.post<Id & { Body: CreateThreadRequest }>(
    `${base}/boards/:id/threads`,
    { ...auth, schema: { params: idParams, body: threadCreate } },
    async (req, reply): Promise<ForumThreadResponse> => {
      const res = svc.createThread(playerOf(req), Number(req.params.id), req.body.title, req.body.body, req.nowMs);
      void reply.code(201);
      return res;
    },
  );

  app.get<Paged>(
    `${base}/threads/:id`,
    { ...auth, schema: { params: idParams, querystring: pageQuery } },
    async (req): Promise<ForumThreadResponse> => svc.thread(playerOf(req), Number(req.params.id), page(req.query), req.nowMs),
  );

  app.put<Id & { Body: UpdateThreadRequest }>(
    `${base}/threads/:id`,
    { ...auth, schema: { params: idParams, body: threadUpdate } },
    async (req): Promise<ForumThreadSummaryDto> => svc.updateThread(playerOf(req), Number(req.params.id), req.body),
  );

  app.delete<Id>(`${base}/threads/:id`, { ...auth, schema: { params: idParams } }, async (req, reply): Promise<void> => {
    svc.deleteThread(playerOf(req), Number(req.params.id));
    void reply.code(204);
  });

  app.post<Id & { Body: ReplyRequest }>(
    `${base}/threads/:id/posts`,
    { ...auth, schema: { params: idParams, body: bodyOnly } },
    async (req, reply): Promise<ForumPostDto> => {
      const res = svc.reply(playerOf(req), Number(req.params.id), req.body.body, req.nowMs);
      void reply.code(201);
      return res;
    },
  );

  app.put<Id & { Body: EditPostRequest }>(
    `${base}/posts/:id`,
    { ...auth, schema: { params: idParams, body: bodyOnly } },
    async (req): Promise<ForumPostDto> => svc.editPost(playerOf(req), Number(req.params.id), req.body.body, req.nowMs),
  );

  app.delete<Id>(`${base}/posts/:id`, { ...auth, schema: { params: idParams } }, async (req, reply): Promise<void> => {
    svc.deletePost(playerOf(req), Number(req.params.id));
    void reply.code(204);
  });
}
