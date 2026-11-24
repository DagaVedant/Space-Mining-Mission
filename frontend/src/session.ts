import { emptyCargo, newSave, type Cargo, type SaveData } from './progress';

export interface Session {
  save: SaveData;
  cargo: Cargo;
}

export const session: Session = { save: newSave(), cargo: emptyCargo() };

export function resetSession(save: SaveData): void {
  session.save = save;
  session.cargo = emptyCargo();
}
