// Staff roles, support vocabularies and formal message templates (pure; no I/O).

export const STAFF_ROLES = ['support', 'moderator', 'admin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** 0 = not staff; support 1 < moderator 2 < admin 3. */
export function staffRank(role: StaffRole | null | undefined): number {
  return role ? STAFF_ROLES.indexOf(role) + 1 : 0;
}

export function isStaffRole(v: unknown): v is StaffRole {
  return typeof v === 'string' && (STAFF_ROLES as readonly string[]).includes(v);
}

/** Categories a player picks; `moderation` is only used for staff-initiated notices. */
export const PLAYER_TICKET_CATEGORIES = ['account', 'bug', 'payment', 'report_player', 'gameplay', 'feedback', 'other'] as const;
export const TICKET_CATEGORIES = [...PLAYER_TICKET_CATEGORIES, 'moderation'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
/** pending = waiting for the player. */
export const TICKET_STATUSES = ['open', 'pending', 'solved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_PRIORITIES = ['normal', 'high'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const MESSAGE_REPORT_KINDS = ['mail', 'forum_post', 'chat', 'player'] as const;
export type MessageReportKind = (typeof MESSAGE_REPORT_KINDS)[number];
export const MESSAGE_REPORT_CATEGORIES = ['spam', 'abuse', 'threats', 'cheating', 'other'] as const;
export type MessageReportCategory = (typeof MESSAGE_REPORT_CATEGORIES)[number];
export const MESSAGE_REPORT_STATUSES = ['open', 'actioned', 'dismissed'] as const;
export type MessageReportStatus = (typeof MESSAGE_REPORT_STATUSES)[number];

export const TEMPLATE_KINDS = ['ticket', 'moderation'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const TEMPLATE_PLACEHOLDERS = ['player', 'staff', 'ticket', 'category'] as const;
export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];
export type TemplateVars = Partial<Record<TemplatePlaceholder, string>>;

const PLACEHOLDER_RE = /\{(player|staff|ticket|category)\}/g;

/**
 * Fill the known placeholders in a template. One pass: substituted text is never scanned again, so a username
 * like "{staff}" cannot inject anything. Placeholders without a value, and unknown {words}, are left as written.
 */
export function renderTemplate(body: string, vars: TemplateVars): string {
  return body.replace(PLACEHOLDER_RE, (whole, name: TemplatePlaceholder) => {
    const v = Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : undefined;
    return v === undefined ? whole : v;
  });
}
