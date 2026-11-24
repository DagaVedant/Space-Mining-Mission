import { ORES, ORE_IDS, SECTORS, UPGRADES, type OreId, type UpgradeId } from './data';
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
function setText(id: string, v: string): void {
  if (cache.get(id) === v) return;
  cache.set(id, v);
  el(id).textContent = v;
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

function buildHud(): void {
  if (hudBuilt) return;
  hudBuilt = true;
  const h = document.createElement('div');
  h.id = 'hud';
  h.className = 'hidden';
  h.innerHTML = `
    <div id="hurt"></div>
    <div id="flare"></div>
    <div class="panel hud-left">
      <div class="bar"><span>HULL</span><div class="track"><i id="b-hull" class="hull"></i></div><b id="v-hull"></b></div>
      <div class="bar"><span>FUEL</span><div class="track"><i id="b-fuel" class="fuel"></i></div><b id="v-fuel"></b></div>
      <div class="bar"><span>HOLD</span><div class="track"><i id="b-cargo" class="cargo"></i></div><b id="v-cargo"></b></div>
      <div id="cargo-list"></div>
    </div>
    <div class="panel hud-top">
      <div class="sector"><span id="sector-name"></span><b id="money"></b></div>
      <div class="track goal"><i id="b-goal"></i></div>
      <div class="goal-text" id="goal-text"></div>
    </div>
    <div class="panel hud-right" id="contracts-panel"><h4>CONTRACTS</h4><div id="contracts"></div></div>
    <div id="bossbar" class="hidden"><span>DREADNOUGHT</span><div class="track"><i id="b-boss"></i></div></div>
    <div id="banner" class="hidden"></div>
    <div id="toasts"></div>
    <div id="hint" class="hidden"></div>
    <div class="panel ticker" id="ticker"></div>
    <div class="panel keys" id="keys">WASD move &nbsp; Mouse aim/fire &nbsp; E dock / gate &nbsp; Esc pause &nbsp; M mute</div>
    <canvas id="minimap" width="180" height="180"></canvas>`;
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
    setWidth('b-hull', (s.hull / s.hullMax) * 100);
    setText('v-hull', `${Math.ceil(s.hull)}/${s.hullMax}`);
    setWidth('b-fuel', (s.fuel / s.fuelMax) * 100);
    setText('v-fuel', `${Math.ceil(s.fuel)}/${s.fuelMax}`);
    const used = cargoTotal(s.cargo);
    setWidth('b-cargo', (used / s.cargoMax) * 100);
    setText('v-cargo', `${used}/${s.cargoMax}`);
    el('b-fuel').classList.toggle('low', s.fuel / s.fuelMax < 0.2);
    el('b-hull').classList.toggle('low', s.hull / s.hullMax < 0.3);
    const parts = ORE_IDS.filter((o) => s.cargo[o] > 0).map(
      (o) => `<span style="color:${ORES[o].css}">${ORES[o].name} ${s.cargo[o]}</span>`,
    );
    const cl = parts.join('') || '<span class="dim">Hold empty</span>';
    if (cache.get('cl') !== cl) {
      cache.set('cl', cl);
      el('cargo-list').innerHTML = cl;
    }
    setText('money', money(s.money));
    const sec = SECTORS[s.sector];
    setText('sector-name', `SECTOR ${s.sector + 1} - ${sec.name.toUpperCase()}`);
    setWidth('b-goal', (s.earned / s.goal) * 100);
    setText('goal-text', s.earned >= s.goal ? 'Goal reached' : `Earn ${money(s.goal - s.earned)} more to open the way`);
    const cs = s.contracts
      .map((c) => {
        const left = Math.max(0, Math.round(c.deadline - s.clock));
        const m = Math.floor(left / 60);
        const sc = String(left % 60).padStart(2, '0');
        return `<div class="ct"><b style="color:${ORES[c.ore].css}">${c.qty} ${ORES[c.ore].name}</b><span>${money(c.reward)}</span><em>${m}:${sc}</em></div>`;
      })
      .join('');
    const csh = cs || '<div class="dim">None - pick some up at the station</div>';
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
      return `<div class="tk${ev}"><i style="background:${ORES[o].css}"></i><span>${ORES[o].name}</span><b>${money(priceOf(s.market, o))}</b><em class="${cls}">${sign}${ch.toFixed(0)}%</em></div>`;
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
  o.innerHTML = `<div class="card"><h2>${title}</h2><p>${body}</p>${extra}<div class="btns"></div></div>`;
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
    ? `<div class="save">Saved run: Sector ${save.sector + 1} (${SECTORS[save.sector].name}), ${money(save.money)}, ${upgrades} upgrades</div>`
    : '';
  o.innerHTML = `
    <div class="menu-body">
      <div class="tag">MINING CONTRACT 7 / OUTER BELT</div>
      <h1>ROCKBREAKER</h1>
      <p class="sub">Crack the rocks. Sell the ore. Outgrow the belt.</p>
      <div class="btns"></div>
      ${info}
      <ul class="how">
        <li><b>WASD</b> thrust (you drift - plan your stops)</li>
        <li><b>Mouse</b> aim, <b>hold left button</b> to fire the mining cannon</li>
        <li><b>E</b> dock at the station to sell, repair and upgrade</li>
        <li>Watch the market, take contracts, hire drones, beat the pirates</li>
        <li>Earn enough to open the warp gate. Four sectors, one Dreadnought.</li>
      </ul>
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
  let holdValue = 0;
  const rows = ORE_IDS.map((o) => {
    const p = api.market.prices[o];
    holdValue += p * cargo[o];
    const ch = ((p - api.market.prev[o]) / api.market.prev[o]) * 100;
    const cls = ch > 0.4 ? 'up' : ch < -0.4 ? 'down' : '';
    const ev = api.market.events.find((e) => e.ore === o);
    return `<tr>
      <td><i class="sw" style="background:${ORES[o].css}"></i>${ORES[o].name}${ev ? `<small class="evtag">${ev.label.split(':')[0]}</small>` : ''}</td>
      <td class="num">${money(priceOf(api.market, o))} <em class="${cls}">${ch > 0.4 ? '+' : ''}${ch.toFixed(0)}%</em></td>
      <td class="num">${cargo[o]}</td>
      <td><button data-act="sell" data-id="${o}" ${cargo[o] ? '' : 'disabled'}>Sell</button></td>
    </tr>`;
  }).join('');
  const hullMissing = Math.ceil(stats.hullMax - hull);
  const fuelMissing = Math.ceil(stats.fuelMax - fuel);
  const rc = repairCost(hullMissing, sector);
  const fc = refuelCost(fuelMissing, sector);
  const ups = UPGRADES.map((u) => {
    const lvl = save.levels[u.id];
    const maxed = lvl >= u.max;
    const cost = maxed ? 0 : upgradeCost(u.id, lvl);
    return `<div class="up">
      <div class="up-h"><b>${u.name}</b>${pips(lvl, u.max)}</div>
      <p>${u.desc}</p>
      <button data-act="buy" data-id="${u.id}" ${maxed || !canBuyUpgrade(save, u.id) ? 'disabled' : ''}>${maxed ? 'MAX' : 'Buy ' + money(cost)}</button>
    </div>`;
  }).join('');
  const act = api.active();
  const offers = api.offers();
  const ctRow = (c: Contract, mode: 'active' | 'offer'): string => {
    const left = Math.max(0, Math.round(c.deadline - clock));
    const have = cargo[c.ore];
    const btn =
      mode === 'offer'
        ? `<button data-act="accept" data-id="${c.id}" ${act.length >= 2 ? 'disabled' : ''}>Accept</button>`
        : have >= c.qty
          ? `<button data-act="deliver" class="primary">Deliver</button>`
          : `<span class="dim">${have}/${c.qty}</span>`;
    return `<div class="ctr"><div><b style="color:${ORES[c.ore].css}">${c.qty} ${ORES[c.ore].name}</b><small>${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</small></div><span class="num">${money(c.reward)}</span>${btn}</div>`;
  };
  const sec = SECTORS[sector];
  const reached = save.sectorEarned >= sec.goal;
  box.innerHTML = `
    <header>
      <div><span class="tag">HOME STATION</span><h2>${sec.name}</h2></div>
      <div class="funds"><small>FUNDS</small><b>${money(save.money)}</b></div>
    </header>
    <div class="cols">
      <section>
        <h3>Market</h3>
        <table><thead><tr><th>Ore</th><th>Price</th><th>Hold</th><th></th></tr></thead><tbody>${rows}</tbody></table>
        <button class="wide primary" data-act="sellall" ${cargoTotal(cargo) ? '' : 'disabled'}>Sell everything (${money(holdValue)})</button>
        <h3>Ship service</h3>
        <div class="svc"><span>Hull ${Math.ceil(hull)}/${stats.hullMax}</span><button data-act="repair" ${hullMissing > 0 && save.money >= 1 ? '' : 'disabled'}>Repair ${hullMissing > 0 ? money(rc) : ''}</button></div>
        <div class="svc"><span>Fuel ${Math.ceil(fuel)}/${stats.fuelMax}</span><button data-act="refuel" ${fuelMissing > 0 && save.money >= 1 ? '' : 'disabled'}>Refuel ${fuelMissing > 0 ? money(fc) : ''}</button></div>
        <button class="wide" data-act="service" ${hullMissing + fuelMissing > 0 ? '' : 'disabled'}>Repair and refuel (${money(rc + fc)})</button>
      </section>
      <section class="ups"><h3>Upgrades</h3><div class="upgrid">${ups}</div></section>
      <section>
        <h3>Active contracts (${act.length}/2)</h3>
        ${act.map((c) => ctRow(c, 'active')).join('') || '<p class="dim">None accepted.</p>'}
        <h3>Offers <button class="mini" data-act="refresh">Reroll</button></h3>
        ${offers.map((c) => ctRow(c, 'offer')).join('') || '<p class="dim">No offers.</p>'}
        <h3>Sector progress</h3>
        <div class="track goal"><i style="width:${Math.min(100, (save.sectorEarned / sec.goal) * 100)}%"></i></div>
        <p class="dim">${money(save.sectorEarned)} / ${money(sec.goal)} earned${reached ? (api.gateReady() ? ' - warp gate is open' : ' - defeat the Dreadnought') : ''}</p>
      </section>
    </div>
    <footer><button class="primary big" data-act="launch">Launch (E)</button></footer>`;
}

export function openShop(api: ShopApi): void {
  closeShop();
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
