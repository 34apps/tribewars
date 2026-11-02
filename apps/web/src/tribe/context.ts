import { createContext, useContext } from 'react';
import type { MyTribeResponse, TribeDto, TribeRole } from '@tribewars/engine';
import type { TribeTarget } from '../game.ts';
import type { ConfirmOptions } from './Confirm.tsx';
import type { RunAction } from './useMyTribe.ts';

export interface TribeApi {
  data: MyTribeResponse;
  busy: boolean;
  run: RunAction;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Open a tribe's public page. */
  openTribe: (target: TribeTarget) => void;
}

export const TribeContext = createContext<TribeApi | null>(null);

export function useTribe(): TribeApi {
  const ctx = useContext(TribeContext);
  if (!ctx) throw new Error('useTribe must be used inside <TribeView>');
  return ctx;
}

/** Props of every section of the member view. */
export interface MemberProps {
  tribe: TribeDto;
  role: TribeRole;
}
