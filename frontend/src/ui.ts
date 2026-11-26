import {
  DISCOVERY_SITES,
  ORES,
  ORE_IDS,
  PILOTS,
  SECTORS,
  SHIP_SKINS,
  UPGRADES,
  WEAPONS,
  type OreId,
  type PilotId,
  type ShipSkinId,
  type UpgradeId,
  type WeaponId,
} from './data';
import { sfx } from './audio';
import { oreIcon } from './oreart';
import type { MarketState } from './market';
import type { Account } from './cloud';
import { loadSettings, saveSettings, type ControlAction } from './settings';
import {
  canBuyUpgrade,
  cargoTotal,
  ensureDailyQuests,
  refuelCost,
  repairCost,
  upgradeCost,
  type Cargo,
  type Contract,
  type DailyQuest,
  type SaveData,
  type ShipStats,
  utcDate,
  expeditionsUnlocked,
} from './progress';
import {
  COMPANY_UPGRADES,
  MILESTONES,
  companyCost,
  type CompanyState,
  type CompanyUpgradeId,
  type RunReport,
} from './company';
import { PERKS, claimsFor, type PerkDef, type PerkId, type RunEnd } from './run';
import type { VoyageInfo } from './voyage';

const root = (): HTMLElement => document.getElementById('ui') as HTMLElement;
const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

export const money = (n: number): string => '$' + Math.round(n).toLocaleString('en-US');

export interface HudState {
  hull: number;
  hullMax: number;
  shield: number;
  shieldMax: number;
  fuel: number;
  fuelMax: number;
  cargo: Cargo;
  cargoMax: number;
  money: number;
  bossName: string | null;
  hasGate: boolean;
  earned: number;
  goal: number;
  contracts: Contract[];
  clock: number;
  market: MarketState;
  boss: { hp: number; max: number; name: string } | null;
  mission: { description: string; progress: number; target: number; complete: boolean };
  discoveries: number;
  discoveryTotal: number;
  pulse: { key: string; wait: number };
}

export interface ShopApi {
  save: SaveData;
  info(): VoyageInfo;
  market: MarketState;
  cargo(): Cargo;
  hull(): number;
  fuel(): number;
  stats(): ShipStats;
  clock(): number;
  offers(): Contract[];
  active(): Contract[];
  gateReady(): boolean;
  sell(ore: OreId | 'all'): void;
  repair(): void;
  refuel(): void;
  service(): void;
  buy(id: UpgradeId): void;
  accept(id: number): void;
  deliver(): void;
  refresh(): void;
  launch(): void;
}

const cache = new Map<string, string>();
function setText(id: string, v: string, target?: HTMLElement): void {
  if (cache.get(id) === v) return;
  cache.set(id, v);
  (target ?? el(id)).textContent = v;
}
function setWidth(id: string, pct: number): void {
  const v = Math.max(0, Math.min(100, pct)).toFixed(1) + '%';
  const key = id + ':w';
  if (cache.get(key) === v) return;
  cache.set(key, v);
  el(id).style.width = v;
}

let hudBuilt = false;
let shopApi: ShopApi | null = null;
let shopTimer = 0;
let pressed = false;
let toastCount = 0;
let mapKey = 'N';
let shopHtml = '';
let shopTab = '';

// 7x6 / 7x7 pixel icons, drawn as crisp SVG rects like inventory sprites
const HEART = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
const BOLT = ['....XX.', '...XX..', '..XX...', '.XXXXX.', '...XX..', '..XX...', '.XX....'];
const iconCache = new Map<string, string>();
function pixelIcon(rows: string[], on: string, frac: number): string {
  const key = `${on}:${frac}`;
  let svg = iconCache.get(key);
  if (!svg) iconCache.set(key, (svg = drawIcon(rows, on, frac)));
  return svg;
}
function drawIcon(rows: string[], on: string, frac: number): string {
  const h = rows.length;
  const w = rows[0].length;
  let out = '';
  const at = (x: number, y: number): boolean => y >= 0 && y < h && x >= 0 && x < w && rows[y][x] === 'X';
  for (let y = -1; y <= h; y++) {
    for (let x = -1; x <= w; x++) {
      if (at(x, y)) {
        const lit = x + 0.5 <= frac * w;
        out += `<rect x="${x + 1}" y="${y + 1}" width="1" height="1" fill="${lit ? on : '#3a3a3a'}"/>`;
      } else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) {
        out += `<rect x="${x + 1}" y="${y + 1}" width="1" height="1" fill="#000"/>`;
      }
    }
  }
  return `<svg viewBox="0 0 ${w + 2} ${h + 2}" shape-rendering="crispEdges">${out}</svg>`;
}
function iconRow(rows: string[], on: string, value: number, max: number): string {
  const n = 10;
  const per = max / n;
  let html = '';
  for (let i = 0; i < n; i++) {
    const f = Math.max(0, Math.min(1, (value - i * per) / per));
    html += pixelIcon(rows, on, f > 0.75 ? 1 : f > 0.25 ? 0.5 : 0);
  }
  return html;
}

function buildHud(): void {
  if (hudBuilt) return;
  hudBuilt = true;
  const h = document.createElement('div');
  h.id = 'hud';
  h.className = 'hidden';
  const slots = ORE_IDS.map(
    (o) => `<div class="slot" id="slot-${o}" title="${ORES[o].name}">${oreIcon(o, 'ic')}<b class="n"></b></div>`,
  ).join('');
  h.innerHTML = `
    <div id="hurt"></div>
    <div id="flare"></div>
    <div id="left">
      <div id="bar" class="plate">
        <div class="cash"><span id="money"></span></div>
        <div id="goal-text" class="dimt"></div>
        <div id="next-text" role="status" aria-live="polite"></div>
      </div>
      <div id="toasts" aria-live="polite"></div>
    </div>
    <div id="right">
      <div id="contracts" class="plate hidden" aria-label="Active contracts"></div>
      <div id="mapwin" data-size="small">
        <div class="maptools">
          <button id="map-size" type="button" aria-label="Change map size">MAP <span id="map-key" class="keyhint"></span></button>
          <button id="discovery-log" type="button" aria-label="Open discovery log">LOG <span id="discovery-count">0/0</span></button>
        </div>
        <canvas id="minimap" width="180" height="180"></canvas>
      </div>
    </div>
    <div id="bossbar" class="hidden"><span id="boss-name"></span><div class="track"><i id="b-boss"></i></div></div>
    <div id="banner" class="hidden"></div>
    <div id="hint" class="hidden"></div>
    <div class="keys" id="keys">WASD move | Shift turbo | Space or click fire (aim with mouse) | E dock / gate | Esc pause | M mute</div>
    <div id="dock">
      <div class="vitals"><div id="hearts" class="icons"></div><div id="bolts" class="icons"></div></div>
      <div id="shield-bar" class="xp shield hidden"><i id="b-shield"></i></div>
      <div class="xp" title="Sector quota"><i id="b-goal"></i></div>
      <div class="hold"><span id="v-pulse"></span><div id="hotbar">${slots}</div><span id="v-cargo"></span></div>
    </div>`;
  root().appendChild(h);
  el('map-size').addEventListener('click', (event) => {
    (event.currentTarget as HTMLElement).blur(); // so Space keeps firing instead of re-pressing it
    hud.cycleMap();
  });
  setMapSize(readMapSize());
}

const MAP_SIZES = ['small', 'large', 'hidden'] as const;
type MapSize = (typeof MAP_SIZES)[number];
const MAP_KEY = 'asteroid-breaker-map-size';

function readMapSize(): MapSize {
  try {
    const stored = localStorage.getItem(MAP_KEY);
    return MAP_SIZES.find((size) => size === stored) ?? 'small';
  } catch {
    return 'small';
  }
}

function setMapSize(size: MapSize): void {
  el('mapwin').dataset.size = size;
  try {
    localStorage.setItem(MAP_KEY, size);
  } catch {
    // the size just resets next visit
  }
}

/** The one thing to do next. */
function nextStep(s: HudState): string {
  const { mission } = s;
  if (!mission.complete) return `Next: ${mission.description} (${mission.progress}/${mission.target})`;
  if (s.earned < s.goal) return `Next: earn ${money(s.goal - s.earned)} more`;
  if (s.bossName) return `Next: destroy the ${s.bossName}`;
  return s.hasGate ? 'Next: fly to the warp gate' : 'Free play: keep mining';
}

export const hud = {
  show(): void {
    buildHud();
    cache.clear();
    el('hud').classList.remove('hidden');
    el('toasts').innerHTML = '';
    el('banner').classList.add('hidden');
    const settings = loadSettings();
    const keyLabel = (key: string): string => KEY_LABELS[key] ?? key;
    mapKey = settings.bindings.map;
    setText(
      'keys',
      `${keyLabel(settings.bindings.up)} ${keyLabel(settings.bindings.left)} ${keyLabel(settings.bindings.down)} ${keyLabel(settings.bindings.right)} move | ${keyLabel(settings.bindings.boost)} boost | ${keyLabel(settings.bindings.fire)} fire | ${keyLabel(settings.bindings.interact)} dock | ${keyLabel(settings.bindings.pause)} pause`,
    );
    window.setTimeout(() => el('keys')?.classList.add('fade'), 25000);
  },
  hide(): void {
    if (!hudBuilt) return;
    el('hud').classList.add('hidden');
  },
  cycleMap(): void {
    if (!hudBuilt) return;
    const now = MAP_SIZES.indexOf(el('mapwin').dataset.size as MapSize);
    setMapSize(MAP_SIZES[(now + 1) % MAP_SIZES.length]);
  },
  minimap(): CanvasRenderingContext2D {
    return (el('minimap') as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D;
  },
  update(s: HudState): void {
    const used = cargoTotal(s.cargo);
    const hearts = iconRow(HEART, '#d83a3a', s.hull, s.hullMax);
    const bolts = iconRow(BOLT, '#e0a82e', s.fuel, s.fuelMax);
    if (cache.get('hearts') !== hearts) {
      cache.set('hearts', hearts);
      el('hearts').innerHTML = hearts;
    }
    if (cache.get('bolts') !== bolts) {
      cache.set('bolts', bolts);
      el('bolts').innerHTML = bolts;
    }
    for (const o of ORE_IDS) {
      const slot = el(`slot-${o}`);
      slot.classList.toggle('has', s.cargo[o] > 0);
      setText(`slot-${o}:n`, s.cargo[o] > 0 ? String(s.cargo[o]) : '', slot.querySelector('.n') as HTMLElement);
    }
    setText('money', money(s.money));
    setText('map-key', KEY_LABELS[mapKey] ?? mapKey);
    setWidth('b-goal', (s.earned / s.goal) * 100);
    el('shield-bar').classList.toggle('hidden', s.shieldMax <= 0);
    if (s.shieldMax > 0) setWidth('b-shield', (s.shield / s.shieldMax) * 100);
    setText('goal-text', s.earned >= s.goal ? 'Quota met' : `Quota ${money(s.earned)} / ${money(s.goal)}`);
    setText('next-text', nextStep(s));
    setText('discovery-count', `${s.discoveries}/${s.discoveryTotal}`);
    setText('v-cargo', `${used}/${s.cargoMax}`);
    el('v-cargo').classList.toggle('full', used >= s.cargoMax);
    const ready = s.pulse.wait <= 0;
    setText('v-pulse', ready ? `${KEY_LABELS[s.pulse.key] ?? s.pulse.key} Pulse` : `Pulse ${Math.ceil(s.pulse.wait)}s`);
    el('v-pulse').classList.toggle('cooling', !ready);
    const csh = s.contracts
      .map((c) => {
        const left = Math.max(0, Math.round(c.deadline - s.clock));
        const m = Math.floor(left / 60);
        const sc = String(left % 60).padStart(2, '0');
        return `<div class="ct"><b style="color:${ORES[c.ore].css}">${c.qty} ${ORES[c.ore].name}</b><span>${money(c.reward)}</span><em>${m}:${sc}</em></div>`;
      })
      .join('');
    if (cache.get('ct') !== csh) {
      cache.set('ct', csh);
      el('contracts').innerHTML = csh;
      el('contracts').classList.toggle('hidden', !csh);
    }
    const bb = el('bossbar');
    if (s.boss) {
      bb.classList.remove('hidden');
      setText('boss-name', s.boss.name.toUpperCase());
      setWidth('b-boss', (s.boss.hp / s.boss.max) * 100);
    } else bb.classList.add('hidden');
  },
  toast(msg: string, kind: 'info' | 'good' | 'bad' | 'market' = 'info'): void {
    if (!hudBuilt) return;
    const box = el('toasts');
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = msg;
    t.dataset.n = String(++toastCount);
    box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild as Node);
    window.setTimeout(() => t.classList.add('out'), 4200);
    window.setTimeout(() => t.remove(), 4800);
  },
  banner(msg: string | null, kind: 'warn' | 'danger' | 'good' = 'warn'): void {
    if (!hudBuilt) return;
    const b = el('banner');
    if (!msg) {
      b.classList.add('hidden');
      return;
    }
    b.className = kind;
    b.textContent = msg;
  },
  hint(msg: string | null): void {
    if (!hudBuilt) return;
    const h = el('hint');
    if (!msg) {
      h.classList.add('hidden');
      return;
    }
    h.classList.remove('hidden');
    setText('hint', msg);
  },
  flare(level: number): void {
    if (!hudBuilt) return;
    el('flare').style.opacity = String(Math.max(0, Math.min(1, level)));
  },
  hurt(): void {
    if (!hudBuilt) return;
    const h = el('hurt');
    h.style.transition = 'none';
    h.style.opacity = '0.5';
    void h.offsetWidth;
    h.style.transition = 'opacity 0.45s ease-out';
    h.style.opacity = '0';
  },
};

export interface OverlayButton {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

let overlayEl: HTMLElement | null = null;

export function closeOverlay(): void {
  overlayEl?.remove();
  overlayEl = null;
}

export function showOverlay(title: string, body: string, buttons: OverlayButton[], extra = ''): void {
  closeOverlay();
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `<div class="win card" role="dialog" aria-modal="true" aria-label="${title}"><div class="wt">${title}</div><div class="wb"><p>${body}</p>${extra}<div class="btns"></div></div></div>`;
  const box = o.querySelector('.btns') as HTMLElement;
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.textContent = b.label;
    if (b.primary) btn.className = 'primary';
    btn.addEventListener('click', b.onClick);
    box.appendChild(btn);
  }
  root().appendChild(o);
  overlayEl = o;
  (box.querySelector('button.primary') as HTMLElement | null)?.focus();
}

export function showPerkPick(opts: {
  depth: number;
  offer: PerkDef[];
  rerolls: number;
  onPick: (id: PerkId) => void;
  onReroll: () => void;
  onMenu: () => void;
}): void {
  const choices = opts.offer
    .map((perk) => `<button type="button" data-perk="${perk.id}"><b>${perk.name}</b><span>${perk.desc}</span></button>`)
    .join('');
  const buttons: Parameters<typeof showOverlay>[2] = [];
  if (opts.rerolls > 0) buttons.push({ label: `Reroll (${opts.rerolls} left)`, onClick: opts.onReroll });
  buttons.push({ label: 'Save and quit', onClick: opts.onMenu });
  showOverlay(`DEPTH ${opts.depth} CLEARED`, 'Pick one upgrade. It lasts for the rest of this expedition.', buttons, `<div class="perks">${choices}</div>`);
  const nodes = document.querySelectorAll<HTMLButtonElement>('.overlay [data-perk]');
  nodes.forEach((node) => node.addEventListener('click', () => opts.onPick(node.dataset.perk as PerkId)));
  nodes[0]?.focus();
}

export function showGate(opts: {
  depth: number;
  earned: number;
  claims: number;
  lostClaims: number;
  hull: number;
  hullMax: number;
  onPush: () => void;
  onExtract: () => void;
  onMenu: () => void;
}): void {
  showOverlay(
    'PUSH ON OR EXTRACT',
    `Extract to bank <b>${opts.claims} Claims</b> and end the expedition.<br>
     Push on to depth ${opts.depth + 1} for more. If the ship is lost you bank only ${opts.lostClaims} of what you have now.`,
    [
      { label: `Push on to depth ${opts.depth + 1}`, primary: true, onClick: opts.onPush },
      { label: `Extract (+${opts.claims} Claims)`, onClick: opts.onExtract },
      { label: 'Save and quit', onClick: opts.onMenu },
    ],
    `<dl class="tally"><dt>Earned this expedition</dt><dd>${money(opts.earned)}</dd><dt>Hull</dt><dd>${opts.hull} / ${opts.hullMax}</dd></dl>`,
  );
}

export function showRunEnd(opts: { how: RunEnd; depth: number; report: RunReport; onAgain: () => void; onMenu: () => void }): void {
  const extra = opts.report.milestones.map((m) => `<dt>${m.name}</dt><dd>+${m.reward}</dd>`).join('');
  const depths = `${opts.depth} depth${opts.depth === 1 ? '' : 's'}`;
  showOverlay(
    opts.how === 'extract' ? 'EXTRACTED' : 'SHIP LOST',
    opts.how === 'extract'
      ? `You brought it home after clearing ${depths}.`
      : `The expedition ends after ${depths}. Your campaign is untouched.`,
    [
      { label: 'New expedition', primary: true, onClick: opts.onAgain },
      { label: 'Main menu', onClick: opts.onMenu },
    ],
    `<dl class="tally"><dt>Claims banked</dt><dd>+${opts.report.claims}</dd>${extra}</dl>`,
  );
}

export function showDiscoveryLog(save: SaveData, onClose: () => void): void {
  const rows = DISCOVERY_SITES.map((site) => {
    const found = save.discoveries.includes(site.id);
    const contents = found
      ? `<b>${site.name}</b> · ${site.description}`
      : 'Unidentified signal · Not recovered';
    return `<li class="${found ? 'found' : 'unknown'}"><span>Sector ${site.sector + 1}</span> ${contents}</li>`;
  }).join('');
  showOverlay(
    'DISCOVERY LOG',
    `${save.discoveries.length} / ${DISCOVERY_SITES.length} sites recovered. Sites are optional and do not block sector gates.<br>
     Map: white ship, orange station and gate, purple gravity well, blue planet, red pirate, gold salvage site.`,
    [{ label: 'Back to flight', primary: true, onClick: onClose }],
    `<ul class="discovery-log">${rows}</ul>`,
  );
}

export function applyGameSettings(settings = loadSettings()): void {
  const ui = root();
  ui.style.setProperty('--hud-scale', String(settings.hudScale));
  document.body.classList.toggle('reduced-motion', settings.reducedMotion);
  sfx.setVolume(settings.volume);
}

const CONTROL_LABELS: Record<ControlAction, string> = {
  up: 'Thrust up',
  down: 'Thrust down',
  left: 'Thrust left',
  right: 'Thrust right',
  fire: 'Fire',
  boost: 'Turbo',
  interact: 'Dock / interact',
  pause: 'Pause',
  mute: 'Mute audio',
  map: 'Map size',
  pulse: 'Pulse',
};
const REBINDABLE_KEYS = ['W', 'A', 'S', 'D', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'SPACE', 'SHIFT', 'E', 'ESC', 'M', 'N', 'Q', 'F'];
const KEY_LABELS: Record<string, string> = {
  UP: 'Arrow Up',
  DOWN: 'Arrow Down',
  LEFT: 'Arrow Left',
  RIGHT: 'Arrow Right',
  SPACE: 'Space',
  SHIFT: 'Shift',
  ESC: 'Escape',
};

export function showSettings(onClose: () => void = closeOverlay): void {
  closeOverlay();
  const settings = loadSettings();
  const keyOptions = (selected: string): string => REBINDABLE_KEYS.map((key) =>
    `<option value="${key}" ${key === selected ? 'selected' : ''}>${KEY_LABELS[key] ?? key}</option>`,
  ).join('');
  const bindings = (Object.keys(CONTROL_LABELS) as ControlAction[])
    .map((action) => `<label>${CONTROL_LABELS[action]}<select data-binding="${action}">${keyOptions(settings.bindings[action])}</select></label>`)
    .join('');
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <section class="win settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div class="wt" id="settings-title">SETTINGS</div>
      <div class="wb settings-body">
        <label>Aim sensitivity <output data-value="aimSensitivity"></output>
          <input type="range" min="0.25" max="2" step="0.05" data-setting="aimSensitivity">
        </label>
        <label>Audio volume <output data-value="volume"></output>
          <input type="range" min="0" max="1" step="0.05" data-setting="volume">
        </label>
        <label>HUD scale <output data-value="hudScale"></output>
          <input type="range" min="0.75" max="1.5" step="0.05" data-setting="hudScale">
        </label>
        <label class="check"><input type="checkbox" data-setting="screenShake"> Screen shake</label>
        <label class="check"><input type="checkbox" data-setting="reducedMotion"> Reduce flashes and motion</label>
        <label class="check"><input type="checkbox" data-setting="showTutorial"> Show launch tutorial</label>
        <h3>CONTROLS</h3>
        <div class="bindings">${bindings}</div>
        <div class="btns"><button class="primary" data-close>Done</button></div>
        <p class="settings-status" role="status" aria-live="polite"></p>
      </div>
    </section>`;
  root().appendChild(overlay);
  overlayEl = overlay;
  const status = overlay.querySelector<HTMLElement>('.settings-status')!;
  const persistSettings = (): void => {
    try {
      saveSettings(settings);
      applyGameSettings(settings);
      window.dispatchEvent(new CustomEvent('asteroid-breaker-settings-changed'));
      status.textContent = 'Settings saved.';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Settings could not be saved.';
    }
  };
  for (const input of Array.from(overlay.querySelectorAll<HTMLInputElement>('[data-setting]'))) {
    const key = input.dataset.setting as 'aimSensitivity' | 'volume' | 'hudScale' | 'screenShake' | 'reducedMotion' | 'showTutorial';
    const isToggle = key === 'screenShake' || key === 'reducedMotion' || key === 'showTutorial';
    input.type = isToggle ? 'checkbox' : 'range';
    if (isToggle) input.checked = settings[key];
    else {
      input.value = String(settings[key]);
      const output = overlay.querySelector<HTMLOutputElement>(`[data-value="${key}"]`)!;
      const updateOutput = (): void => {
        output.value = key === 'volume' ? `${Math.round(Number(input.value) * 100)}%` : `${Number(input.value).toFixed(2)}×`;
      };
      updateOutput();
      input.addEventListener('input', () => {
        settings[key] = Number(input.value);
        updateOutput();
        persistSettings();
      });
    }
    if (isToggle) input.addEventListener('change', () => {
      settings[key] = input.checked;
      persistSettings();
    });
  }
  for (const select of Array.from(overlay.querySelectorAll<HTMLSelectElement>('[data-binding]'))) {
    select.addEventListener('change', () => {
      settings.bindings[select.dataset.binding as ControlAction] = select.value;
      persistSettings();
    });
  }
  overlay.querySelector('[data-close]')?.addEventListener('click', onClose);
  overlay.querySelector<HTMLSelectElement>('[data-binding]')?.focus();
}

export interface MenuActions {
  playAi: () => void;
  expedition: () => void;
  newGame: () => void;
  pvp: (ranked: boolean) => void;
  authenticate: (username: string, password: string, register: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  selectPilot: (pilot: PilotId) => void;
  selectSkin: (skin: ShipSkinId) => void;
  selectWeapon: (weapon: WeaponId) => void;
  claimDaily: (id: string) => void;
  buyCompany: (id: CompanyUpgradeId) => void;
}

type MenuView = 'home' | 'expedition' | 'company' | 'loadout' | 'contracts' | 'account' | 'how';

// kept outside showMenu so a redraw (picking a pilot, claiming a contract) stays on the same page
let menuView: MenuView = 'home';
// so buying again does not mean finding the same button again
let lastBuy = '';

const whole = (n: number): string => Math.floor(n).toLocaleString('en-US');
const tally = (rows: [string, string][]): string =>
  `<dl class="tally">${rows.map(([name, value]) => `<dt>${name}</dt><dd>${value}</dd>`).join('')}</dl>`;

function expeditionPage(save: SaveData): string {
  const { run, company } = save;
  const perks = run ? PERKS.filter((perk) => run.perks.includes(perk.id)) : [];
  const state = run
    ? tally([
        ['Depth', String(run.depth + 1)],
        ['Credits', money(run.money)],
        ['Claims if you extract now', whole(claimsFor(run, 'extract'))],
      ]) +
      (perks.length
        ? `<div class="sub-h">Perks held</div><ul class="how">${perks.map((perk) => `<li><b>${perk.name}</b> - ${perk.desc}</li>`).join('')}</ul>`
        : '')
    : tally([
        ['Deepest depth cleared', String(company.stats.bestDepth)],
        ['Claims', whole(company.claims)],
      ]);
  return `<p class="menu-note">Each depth is deeper and richer. Clear it, pick a perk, then push on or extract. Lose the ship and you bank only 40%. Your campaign is not touched.</p>
    ${state}
    <button type="button" class="primary wide" data-expedition>${run ? 'Resume expedition' : 'Start expedition'}</button>`;
}

function companyPage(company: CompanyState, away: number): string {
  const upgrades = COMPANY_UPGRADES.map((upgrade) => {
    const level = company.upgrades[upgrade.id];
    const cost = companyCost(upgrade.id, level);
    return `<div class="daily-quest"><span>${upgrade.name} <small>level ${level}</small></span><small>${upgrade.desc}</small>
      <button type="button" data-buy="${upgrade.id}" aria-label="Buy ${upgrade.name} for ${cost} Claims" ${company.claims >= cost ? '' : 'disabled'}>${whole(cost)}</button></div>`;
  }).join('');
  const { stats } = company;
  const records = tally([
    ['Expeditions flown', whole(stats.runs)],
    ['Brought home', whole(stats.extracts)],
    ['Deepest depth cleared', whole(stats.bestDepth)],
    ['Longest streak', whole(stats.bestStreak)],
  ]);
  const milestones = tally(
    MILESTONES.map((m) => {
      const done = company.milestones.includes(m.id);
      const at = `${whole(Math.min(stats[m.stat], m.target))}/${m.target}`;
      return [done ? m.name : `${m.name} <small>${at}</small>`, done ? 'Done' : `+${m.reward}`];
    }),
  );
  return `${away > 0 ? `<p class="menu-note" role="status">While you were gone, your outposts earned <b>${whole(away)} Claims</b>.</p>` : ''}
    <p class="claims">${whole(company.claims)} Claims</p>
    <div class="daily-panel">${upgrades}</div>
    <div class="sub-h">Milestones, paid when a run ends</div>${milestones}
    <div class="sub-h">Records</div>${records}`;
}

function menuPage(view: MenuView, title: string, body: string): string {
  return `<section data-view="${view}" hidden>
    <header class="menu-head"><button type="button" data-open="home">Back</button><h2>${title}</h2></header>
    ${body}
  </section>`;
}

export function showMenu(save: SaveData | null, account: Account | null, actions: MenuActions, notice = '', away = 0): void {
  const scrolled = document.querySelector('.menu-body')?.scrollTop ?? 0;
  closeOverlay();
  const expeditions = save !== null && expeditionsUnlocked(save);
  if (!expeditions && (menuView === 'expedition' || menuView === 'company')) menuView = 'home';
  const o = document.createElement('div');
  o.className = 'menu';
  const upgrades = save ? Object.values(save.levels).reduce((a, b) => a + b, 0) : 0;
  const info = save
    ? `<p class="save">Sector ${save.sector + 1}, ${SECTORS[save.sector].name}<br>${money(save.money)} · ${upgrades} upgrades</p>`
    : '';
  const accountPanel = account
    ? `<div class="account-panel"><div><b>Signed in:</b> ${account.username}</div><button data-account="logout">Sign out</button><div id="pvp-stats" class="pvp-stats" role="status">Loading PvP record...</div><div class="account-status" role="status"></div></div>`
    : `<form class="account-panel" id="account-form">
        <label>Username <input name="username" minlength="3" maxlength="24" autocomplete="username" required></label>
        <label>Password <input name="password" type="password" minlength="10" maxlength="128" autocomplete="current-password" required></label>
        <div class="account-actions"><button type="submit" data-auth="login">Sign in</button><button type="submit" data-auth="register">Create account</button></div>
        <div class="account-status" role="status"></div>
      </form>`;
  const currentSave = save ?? null;
  const quests = currentSave ? ensureDailyQuests(currentSave, utcDate()) : [];
  const dailyPanel = currentSave
    ? `<div class="daily-panel">${quests.map((quest) => dailyQuestRow(quest, currentSave)).join('')}</div>`
    : '<p class="menu-note">Start a campaign to take on daily objectives.</p>';
  const pilotOptions = save
    ? PILOTS.filter((pilot) => save.unlockedPilots.includes(pilot.id))
        .map((pilot) => `<option value="${pilot.id}" ${save.selectedPilot === pilot.id ? 'selected' : ''}>${pilot.name} — ${pilot.description}</option>`)
        .join('')
    : `<option value="prospector">Mara Venn — Balanced mining specialist.</option>`;
  const skinOptions = save
    ? SHIP_SKINS.filter((skin) => save.unlockedSkins.includes(skin.id))
        .map((skin) => `<option value="${skin.id}" ${save.selectedSkin === skin.id ? 'selected' : ''}>${skin.name}</option>`)
        .join('')
    : '<option value="industrial">Industrial</option>';
  const weaponOptions = WEAPONS.map((weapon) =>
    `<option value="${weapon.id}" ${save?.selectedWeapon === weapon.id ? 'selected' : ''}>${weapon.name} — ${weapon.description}</option>`,
  ).join('');
  const loadout = `${save ? '' : '<p class="menu-note">Start a campaign to change your loadout.</p>'}
    <div class="loadout">
      <label>Pilot <select id="pilot-select">${pilotOptions}</select></label>
      <label>Ship skin <select id="skin-select">${skinOptions}</select></label>
      <label>Weapon <select id="weapon-select">${weaponOptions}</select></label>
    </div>`;
  const how = `<ul class="how">
    <li>Move, aim and fire with keyboard/mouse or on-screen touch controls</li>
    <li>Campaign sectors require both the quota and the displayed mission objective to open the next gate</li>
    <li><b>E</b> dock at the station to sell, repair and upgrade</li>
    <li><b>Q</b> pulse clears enemy shots and shoves rocks, then recharges</li>
    <li><b>N</b> cycles the map: small, large, hidden</li>
    <li>Break rocks in quick succession to build a streak that drops extra ore</li>
    <li>Expeditions open after sector 2. Claims from them buy permanent Company upgrades</li>
    <li>Daily contracts reward credits and help unlock pilots and ship skins</li>
    <li>Play against AI offline, or sign in to join live PvP battles</li>
  </ul>`;
  o.innerHTML = `
    <div class="win menu-body">
      <div class="wb">
        <section data-view="home">
          <h1>ASTEROID BREAKER</h1>
          ${save ? '' : '<p class="sub">Mine the belt. Build your ship. Take the fight online.</p>'}
          <div class="menu-play"></div>
          ${info}
          ${save && !expeditions ? '<p class="save">Expeditions open after sector 2.</p>' : ''}
          ${away > 0 ? `<p class="save" role="status">Outposts earned ${whole(away)} Claims.</p>` : ''}
          <div class="menu-online"></div>
          <p class="menu-status" role="status"></p>
          <nav class="menu-nav" aria-label="Menu"></nav>
        </section>
        ${save && expeditions ? menuPage('expedition', 'Expedition', expeditionPage(save)) : ''}
        ${save && expeditions ? menuPage('company', 'Company', companyPage(save.company, away)) : ''}
        ${menuPage('loadout', 'Loadout', loadout)}
        ${menuPage('contracts', 'Daily contracts', dailyPanel)}
        ${menuPage('account', 'Account', accountPanel)}
        ${menuPage('how', 'How to play', how)}
      </div>
    </div>`;

  const showView = (view: MenuView): void => {
    menuView = view;
    o.querySelectorAll<HTMLElement>('section[data-view]').forEach((section) => {
      section.hidden = section.dataset.view !== view;
    });
  };
  const focusView = (from: MenuView = 'home'): void => {
    const find = (selector: string): HTMLElement | null => o.querySelector<HTMLElement>(selector);
    const page = `section[data-view="${menuView}"]`;
    const target =
      menuView === 'home'
        ? find(`.menu-nav [data-open="${from}"]`) ?? find('.menu-play button')
        : find(`${page} [data-buy="${lastBuy}"]:not(:disabled)`) ??
          find(`${page} input`) ??
          find(`${page} button.primary`) ??
          find(`${page} button`);
    target?.focus();
  };
  const open = (view: MenuView): void => {
    const from = menuView;
    lastBuy = '';
    showView(view);
    const body = o.querySelector('.menu-body');
    if (body) body.scrollTop = 0;
    focusView(from);
  };

  const button = (parent: string, label: string, onClick: () => void): HTMLButtonElement => {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.addEventListener('click', onClick);
    o.querySelector(parent)?.appendChild(element);
    return element;
  };
  const link = (label: string, view: MenuView): void => {
    button('.menu-nav', label, () => open(view)).dataset.open = view;
  };

  button('.menu-play', save ? 'Continue campaign' : 'Play against AI', actions.playAi).className = 'primary';
  if (save && expeditions) {
    button('.menu-play', save.run ? `Resume expedition (depth ${save.run.depth + 1})` : 'Expedition', () => open('expedition')).dataset.open =
      'expedition';
  }

  if (account) {
    const pvpMode = document.createElement('select');
    pvpMode.className = 'pvp-mode';
    pvpMode.setAttribute('aria-label', 'PvP matchmaking mode');
    pvpMode.innerHTML = '<option value="casual">Casual</option><option value="ranked">Ranked season</option>';
    const pvp = button('.menu-online', 'Casual PvP', () => actions.pvp(pvpMode.value === 'ranked'));
    pvpMode.addEventListener('change', () => {
      pvp.textContent = pvpMode.value === 'ranked' ? 'Ranked PvP' : 'Casual PvP';
    });
    o.querySelector('.menu-online')?.appendChild(pvpMode);
  } else {
    button('.menu-online', 'Sign in to play online', () => open('account'));
  }

  const ready = o.querySelectorAll('[data-claim]:not(:disabled)').length;
  if (expeditions) link('Company', 'company');
  link('Loadout', 'loadout');
  link(ready ? `Contracts (${ready} ready)` : 'Contracts', 'contracts');
  link('Account', 'account');
  button('.menu-nav', 'Settings', () => showSettings(() => showMenu(save, account, actions, notice, away)));
  link('How to play', 'how');
  if (save) {
    button('.menu-nav', 'New campaign', () => {
      if (window.confirm('Start over? Your current campaign save will be replaced.')) actions.newGame();
    });
  }

  o.querySelectorAll<HTMLButtonElement>('.menu-head [data-open]').forEach((back) => {
    back.addEventListener('click', () => open('home'));
  });
  o.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuView !== 'home') open('home');
  });

  const pilot = o.querySelector('#pilot-select') as HTMLSelectElement;
  pilot.disabled = !save;
  pilot.addEventListener('change', () => actions.selectPilot(pilot.value as PilotId));
  const skin = o.querySelector('#skin-select') as HTMLSelectElement;
  skin.disabled = !save;
  skin.addEventListener('change', () => actions.selectSkin(skin.value as ShipSkinId));
  const weapon = o.querySelector('#weapon-select') as HTMLSelectElement;
  weapon.disabled = !save;
  weapon.addEventListener('change', () => actions.selectWeapon(weapon.value as WeaponId));
  o.querySelectorAll<HTMLButtonElement>('[data-claim]').forEach((button) => {
    button.addEventListener('click', () => actions.claimDaily(button.dataset.claim ?? ''));
  });
  o.querySelector('[data-expedition]')?.addEventListener('click', actions.expedition);
  o.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((node) => {
    node.addEventListener('click', () => {
      lastBuy = node.dataset.buy ?? '';
      actions.buyCompany(lastBuy as CompanyUpgradeId);
    });
  });
  o.querySelector('[data-account="logout"]')?.addEventListener('click', () => {
    void actions.signOut().catch((error: unknown) => setAccountStatus(o, error));
  });
  const form = o.querySelector<HTMLFormElement>('#account-form');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
    const data = new FormData(form);
    const username = String(data.get('username') ?? '').trim();
    const password = String(data.get('password') ?? '');
    // a successful sign-in redraws the menu, which should land on the home page
    menuView = 'home';
    void actions.authenticate(username, password, submitter?.dataset.auth === 'register').catch((error: unknown) => {
      menuView = 'account';
      setAccountStatus(o, error);
    });
  });
  root().appendChild(o);
  overlayEl = o;
  if (notice) {
    o.querySelectorAll('.menu-status, .account-status').forEach((status) => {
      status.textContent = notice;
    });
  }
  showView(menuView);
  focusView();
  const body = o.querySelector('.menu-body');
  if (body) body.scrollTop = scrolled;
}

function dailyQuestRow(quest: DailyQuest, save: SaveData): string {
  const current = Math.min(quest.target, Math.floor(save.dailyProgress[quest.metric]));
  const claimed = save.claimedDaily.includes(quest.id);
  const ready = current >= quest.target && !claimed;
  return `<div class="daily-quest"><span>${quest.description}</span><small>${current}/${quest.target} · ${money(quest.reward)}</small>
    <button data-claim="${quest.id}" ${ready ? '' : 'disabled'}>${claimed ? 'CLAIMED' : 'CLAIM'}</button></div>`;
}

function setAccountStatus(rootElement: HTMLElement, error: unknown): void {
  const status = rootElement.querySelector<HTMLElement>('.account-status');
  if (status) status.textContent = typeof error === 'string' ? error : error instanceof Error ? error.message : 'Account request failed.';
}

function pips(level: number, max: number): string {
  let s = '';
  for (let i = 0; i < max; i++) s += `<i class="${i < level ? 'on' : ''}"></i>`;
  return `<span class="pips">${s}</span>`;
}

type Tab = 'market' | 'upgrades' | 'contracts';
let tab: Tab = 'market';
const TABS: { id: Tab; label: string }[] = [
  { id: 'market', label: 'Market' },
  { id: 'upgrades', label: 'Upgrades' },
  { id: 'contracts', label: 'Contracts' },
];

const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function renderShop(): void {
  const api = shopApi;
  if (!api) return;
  const box = document.getElementById('shop');
  if (!box) return;
  const save = api.save;
  const cargo = api.cargo();
  const stats = api.stats();
  const hull = api.hull();
  const fuel = api.fuel();
  const clock = api.clock();
  const info = api.info();
  const sector = Math.min(info.threat, 8);
  const act = api.active();
  const offers = api.offers();

  let body: string;
  if (tab === 'market') {
    let holdValue = 0;
    const rows = ORE_IDS.map((o) => {
      const p = api.market.prices[o];
      holdValue += p * cargo[o];
      const ch = ((p - api.market.prev[o]) / api.market.prev[o]) * 100;
      const cls = ch > 0.4 ? 'up' : ch < -0.4 ? 'down' : '';
      const ev = api.market.events.find((e) => e.ore === o);
      return `<tr>
        <td>${oreIcon(o, 'oi sw')}${ORES[o].name}${ev ? `<small class="evtag">${ev.label.split(':')[0]}</small>` : ''}</td>
        <td class="num">${money(p)}</td>
        <td class="num"><em class="${cls}">${ch > 0.4 ? '+' : ''}${ch.toFixed(0)}%</em></td>
        <td class="num">${cargo[o]}</td>
        <td class="num">${money(p * cargo[o])}</td>
        <td class="r"><button data-act="sell" data-id="${o}" ${cargo[o] ? '' : 'disabled'}>Sell</button></td>
      </tr>`;
    }).join('');
    const hullMissing = Math.ceil(stats.hullMax - hull);
    const fuelMissing = Math.ceil(stats.fuelMax - fuel);
    const rc = repairCost(hullMissing, sector);
    const fc = refuelCost(fuelMissing, sector);
    body = `
      <div class="sub-h">Ore buyers</div>
      <table class="grid">
        <thead><tr><th>Ore</th><th class="num">Price</th><th class="num">Trend</th><th class="num">Hold</th><th class="num">Value</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="4">Total cargo value</td><td class="num">${money(holdValue)}</td><td class="r"><button class="primary" data-act="sellall" ${cargoTotal(cargo) ? '' : 'disabled'}>Sell all</button></td></tr></tfoot>
      </table>
      <div class="sub-h">Ship service</div>
      <table class="grid">
        <thead><tr><th>System</th><th class="num">Level</th><th class="num">Cost</th><th></th></tr></thead>
        <tbody>
          <tr><td>Hull</td><td class="num">${Math.ceil(hull)} / ${stats.hullMax}</td><td class="num">${hullMissing > 0 ? money(rc) : '-'}</td><td class="r"><button data-act="repair" ${hullMissing > 0 && save.money >= 1 ? '' : 'disabled'}>Repair</button></td></tr>
          <tr><td>Fuel</td><td class="num">${Math.ceil(fuel)} / ${stats.fuelMax}</td><td class="num">${fuelMissing > 0 ? money(fc) : '-'}</td><td class="r"><button data-act="refuel" ${fuelMissing > 0 && save.money >= 1 ? '' : 'disabled'}>Refuel</button></td></tr>
        </tbody>
        <tfoot><tr><td colspan="2">Full service</td><td class="num">${money(rc + fc)}</td><td class="r"><button data-act="service" ${hullMissing + fuelMissing > 0 ? '' : 'disabled'}>Do both</button></td></tr></tfoot>
      </table>`;
  } else if (tab === 'upgrades') {
    const rows = UPGRADES.map((u) => {
      const lvl = save.levels[u.id];
      const maxed = lvl >= u.max;
      const cost = maxed ? 0 : upgradeCost(u.id, lvl);
      return `<tr>
        <td><b>${u.name}</b></td>
        <td class="desc">${u.desc}</td>
        <td>${pips(lvl, u.max)}</td>
        <td class="num">${maxed ? '-' : money(cost)}</td>
        <td class="r"><button data-act="buy" data-id="${u.id}" ${maxed || !canBuyUpgrade(save, u.id) ? 'disabled' : ''}>${maxed ? 'Maxed' : 'Buy'}</button></td>
      </tr>`;
    }).join('');
    body = `<table class="grid">
      <thead><tr><th>Equipment</th><th>Effect</th><th>Level</th><th class="num">Cost</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  } else {
    const row = (c: Contract, mode: 'active' | 'offer'): string => {
      const left = Math.max(0, Math.round(c.deadline - clock));
      const have = cargo[c.ore];
      const btn =
        mode === 'offer'
          ? `<button data-act="accept" data-id="${c.id}" ${act.length >= 2 ? 'disabled' : ''}>Accept</button>`
          : have >= c.qty
            ? `<button class="primary" data-act="deliver">Deliver</button>`
            : `<span class="dim">${have} / ${c.qty} held</span>`;
      return `<tr>
        <td>${oreIcon(c.ore, 'oi sw')}${ORES[c.ore].name}</td>
        <td class="num">${c.qty}</td>
        <td class="num">${mmss(left)}</td>
        <td class="num">${money(c.reward)}</td>
        <td class="r">${btn}</td>
      </tr>`;
    };
    const head = '<thead><tr><th>Ore</th><th class="num">Qty</th><th class="num">Time</th><th class="num">Pays</th><th></th></tr></thead>';
    body = `
      <div class="sub-h">Accepted (${act.length} / 2)</div>
      <table class="grid">${head}<tbody>${act.map((c) => row(c, 'active')).join('') || '<tr><td colspan="5" class="empty">No accepted contracts.</td></tr>'}</tbody></table>
      <div class="sub-h">Available <button class="mini" data-act="refresh">Reroll</button></div>
      <table class="grid">${head}<tbody>${offers.map((c) => row(c, 'offer')).join('') || '<tr><td colspan="5" class="empty">No offers right now.</td></tr>'}</tbody></table>
      <p class="note">Contracts are filled automatically when you dock with enough ore. Late contracts pay nothing.</p>`;
  }

  const { mission } = info;
  const pct = Math.min(100, (info.earned / info.goal) * 100);
  const gate = api.gateReady()
    ? 'Warp gate open'
    : info.bossName
      ? `Meet quota and mission, then defeat the ${info.bossName}`
      : info.earned < info.goal
        ? `Quota: ${money(info.goal - info.earned)} more`
        : `Mission: ${mission.description} (${mission.progress}/${mission.target})`;
  const html = `
    <div class="wt"><span>HOME STATION - ${info.name.toUpperCase()}</span><button class="x" data-act="launch" title="Launch (E)">X</button></div>
    <div class="wb">
      <div class="shop-top">
        <div class="tabs">${TABS.map((t) => `<button class="tab ${t.id === tab ? 'on' : ''}" data-act="tab" data-id="${t.id}">${t.label}</button>`).join('')}</div>
        <div class="funds"><label>CASH</label><b class="lcd">${money(save.money)}</b></div>
      </div>
      <div class="tabbody">${body}</div>
      <div class="statusbar">
        <div class="quota"><span>${info.quotaLabel}</span><div class="track goal"><i style="width:${pct}%"></i></div><span>${money(info.earned)} / ${money(info.goal)}</span><span class="gate">${mission.complete ? 'Mission complete · ' : ''}${gate}</span></div>
        <button class="primary" data-act="launch">Launch (E)</button>
      </div>
    </div>`;
  // redrawn every second: replacing identical markup would still drop scroll and focus
  if (box.firstElementChild && html === shopHtml) return;
  const scroll = shopTab === tab ? (box.querySelector('.tabbody')?.scrollTop ?? 0) : 0;
  const focused = box.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
  const focusKey = focused?.dataset.act ? `[data-act="${focused.dataset.act}"]${focused.dataset.id ? `[data-id="${focused.dataset.id}"]` : ''}` : '';
  shopHtml = html;
  shopTab = tab;
  box.innerHTML = html;
  const body_ = box.querySelector('.tabbody');
  if (body_) body_.scrollTop = scroll;
  if (focusKey) box.querySelector<HTMLElement>(focusKey)?.focus({ preventScroll: true });
}

export function openShop(api: ShopApi): void {
  closeShop();
  tab = 'market';
  shopApi = api;
  const o = document.createElement('div');
  o.className = 'overlay shop-wrap';
  o.innerHTML = '<div class="shop" id="shop"></div>';
  root().appendChild(o);
  overlayEl = o;
  o.addEventListener('pointerdown', () => (pressed = true));
  window.addEventListener('pointerup', () => (pressed = false));
  o.addEventListener('click', (ev) => {
    const t = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!t || !shopApi) return;
    const id = t.dataset.id ?? '';
    switch (t.dataset.act) {
      case 'sell':
        shopApi.sell(id as OreId);
        break;
      case 'sellall':
        shopApi.sell('all');
        break;
      case 'repair':
        shopApi.repair();
        break;
      case 'refuel':
        shopApi.refuel();
        break;
      case 'service':
        shopApi.service();
        break;
      case 'buy':
        shopApi.buy(id as UpgradeId);
        break;
      case 'accept':
        shopApi.accept(Number(id));
        break;
      case 'deliver':
        shopApi.deliver();
        break;
      case 'refresh':
        shopApi.refresh();
        break;
      case 'tab':
        tab = id as Tab;
        break;
      case 'launch':
        shopApi.launch();
        return;
    }
    renderShop();
  });
  renderShop();
  shopTimer = window.setInterval(() => {
    if (!pressed) renderShop();
  }, 1000);
}

export function closeShop(): void {
  window.clearInterval(shopTimer);
  shopApi = null;
  closeOverlay();
}

export function refreshShop(): void {
  renderShop();
}

export function shopOpen(): boolean {
  return shopApi !== null;
}
