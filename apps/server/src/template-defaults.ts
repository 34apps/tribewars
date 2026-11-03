// Formal message templates seeded on first start (message_templates). Placeholders: {player} {staff} {ticket} {category}.
// Admins can edit, add and delete them afterwards; the seed never runs twice.

import type { TemplateKind } from '@clanfire/engine';

export interface DefaultTemplate {
  key: string;
  title: string;
  kind: TemplateKind;
  body: string;
}

export const DEFAULT_TEMPLATES: readonly DefaultTemplate[] = [
  {
    key: 'received',
    title: 'Request received',
    kind: 'ticket',
    body:
      'Dear {player},\n\nThank you for contacting Clanfire support. We have received your request ({ticket}, category: {category}) ' +
      'and a member of our team will look into it as soon as possible.\n\nKind regards,\n{staff}\nClanfire Support',
  },
  {
    key: 'need-more-info',
    title: 'More information needed',
    kind: 'ticket',
    body:
      'Dear {player},\n\nThank you for your patience with {ticket}. To help you further we need a little more information. ' +
      'Please reply with what you were doing when the problem appeared, the village or tribe it concerns, and the approximate time (UTC) if you can.\n\n' +
      'Once we hear from you we will continue right away.\n\nKind regards,\n{staff}\nClanfire Support',
  },
  {
    key: 'resolved',
    title: 'Resolved and closing',
    kind: 'ticket',
    body:
      'Dear {player},\n\nWe believe your request ({ticket}) has been resolved, so we are marking it as solved. ' +
      'If something is still not right, simply reply to this ticket and we will reopen it.\n\nThank you for playing Clanfire.\n\nKind regards,\n{staff}\nClanfire Support',
  },
  {
    key: 'bug-acknowledged',
    title: 'Bug acknowledged',
    kind: 'ticket',
    body:
      'Dear {player},\n\nThank you for reporting this problem. We have reproduced it or recorded it for our developers ({ticket}). ' +
      'We cannot promise a date for the fix, but it is on our list and we appreciate the care you took to describe it.\n\nKind regards,\n{staff}\nClanfire Support',
  },
  {
    key: 'account-security',
    title: 'Account security advice',
    kind: 'ticket',
    body:
      'Dear {player},\n\nRegarding {ticket}: to keep your account safe, please choose a password that you use nowhere else, ' +
      'never share it with anyone (our team will never ask for it), and sign out on shared devices. ' +
      'If you suspect someone else used your account, tell us what you noticed and we will review it.\n\nKind regards,\n{staff}\nClanfire Support',
  },
  {
    key: 'warning-abuse',
    title: 'Formal warning (abusive conduct)',
    kind: 'moderation',
    body:
      'Dear {player},\n\nWe have received reports about messages you wrote that breach the Clanfire rules of conduct. ' +
      'Insulting, threatening or harassing other players is not allowed. Please treat this as a formal warning: ' +
      'further breaches may lead to a mute or the suspension of your account.\n\nIf you believe this is a mistake, you may reply to this ticket ({ticket}).\n\n' +
      'Regards,\n{staff}\nClanfire Moderation',
  },
  {
    key: 'mute-notice',
    title: 'Mute notice',
    kind: 'moderation',
    body:
      'Dear {player},\n\nDue to a breach of the Clanfire rules of conduct, your ability to write mail, tribe chat and forum posts has been suspended for a limited time. ' +
      'You can still play, and you can still write to us here ({ticket}). The end of the suspension is shown when you try to write a message.\n\n' +
      'Regards,\n{staff}\nClanfire Moderation',
  },
  {
    key: 'ban-notice',
    title: 'Account suspension notice',
    kind: 'moderation',
    body:
      'Dear {player},\n\nAfter reviewing your conduct we have suspended your Clanfire account because of a serious or repeated breach of the rules. ' +
      'If you would like the decision reviewed, you can reply to this ticket ({ticket}) and a different member of the team will look at it.\n\n' +
      'Regards,\n{staff}\nClanfire Moderation',
  },
];
