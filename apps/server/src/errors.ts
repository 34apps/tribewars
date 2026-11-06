import type { GameErrorCode } from '@clanfire/engine';

/**
 * HTTP status for a game error code. 400 = the request can never be valid as sent;
 * 409 = valid in form but refused by the current game state (retrying later may succeed).
 */
export function statusFor(code: GameErrorCode): number {
  switch (code) {
    case 'invalid_input':
    case 'invalid_target':
    case 'no_troops':
      return 400;
    case 'unauthorized':
      return 401;
    case 'forbidden':
    case 'password_change_required':
      return 403;
    case 'not_found':
      return 404;
    case 'rate_limited':
      return 429;
    case 'max_level':
    case 'requirements_not_met':
    case 'not_enough_resources':
    case 'exceeds_storage':
    case 'queue_full':
    case 'too_late':
    case 'population_full':
    case 'not_enough_troops':
    case 'target_protected':
    case 'username_taken':
    case 'tribe_name_taken':
    case 'tribe_full':
    case 'already_in_tribe':
    case 'not_in_tribe':
    case 'group_limit':
      return 409;
    case 'advisor_unavailable':
      return 503;
    case 'internal_error':
      return 500;
  }
}
