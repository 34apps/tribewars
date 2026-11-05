import type { FastifyInstance } from 'fastify';
import {
  NOTIFICATIONS_KEEP,
  NOTIFICATION_MAX_AGE_DAYS,
  NOTIFICATION_READ_MAX_IDS,
  type NotificationDto,
  type NotificationsReadRequest,
  type NotificationsResponse,
} from '@clanfire/engine';
import type { AppContext } from '../context.ts';
import type { NotificationRow } from '../notification-store.ts';
import type { Store } from '../store.ts';
import { playerOf, requireAuth } from './auth.ts';

const readBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ids: { type: 'array', maxItems: NOTIFICATION_READ_MAX_IDS, items: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } },
  },
} as const;

/** What the owner may see: who sends it, when, where to. Never the unit list (the table does not even have one). */
function toDto(n: NotificationRow): NotificationDto {
  return {
    id: n.id,
    kind: n.kind,
    movementId: n.movementId,
    origin: n.origin,
    target: n.target,
    departAt: n.departAt,
    arriveAt: n.arriveAt,
    createdAt: n.createdAt,
    read: n.read,
  };
}

/** The caller's own rows only (the SQL is keyed on their player id), newest first, within the keep count and age. */
function listFor(store: Store, playerId: number, now: number): NotificationsResponse {
  const oldest = now - NOTIFICATION_MAX_AGE_DAYS * 86_400_000;
  const rows = store.notifications.list(playerId, NOTIFICATIONS_KEEP).filter((n) => n.createdAt >= oldest);
  return { notifications: rows.map(toDto), unread: rows.filter((n) => !n.read).length };
}

export function notificationRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { onRequest: requireAuth(ctx) };
  const { store } = ctx;

  app.get('/api/notifications', auth, async (req): Promise<NotificationsResponse> => listFor(store, playerOf(req).id, req.nowMs));

  app.post<{ Body: NotificationsReadRequest }>(
    '/api/notifications/read',
    { ...auth, schema: { body: readBody } },
    async (req): Promise<NotificationsResponse> => {
      const player = playerOf(req);
      store.tx(() => store.notifications.markRead(player.id, req.body.ids ?? null));
      return listFor(store, player.id, req.nowMs);
    },
  );
}
