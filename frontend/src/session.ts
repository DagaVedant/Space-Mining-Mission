import { emptyCargo, newSave, type Cargo, type SaveData } from './progress';
import type { VoyageMode } from './voyage';

export interface Session {
  save: SaveData;
  cargo: Cargo;
  pvpRanked: boolean;
  mode: VoyageMode;
}

export const session: Session = { save: newSave(), cargo: emptyCargo(), pvpRanked: false, mode: 'campaign' };

export function resetSession(save: SaveData, mode: VoyageMode = 'campaign'): void {
  session.save = save;
  session.cargo = emptyCargo();
  session.pvpRanked = false;
  session.mode = mode;
}
