import { ORES, type OreId } from './data';

// Hand-made 12-wide pixel sprites, one distinct silhouette per ore so they read at a glance:
// ferrite = metal ingot, cobalt = blue gem, platinum = silver nugget, voidstone = purple shard.
// o outline, h highlight, b base, d shadow, w sparkle
export const ORE_SPRITE: Record<OreId, string[]> = {
  ferrite: [
    '..oooooooo..',
    '.ohhhhhhhho.',
    'ohhhwhhhhhbo',
    'oooooooooooo',
    'obbbbbbbbbdo',
    'obbbbbbbbbdo',
    'obbbbbbbbddo',
    'oooooooooooo',
  ],
  cobalt: [
    '....oooo....',
    '...ohhhho...',
    '..ohhwhbbo..',
    '.ohhhhbbbdo.',
    'ohhhhbbbbddo',
    'ohhhbbbbbddo',
    'ohhbbbbbbddo',
    '.ohbbbbbddo.',
    '..obbbbdddo.',
    '...obbddo...',
    '....oddo....',
    '.....oo.....',
  ],
  platinum: [
    '...oooo.....',
    '..ohhhhoo...',
    '.ohhwhhhbo..',
    'ohhhhhhbbbo.',
    'ohhhhhbbbbdo',
    'ohhhbbbbbddo',
    '.obbbbbbdddo',
    '..obbbbddoo.',
    '...ooooooo..',
  ],
  voidstone: [
    '....oo......',
    '...ohho.oo..',
    '...ohbbooho.',
    '..ohhbbdohbo',
    '..ohhbbdobbo',
    '.ohhhwbbddbo',
    '.ohhbwbbddbo',
    'ohhbbbbbdddo',
    'ohbbbbbbdddo',
    'oobbbbbddooo',
    '.oooooooooo.',
  ],
};

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}
function mixHex(c: number, to: number, t: number): number {
  const ch = (s: number) => Math.round(((c >> s) & 255) * (1 - t) + ((to >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export function orePalette(id: OreId): Record<string, number> {
  const c = ORES[id].color;
  return {
    o: 0x14110e,
    h: mixHex(c, 0xffffff, 0.38),
    b: c,
    d: mixHex(c, 0x000000, 0.4),
    w: 0xffffff,
  };
}

/** Inline SVG for HTML UI (hotbar, price strip, shop). */
export function oreIcon(id: OreId, cls = 'oi'): string {
  const rows = ORE_SPRITE[id];
  const pal = orePalette(id);
  let rects = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch !== '.') rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${hex(pal[ch])}"/>`;
    }
  });
  return `<svg class="${cls}" viewBox="0 0 12 ${rows.length}" shape-rendering="crispEdges">${rects}</svg>`;
}
