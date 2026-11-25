import { ORES, ORE_IDS, SECTORS, UPGRADES, type OreId, type UpgradeId } from './data';
import { oreIcon } from './oreart';
import { priceOf, targetMult, type MarketState } from './market';
import {
  canBuyUpgrade,
  cargoTotal,
  refuelCost,
  repairCost,
  upgradeCost,
  type Cargo,
  type Contract,
  type SaveData,
  type ShipStats,
} from './progress';

const root = (): HTMLElement => document.getElementById('ui') as HTMLElement;
const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

export const money = (n: number): string => '$' + Math.round(n).toLocaleString('en-US');

export interface HudState {
  hull: number;
  hullMax: number;
  fuel: number;
  fuelMax: number;
  cargo: Cargo;
  cargoMax: number;
  money: number;
  sector: number;
  earned: number;
  goal: number;
  contracts: Contract[];
  clock: number;
  market: MarketState;
  boss: { hp: number; max: number } | null;
}

export interface ShopApi {
  save: SaveData;
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

// 7x6 / 7x7 pixel icons, drawn as crisp SVG rects like inventory sprites
const HEART = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
const BOLT = ['....XX.', '...XX..', '..XX...', '.XXXXX.', '...XX..', '..XX...', '.XX....'];
function pixelIcon(rows: string[], on: string, frac: number): string {
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
  const slots = Array.from({ length: 9 }, (_, i) => {
    const o = ORE_IDS[i];
    if (!o) return '<div class="slot"></div>';
    return `<div class="slot" id="slot-${o}" title="${ORES[o].name}">${oreIcon(o, 'ic')}<b class="n"></b></div>`;
  }).join('');
  h.innerHTML = `
    <div id="hurt"></div>
    <div id="flare"></div>
    <div id="bar" class="plate">
      <div class="cash"><span id="money"></span></div>
      <div id="sector-name"></div>
      <div id="goal-text" class="dimt"></div>
      <div id="v-cargo" class="dimt"></div>
    </div>
    <div class="win contracts"><div class="wt">CONTRACTS</div><div class="wb" id="contracts"></div></div>
    <div id="bossbar" class="hidden"><span>DREADNOUGHT</span><div class="track"><i id="b-boss"></i></div></div>
    <div id="banner" class="hidden"></div>
    <div id="toasts"></div>
    <div id="hint" class="hidden"></div>
    <div id="pricebar" class="plate"><div class="pl">PRICES</div><div id="ticker"></div></div>
    <div class="keys" id="keys">WASD move | Shift turbo | Space or click fire (aim with mouse) | E dock / gate | Esc pause | M mute</div>
    <div class="win mapwin"><div class="wt">MAP</div><canvas id="minimap" width="180" height="180"></canvas></div>
    <div id="dock">
      <div class="vitals"><div id="hearts" class="icons"></div><div id="bolts" class="icons"></div></div>
      <div class="xp" title="Sector quota"><i id="b-goal"></i></div>
      <div id="hotbar">${slots}</div>
    </div>`;
  root().appendChild(h);
}

export const hud = {
  show(): void {
    buildHud();
    cache.clear();
    el('hud').classList.remove('hidden');
    el('toasts').innerHTML = '';
    el('banner').classList.add('hidden');
    window.setTimeout(() => el('keys')?.classList.add('fade'), 25000);
  },
  hide(): void {
    if (!hudBuilt) return;
    el('hud').classList.add('hidden');
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
    const sec = SECTORS[s.sector];
    setText('sector-name', `Sector ${s.sector + 1}: ${sec.name}`);
    setWidth('b-goal', (s.earned / s.goal) * 100);
    setText('goal-text', s.earned >= s.goal ? 'Quota met' : `Quota ${money(s.earned)} / ${money(s.goal)}`);
    setText('v-cargo', `Hold ${used} / ${s.cargoMax}`);
    const cs = s.contracts
      .map((c) => {
        const left = Math.max(0, Math.round(c.deadline - s.clock));
        const m = Math.floor(left / 60);
        const sc = String(left % 60).padStart(2, '0');
        return `<div class="ct"><b style="color:${ORES[c.ore].css}">${c.qty} ${ORES[c.ore].name}</b><span>${money(c.reward)}</span><em>${m}:${sc}</em></div>`;
      })
      .join('');
    const csh = cs || '<div class="empty">No active contracts. Pick some up at the station.</div>';
    if (cache.get('ct') !== csh) {
      cache.set('ct', csh);
      el('contracts').innerHTML = csh;
    }
    const tk = ORE_IDS.map((o) => {
      const p = s.market.prices[o];
      const pv = s.market.prev[o];
      const ch = ((p - pv) / pv) * 100;
      const cls = ch > 0.4 ? 'up' : ch < -0.4 ? 'down' : '';
      const sign = ch > 0.4 ? '+' : '';
      const ev = targetMult(s.market, o) !== 1 ? ' ev' : '';
      return `<div class="tk${ev}">${oreIcon(o)}<span>${ORES[o].name}</span><b>${money(priceOf(s.market, o))}</b><em class="${cls}">${sign}${ch.toFixed(0)}%</em></div>`;
    }).join('');
    const tkFull = tk + (s.market.events.length ? `<div class="evt">${s.market.events.map((e) => e.label).join(' / ')}</div>` : '');
    if (cache.get('tk') !== tkFull) {
      cache.set('tk', tkFull);
      el('ticker').innerHTML = tkFull;
    }
    const bb = el('bossbar');
    if (s.boss) {
      bb.classList.remove('hidden');
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
    while (box.children.length > 5) box.removeChild(box.firstChild as Node);
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

// ---------- overlays (menu, pause, death, victory) ----------

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
  o.innerHTML = `<div class="win card"><div class="wt">${title}</div><div class="wb"><p>${body}</p>${extra}<div class="btns"></div></div></div>`;
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

export function showMenu(save: SaveData | null, onContinue: () => void, onNew: () => void): void {
  closeOverlay();
  const o = document.createElement('div');
  o.className = 'menu';
  const upgrades = save ? Object.values(save.levels).reduce((a, b) => a + b, 0) : 0;
  const info = save
    ? `<div class="save">Saved run: Sector ${save.sector + 1} (${SECTORS[save.sector].name}) | Cash ${money(save.money)} | ${upgrades} upgrades</div>`
    : '';
  o.innerHTML = `
    <div class="win menu-body">
      <div class="wt">Rockbreaker Mining Co.</div>
      <div class="wb">
        <h1>ROCKBREAKER</h1>
        <p class="sub">Crack the rocks. Sell the ore. Outgrow the belt.</p>
        <div class="btns"></div>
        ${info}
        <ul class="how">
          <li><b>WASD</b> thrust (you drift - plan your stops)</li>
          <li><b>Mouse</b> aim, <b>Space</b> or <b>left button</b> fires, <b>Shift</b> is turbo (burns fuel fast)</li>
          <li><b>E</b> dock at the station to sell, repair and upgrade</li>
          <li>Watch the market, take contracts, hire drones, beat the pirates</li>
          <li>Meet each sector's quota to open the warp gate. Four sectors, one Dreadnought.</li>
        </ul>
      </div>
    </div>`;
  const box = o.querySelector('.btns') as HTMLElement;
  if (save) {
    const c = document.createElement('button');
    c.className = 'primary';
    c.textContent = 'Continue';
    c.addEventListener('click', onContinue);
    box.appendChild(c);
  }
  const n = document.createElement('button');
  n.textContent = 'New Game';
  if (!save) n.className = 'primary';
  n.addEventListener('click', () => {
    if (save && !window.confirm('Start over? Your saved run will be erased.')) return;
    onNew();
  });
  box.appendChild(n);
  root().appendChild(o);
  overlayEl = o;
  (box.querySelector('button.primary') as HTMLElement | null)?.focus();
}

// ---------- shop ----------

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
  const sector = save.sector;
  const sec = SECTORS[sector];
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

  const reached = save.sectorEarned >= sec.goal;
  const pct = Math.min(100, (save.sectorEarned / sec.goal) * 100);
  const gate = reached ? (api.gateReady() ? 'Warp gate open' : 'Defeat the Dreadnought') : 'Quota not met';
  box.innerHTML = `
    <div class="wt"><span>HOME STATION - ${sec.name.toUpperCase()}</span><button class="x" data-act="launch" title="Launch (E)">X</button></div>
    <div class="wb">
      <div class="shop-top">
        <div class="tabs">${TABS.map((t) => `<button class="tab ${t.id === tab ? 'on' : ''}" data-act="tab" data-id="${t.id}">${t.label}</button>`).join('')}</div>
        <div class="funds"><label>CASH</label><b class="lcd">${money(save.money)}</b></div>
      </div>
      <div class="tabbody">${body}</div>
      <div class="statusbar">
        <div class="quota"><span>Sector quota</span><div class="track goal"><i style="width:${pct}%"></i></div><span>${money(save.sectorEarned)} / ${money(sec.goal)}</span><span class="gate">${gate}</span></div>
        <button class="primary" data-act="launch">Launch (E)</button>
      </div>
    </div>`;
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
