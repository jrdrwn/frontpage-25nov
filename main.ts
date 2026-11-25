// "25 November 2026 in One Image" — news-image-20261125
// A deterministic, dependency-free Node 22 program that draws a broadsheet
// front page for Wednesday 25 November 2026 as a 1024x1024 PNG.
// No network, no external assets, no Date.now / Math.random: every pixel
// comes from fixed content and a seeded PRNG, so two runs write identical bytes.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import * as crypto from "node:crypto";

const W = 1024;
const H = 1024;

// ---- palette: deep ink navy + paper cream + bold red + teal ----
const INK: RGB = [20, 33, 61];
const INK2: RGB = [30, 48, 86];
const PAPER: RGB = [246, 239, 221];
const PAPER2: RGB = [238, 229, 203];
const PANEL: RGB = [251, 247, 236];
const RED: RGB = [193, 39, 45];
const RED2: RGB = [158, 28, 34];
const TEAL: RGB = [14, 124, 123];
const TEAL2: RGB = [10, 92, 92];
const GOLD: RGB = [217, 164, 65];
const GRAY: RGB = [90, 90, 82];
const WHITE: RGB = [255, 255, 255];
const DUSK1: RGB = [232, 122, 48];
const DUSK2: RGB = [120, 52, 84];

type RGB = [number, number, number];

// ---- deterministic PRNG (mulberry32, fixed seed) ----
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- CRC32 (PNG chunk checksums) ----
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(rgb: Uint8Array, width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0; // filter: none
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), rowStart + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- canvas ----
const img = new Uint8Array(W * H * 3);

function setPx(x: number, y: number, c: RGB): void {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  img[i] = c[0];
  img[i + 1] = c[1];
  img[i + 2] = c[2];
}

function getPx(x: number, y: number): RGB {
  const i = (y * W + x) * 3;
  return [img[i], img[i + 1], img[i + 2]];
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w);
  const y1 = Math.min(H, y + h);
  for (let yy = y0; yy < y1; yy++) {
    let i = (yy * W + x0) * 3;
    for (let xx = x0; xx < x1; xx++) {
      img[i] = c[0];
      img[i + 1] = c[1];
      img[i + 2] = c[2];
      i += 3;
    }
  }
}

function hline(x: number, y: number, w: number, c: RGB): void {
  fillRect(x, y, w, 1, c);
}

function vline(x: number, y: number, h: number, c: RGB): void {
  fillRect(x, y, 1, h, c);
}

function rect(x: number, y: number, w: number, h: number, c: RGB, t = 1): void {
  fillRect(x, y, w, t, c);
  fillRect(x, y + h - t, w, t, c);
  fillRect(x, y, t, h, c);
  fillRect(x + w - t, y, t, h, c);
}

// Bresenham line, thickness 1 (or t for a square brush)
function line(x0: number, y0: number, x1: number, y1: number, c: RGB, t = 1): void {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  for (let guard = 0; guard < 4096; guard++) {
    fillRect(x - Math.floor(t / 2), y - Math.floor(t / 2), t, t, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

function fillCircle(cx: number, cy: number, r: number, c: RGB): void {
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y));
    fillRect(cx - half, cy + y, half * 2 + 1, 1, c);
  }
}

function circle(cx: number, cy: number, r: number, c: RGB, t = 1): void {
  for (let a = 0; a < 360; a += 1) {
    const rad = (a * Math.PI) / 180;
    const x = Math.round(cx + Math.cos(rad) * r);
    const y = Math.round(cy + Math.sin(rad) * r);
    fillRect(x - Math.floor(t / 2), y - Math.floor(t / 2), t, t, c);
  }
}

// filled triangle by scanline interpolation
function fillTriangle(
  x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB,
): void {
  const minY = Math.max(0, Math.min(y0, y1, y2));
  const maxY = Math.min(H - 1, Math.max(y0, y1, y2));
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = [];
    const edges: [number, number, number, number][] = [
      [x0, y0, x1, y1],
      [x1, y1, x2, y2],
      [x2, y2, x0, y0],
    ];
    for (const [ax, ay, bx, by] of edges) {
      if ((ay <= y && by > y) || (by <= y && ay > y)) {
        xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
    }
    if (xs.length >= 2) {
      const lo = Math.max(0, Math.floor(Math.min(...xs)));
      const hi = Math.min(W - 1, Math.ceil(Math.max(...xs)));
      fillRect(lo, y, hi - lo + 1, 1, c);
    }
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
  ];
}

// vertical gradient rectangle
function vgrad(x: number, y: number, w: number, h: number, top: RGB, bottom: RGB): void {
  for (let yy = 0; yy < h; yy++) {
    fillRect(x, y + yy, w, 1, mix(top, bottom, yy / Math.max(1, h - 1)));
  }
}

// horizontal gradient rectangle
function hgrad(x: number, y: number, w: number, h: number, left: RGB, right: RGB): void {
  for (let xx = 0; xx < w; xx++) {
    fillRect(x + xx, y, 1, h, mix(left, right, xx / Math.max(1, w - 1)));
  }
}

// halftone dot field: dots whose radius grows with t (0..1) left->right
function halftone(
  x: number, y: number, w: number, h: number, c: RGB, spacing: number, maxR: number,
): void {
  for (let yy = y + spacing / 2; yy < y + h; yy += spacing) {
    for (let xx = x + spacing / 2; xx < x + w; xx += spacing) {
      const t = (xx - x) / Math.max(1, w);
      const r = Math.max(0, Math.round(maxR * (0.35 + 0.65 * t)));
      if (r > 0) fillCircle(Math.round(xx), Math.round(yy), r, c);
    }
  }
}

// ---- 5x7 bitmap font (hand-drawn, uppercase + digits + punctuation) ----
const GLYPHS: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#..##", "#.#.#", "##..#", "#...#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "...#.", "..#..", "..#..", "..#.."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  ",": [".....", ".....", ".....", ".....", ".....", ".##..", ".#..."],
  ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
  ";": [".....", ".##..", ".##..", ".....", ".##..", ".#...", "#...."],
  "'": ["..#..", "..#..", ".#...", ".....", ".....", ".....", "....."],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "-": [".....", ".....", ".....", ".###.", ".....", ".....", "....."],
  "(": ["...#.", "..#..", ".#...", ".#...", ".#...", "..#..", "...#."],
  ")": [".#...", "..#..", "...#.", "...#.", "...#.", "..#..", ".#..."],
  "/": ["....#", "...#.", "...#.", "..#..", ".#...", ".#...", "#...."],
  "&": [".##..", "#..#.", "#..#.", ".#...", "#.#.#", "#..#.", ".##.#"],
  "%": ["##..#", "##.#.", "...#.", "..#..", ".#...", "#.#..", "#.###"],
  $: ["..#..", ".####", "#.#..", ".###.", "..#.#", "####.", "..#.."],
  "+": [".....", "..#..", "..#..", ".###.", "..#..", "..#..", "....."],
  "=": [".....", ".....", "#####", ".....", "#####", ".....", "....."],
  '"': [".#.#.", ".#.#.", ".#.#.", ".....", ".....", ".....", "....."],
  "*": [".....", ".#.#.", "..#..", ".###.", "..#..", ".#.#.", "....."],
  _: [".....", ".....", ".....", ".....", ".....", ".....", "#####"],
  "@": [".###.", "#...#", "#.###", "#.#.#", "#.###", "#....", ".###."],
  "#": [".#.#.", ".#.#.", "#####", ".#.#.", "#####", ".#.#.", ".#.#."],
  "<": ["...#.", "..#..", ".#...", "#....", ".#...", "..#..", "...#."],
  ">": [".#...", "..#..", "...#.", "....#", "...#.", "..#..", ".#..."],
};

const BLANK = [".....", ".....", ".....", ".....", ".....", ".....", "....."];

function drawGlyph(x: number, y: number, ch: string, scale: number, c: RGB): void {
  const g = GLYPHS[ch] ?? BLANK;
  for (let r = 0; r < 7; r++) {
    const row = g[r];
    for (let col = 0; col < 5; col++) {
      if (row[col] === "#") fillRect(x + col * scale, y + r * scale, scale, scale, c);
    }
  }
}

// advance per character = 6 * scale (5 glyph + 1 gap)
function textWidth(s: string, scale: number): number {
  return s.length * 6 * scale - scale;
}

function drawText(x: number, y: number, s: string, scale: number, c: RGB): void {
  for (let i = 0; i < s.length; i++) {
    drawGlyph(x + i * 6 * scale, y, s[i], scale, c);
  }
}

function drawTextCentered(cx: number, y: number, s: string, scale: number, c: RGB): void {
  drawText(cx - Math.floor(textWidth(s, scale) / 2), y, s, scale, c);
}

function drawTextRight(xRight: number, y: number, s: string, scale: number, c: RGB): void {
  drawText(xRight - textWidth(s, scale), y, s, scale, c);
}

// a small filled diamond bullet used before brief lines
function bullet(x: number, y: number, c: RGB): void {
  fillRect(x + 1, y, 2, 4, c);
  fillRect(x, y + 1, 4, 2, c);
}

// ---- content: verified against live reporting, 25 Nov 2026 ----
// 4 heroes + 42 briefs = 46 stories. All briefs <= 38 chars.

interface Hero {
  kicker: string;
  accent: RGB;
  lines: string[];
  stand: string[];
  art: number; // 1 breach, 2 tower, 3 verdict, 4 trial
}

const HEROES: Hero[] = [
  {
    kicker: "THE BREACH",
    accent: RED,
    lines: ["AMERICA'S SPY", "NETWORK BREACHED"],
    stand: [
      "UNCLASSIFIED NETWORKS HIT; CLASSIFIED",
      "SYSTEMS SAFE; SIGNS POINT TO CHINA",
    ],
    art: 1,
  },
  {
    kicker: "THE TOWER",
    accent: TEAL,
    lines: ["RIYADH HIT AGAIN"],
    stand: [
      "SECOND STRIKE ON PIF TOWER IN A WEEK",
      "11 WOUNDED AS HOUTHIS THREATEN PORTS",
    ],
    art: 2,
  },
  {
    kicker: "THE VERDICT",
    accent: INK,
    lines: ["HUAWEI GUILTY ON", "10 COUNTS"],
    stand: [
      "JURY FINDS BANK FRAUD, TRADE-SECRET",
      "THEFT, SANCTIONS EVASION IN NEW YORK",
    ],
    art: 3,
  },
  {
    kicker: "THE TRIAL",
    accent: RED,
    lines: ["SARKOZY AND BRUNI", "TO STAND TRIAL"],
    stand: [
      "PARIS JUDGE ORDERS CORRUPTION TRIAL",
      "11 DEFENDANTS FACE UP TO 10 YEARS",
    ],
    art: 4,
  },
];

interface BriefGroup {
  name: string;
  color: RGB;
  items: string[];
}

const BRIEF_GROUPS: BriefGroup[] = [
  {
    name: "WORLD",
    color: INK,
    items: [
      "WHO EVACUATES EBOLA STAFF IN DRC",
      "DR CONGO MILITARY PLANE MISSING",
      "UKRAINE DEFENDS LIBYA SHIP STRIKE",
      "TWO LIBYAN SOLDIERS DIE AFTER STRIKE",
      "ZELENSKY CONFIRMS FINLAND SHIP STRIKE",
      "ZELENSKY REJECTS LUKASHENKO OFFER",
      "LUKASHENKO OFFERS ESCORT TO MOSCOW",
      "HOUTHIS WON'T SEIZE ADEN, ARMY SAYS",
      "HOUTHIS THREATEN SAUDI RED SEA PORTS",
      "COALITION STRIKES HODEIDAH IN REPLY",
      "MALAYSIA TO RETURN MIGRANTS TO MYANMAR",
      "IRAN: SINGER SENTENCED TO 74 LASHES",
      "CHINA PROBES SHANGHAI PARTY LEADER",
      "ABREGO GARCIA TO LEAVE US VOLUNTARILY",
      "US ENVOY DOUBTS ISRAEL AID ENDS IN 2026",
      "FRENCH STUDENTS TO PROTEST NATIONWIDE",
    ],
  },
  {
    name: "MARKETS",
    color: TEAL,
    items: [
      "SHEIN AGREES $100M FTC SETTLEMENT",
      "US SIGNS $2.45B TUNGSTEN DEALS",
      "NVIDIA SLIDES 5.86% AFTER MONDAY SURGE",
      "TRUMP READIES TARIFFS ON 16 ECONOMIES",
      "CITIGROUP WEIGHS VENEZUELA RETURN",
      "BLACK FRIDAY LAPTOP SALES BEGIN EARLY",
    ],
  },
  {
    name: "SCIENCE & HEALTH",
    color: RED,
    items: [
      "US MEASLES SURGE NEARS 1,000 CASES",
      "WISCONSIN REPORTS 3RD MEASLES DEATH",
      "SHENZHOU-24 LAUNCHES TO TIANGONG",
      "PAKISTANI ASTRONAUT REACHES TIANGONG",
      "EU, CANADA PLAN AI COLLABORATION",
      "IOWA TO DESTROY AGING EXPLOSIVES",
    ],
  },
  {
    name: "US & POLITICS",
    color: INK,
    items: [
      "TRUMP AWARDS GIULIANI MEDAL OF FREEDOM",
      "TRUMP PARDONS TURKEYS FREEDOM, FEATHERS",
      "FORT HOOD SHOOTER SEEKS EXECUTION STAY",
      "O'HARE RADAR OUTAGE DELAYS FLIGHTS",
      "S KOREA MINISTER QUITS OVER EXAM CHEAT",
      "EU SEEKS OVERHAUL OF UN CLIMATE RULES",
      "TRUMP MEETS NATO CHIEF RUTTE IN FLORIDA",
      "TSA: 17.6M THANKSGIVING FLYERS",
    ],
  },
  {
    name: "SPORT & CULTURE",
    color: TEAL,
    items: [
      "MISS UNIVERSE: PUERTO RICO WINS CROWN",
      "PASSENGER OVERBOARD OFF BAHAMAS",
      "TENNESSEE JUMPS TO NO. 5 IN CFP POLL",
      "NEBRASKA VOLLEYBALL INTO BIG TEN FINAL",
      "FRENCH MAYORS WARN OF VOTER ANGER",
      "ISRAEL LEFT SUSPENDS COALITION TALKS",
    ],
  },
];

// ---- hero illustrations (procedural, drawn inside the art band) ----

// 1. The breach: a dark network of nodes and links, one node cracked red.
function artBreach(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, INK2, INK);
  const rnd = mulberry32(2501);
  const nodes: [number, number][] = [];
  for (let i = 0; i < 16; i++) {
    nodes.push([x + 14 + rnd() * (w - 28), y + 8 + rnd() * (h - 16)]);
  }
  // links
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const [ax, ay] = nodes[i];
      const [bx, by] = nodes[j];
      const d = Math.hypot(ax - bx, ay - by);
      if (d < 110) line(Math.round(ax), Math.round(ay), Math.round(bx), Math.round(by), [58, 84, 130], 1);
    }
  }
  // nodes
  for (let i = 0; i < nodes.length; i++) {
    const [nx, ny] = nodes[i];
    fillCircle(Math.round(nx), Math.round(ny), 3, TEAL);
    fillCircle(Math.round(nx), Math.round(ny), 1, WHITE);
  }
  // the breached node, front and centre-right, cracked open in red
  const bx = x + Math.round(w * 0.68);
  const by = y + Math.round(h * 0.45);
  line(bx - 26, by - 18, bx + 24, by + 16, RED, 2);
  line(bx - 24, by + 16, bx + 22, by - 14, RED, 2);
  line(bx - 30, by, bx + 28, by + 2, RED2, 2);
  fillCircle(bx, by, 10, RED);
  fillCircle(bx, by, 6, [255, 120, 110]);
  fillCircle(bx, by, 2, WHITE);
  // radiating alarm ticks
  for (let a = 0; a < 8; a++) {
    const ang = (a * Math.PI) / 4 + 0.3;
    line(
      bx + Math.round(Math.cos(ang) * 14), by + Math.round(Math.sin(ang) * 14),
      bx + Math.round(Math.cos(ang) * 20), by + Math.round(Math.sin(ang) * 20),
      GOLD, 2,
    );
  }
  drawText(x + 10, y + h - 18, "OSINT", 1, [150, 180, 210]);
  drawTextRight(x + w - 10, y + h - 18, "CLASSIFIED: SAFE", 1, [150, 180, 210]);
}

// 2. The tower: dusk skyline, one tall tower glowing red at its crown.
function artTower(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, DUSK1, DUSK2);
  // low sun
  fillCircle(x + Math.round(w * 0.16), y + Math.round(h * 0.34), 9, GOLD);
  fillCircle(x + Math.round(w * 0.16), y + Math.round(h * 0.34), 13, [240, 190, 110]);
  // far skyline
  const rnd = mulberry32(2502);
  let bx = x;
  while (bx < x + w) {
    const bw = 18 + rnd() * 30;
    const bh = 8 + rnd() * 18;
    fillRect(Math.round(bx), y + h - Math.round(bh) - 14, Math.round(bw), Math.round(bh) + 14, [52, 30, 58]);
    bx += bw + 4;
  }
  // the PIF tower, centre-left, tallest, with a glowing crown
  const tx = x + Math.round(w * 0.58);
  const tw = 34;
  const th = h - 12;
  fillRect(tx, y + h - th, tw, th, INK);
  fillRect(tx + 4, y + h - th, tw - 8, 6, [40, 62, 110]);
  // lit windows
  for (let wy = y + h - th + 12; wy < y + h - 8; wy += 9) {
    for (let wx = tx + 6; wx < tx + tw - 6; wx += 9) {
      if (rnd() > 0.45) fillRect(wx, wy, 3, 4, GOLD);
    }
  }
  // red impact glow at the crown
  fillCircle(tx + tw / 2, y + h - th + 4, 12, RED);
  fillCircle(tx + tw / 2, y + h - th + 4, 6, [255, 150, 130]);
  // smoke wisps
  const rnd2 = mulberry32(2503);
  for (let i = 0; i < 14; i++) {
    const sx = tx + tw / 2 + (rnd2() - 0.5) * 44;
    const sy = y + 4 + rnd2() * 16;
    fillCircle(Math.round(sx), Math.round(sy), 3 + Math.round(rnd2() * 3), [210, 200, 185]);
  }
  // ground line
  fillRect(x, y + h - 3, w, 3, INK);
  drawText(x + 10, y + 6, "RIYADH", 1, WHITE);
  drawTextRight(x + w - 10, y + 6, "11 WOUNDED", 1, WHITE);
}

// 3. The verdict: scales of justice and a gavel on cream.
function artVerdict(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, PANEL, PAPER2);
  const cx = x + Math.round(w * 0.5);
  const top = y + 8;
  const base = y + h - 10;
  // post + finial
  fillRect(cx - 2, top + 6, 5, base - top - 6, INK);
  fillCircle(cx, top + 3, 4, GOLD);
  // beam
  fillRect(cx - 58, top + 10, 116, 4, INK);
  // left pan (heavier, tipped down) and right pan
  const ly = top + 16;
  const ry = top + 12;
  line(cx - 56, top + 12, cx - 78, ly + 12, INK, 2);
  line(cx - 56, top + 12, cx - 34, ly + 12, INK, 2);
  line(cx + 56, top + 12, cx + 78, ry + 12, INK, 2);
  line(cx + 56, top + 12, cx + 34, ry + 12, INK, 2);
  fillTriangle(cx - 80, ly + 12, cx - 32, ly + 12, cx - 56, ly + 24, RED);
  fillTriangle(cx + 32, ry + 12, cx + 80, ry + 12, cx + 56, ry + 24, TEAL);
  // base
  fillRect(cx - 26, base - 4, 52, 4, INK);
  // gavel at right, angled
  const gx = x + w - 66;
  const gy = y + h - 34;
  line(gx, gy, gx + 34, gy - 16, [120, 84, 40], 4);
  fillRect(gx + 30, gy - 24, 16, 10, [120, 84, 40]);
  fillRect(gx + 28, gy - 26, 20, 2, GOLD);
  // "10 OF 12" tally ticks at left
  for (let i = 0; i < 10; i++) {
    line(x + 12 + i * 7, y + 14, x + 16 + i * 7, y + 30, RED, 2);
  }
  line(x + 12 + 10 * 7, y + 14, x + 16 + 10 * 7, y + 30, GRAY, 2);
  line(x + 12 + 11 * 7, y + 14, x + 16 + 11 * 7, y + 30, GRAY, 2);
  drawText(x + 10, y + h - 18, "10 OF 12 COUNTS", 1, RED);
}

// 4. The trial: a courthouse colonnade under a pediment, on navy.
function artTrial(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, INK2, INK);
  // pediment
  fillTriangle(x + 30, y + 22, x + w - 30, y + 22, x + Math.round(w / 2), y + 4, PAPER);
  fillCircle(x + Math.round(w / 2), y + 14, 4, RED);
  // entablature
  fillRect(x + 24, y + 22, w - 48, 5, PAPER);
  // columns
  const n = 5;
  const gap = (w - 48) / n;
  for (let i = 0; i < n; i++) {
    const cx = x + 24 + Math.round(gap * i + gap / 2);
    fillRect(cx - 7, y + 28, 14, h - 40, PAPER);
    fillRect(cx - 10, y + 28, 20, 3, GOLD);
    fillRect(cx - 10, y + h - 15, 20, 3, GOLD);
    vline(cx - 2, y + 32, h - 48, PAPER2);
  }
  // steps
  fillRect(x + 16, y + h - 12, w - 32, 3, PAPER);
  fillRect(x + 8, y + h - 8, w - 16, 3, PAPER2);
  fillRect(x, y + h - 4, w, 4, PAPER);
  // dusk sky dots (stars) above the pediment
  const rnd = mulberry32(2504);
  for (let i = 0; i < 12; i++) {
    fillRect(x + 8 + Math.round(rnd() * (w - 16)), y + 2 + Math.round(rnd() * 8), 2, 2, GOLD);
  }
  drawText(x + 10, y + h - 18, "PARIS", 1, [170, 190, 220]);
  drawTextRight(x + w - 10, y + h - 18, "TRIAL 2027", 1, [170, 190, 220]);
}

function drawHeroArt(kind: number, x: number, y: number, w: number, h: number): void {
  if (kind === 1) artBreach(x, y, w, h);
  else if (kind === 2) artTower(x, y, w, h);
  else if (kind === 3) artVerdict(x, y, w, h);
  else artTrial(x, y, w, h);
}

// ---- page layout ----

function drawBackground(): void {
  vgrad(0, 0, W, H, PAPER, PAPER2);
  // paper grain: deterministic per-pixel noise over the whole sheet
  const rnd = mulberry32(20261125);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const n = Math.round((rnd() - 0.5) * 11);
      img[i] = Math.max(0, Math.min(255, img[i] + n));
      img[i + 1] = Math.max(0, Math.min(255, img[i + 1] + n));
      img[i + 2] = Math.max(0, Math.min(255, img[i + 2] + n));
    }
  }
  // outer frame
  rect(8, 8, 1008, 1008, INK, 3);
  rect(14, 14, 996, 996, [120, 110, 88], 1);
}

function drawGlobe(cx: number, cy: number, r: number): void {
  circle(cx, cy, r, INK, 2);
  fillCircle(cx, cy, r - 2, TEAL);
  // latitude bands
  for (let k = -2; k <= 2; k++) {
    const yy = cy + k * Math.round(r / 3);
    const half = Math.floor(Math.sqrt(Math.max(0, (r - 2) * (r - 2) - (yy - cy) * (yy - cy))));
    if (half > 0) fillRect(cx - half, yy, half * 2, 1, [200, 225, 220]);
  }
  // meridian ellipses (approximated with vertical chords)
  for (const off of [-Math.round(r / 2), 0, Math.round(r / 2)]) {
    for (let yy = cy - r + 3; yy <= cy + r - 3; yy++) {
      const dy = yy - cy;
      const half = Math.floor(Math.sqrt(Math.max(0, (r - 2) * (r - 2) - dy * dy)));
      const xx = cx + Math.round((off * half) / Math.max(1, r - 2));
      setPx(xx, yy, [200, 225, 220]);
    }
  }
  // land blobs
  fillCircle(cx - 7, cy - 8, 5, GOLD);
  fillCircle(cx + 8, cy + 6, 6, GOLD);
  fillCircle(cx + 2, cy - 12, 3, GOLD);
}

function drawMasthead(): void {
  // red + teal top strips
  fillRect(24, 16, 976, 4, RED);
  fillRect(24, 20, 976, 1, TEAL);
  // halftone texture across the masthead
  halftone(24, 24, 976, 88, [232, 222, 192], 14, 1);
  // globe ornament left of the title
  drawGlobe(86, 56, 26);
  drawTextCentered(512, 26, "THE WORLD TODAY", 8, INK);
  drawTextCentered(512, 90, "WEDNESDAY, 25 NOVEMBER 2026", 3, RED);
  drawText(24, 94, "VOL. I - NO. 329", 2, GRAY);
  drawTextRight(1000, 94, "ONE DAY - ONE PAGE", 2, GRAY);
  // double rule under the masthead
  hline(24, 118, 976, INK);
  fillRect(24, 121, 976, 1, INK);
  hline(24, 124, 976, INK);
}

function drawHero(h: Hero, idx: number, x: number, y: number): void {
  const w = 472;
  const hh = 200;
  fillRect(x, y, w, hh, PANEL);
  rect(x, y, w, hh, INK, 2);
  // kicker band
  fillRect(x + 2, y + 2, w - 4, 26, h.accent);
  drawText(x + 14, y + 8, h.kicker, 2, WHITE);
  drawTextRight(x + w - 14, y + 8, "LEAD " + (idx + 1), 2, WHITE);
  // headline
  if (h.lines.length === 1) {
    drawText(x + 14, y + 50, h.lines[0], 4, INK);
  } else {
    drawText(x + 14, y + 36, h.lines[0], 4, INK);
    drawText(x + 14, y + 66, h.lines[1], 4, INK);
  }
  // standfirst
  drawText(x + 14, y + 100, h.stand[0], 2, GRAY);
  drawText(x + 14, y + 116, h.stand[1], 2, GRAY);
  // illustration band
  hline(x + 2, y + 131, w - 4, INK);
  drawHeroArt(h.art, x + 2, y + 132, w - 4, 66);
}

function drawBriefsHeader(): void {
  fillRect(24, 548, 976, 26, INK);
  drawText(38, 553, "THE DAY IN BRIEF", 3, WHITE);
  drawTextRight(986, 556, "42 MORE STORIES", 2, WHITE);
  // red underline
  fillRect(24, 574, 976, 3, RED);
}

function drawBriefColumn(groups: BriefGroup[], x: number, y0: number): number {
  let y = y0;
  for (const g of groups) {
    fillRect(x, y, 472, 16, g.color);
    drawText(x + 8, y + 1, g.name, 2, WHITE);
    y += 16;
    for (const item of g.items) {
      bullet(x + 2, y + 5, RED);
      drawText(x + 12, y, item, 2, INK);
      y += 17;
    }
  }
  return y;
}

function drawFooter(): void {
  hline(24, 991, 976, RED);
  drawTextCentered(
    512,
    997,
    "SOURCES: NYT - CNN - REUTERS - AP - AFP - FT - FRANCE 24 - ALL STORIES REPORTED 24-25 NOV 2026",
    1,
    GRAY,
  );
}

function countStories(): number {
  let n = HEROES.length;
  for (const g of BRIEF_GROUPS) n += g.items.length;
  return n;
}

function main(): void {
  drawBackground();
  drawMasthead();
  // 2x2 hero grid
  const heroPos: [number, number][] = [
    [24, 132],
    [528, 132],
    [24, 340],
    [528, 340],
  ];
  for (let i = 0; i < HEROES.length; i++) {
    drawHero(HEROES[i], i, heroPos[i][0], heroPos[i][1]);
  }
  drawBriefsHeader();
  // column 1: WORLD + MARKETS (22 briefs); column 2: rest (20 briefs)
  drawBriefColumn([BRIEF_GROUPS[0], BRIEF_GROUPS[1]], 24, 582);
  drawBriefColumn([BRIEF_GROUPS[2], BRIEF_GROUPS[3], BRIEF_GROUPS[4]], 528, 582);
  drawFooter();

  const png = encodePNG(img, W, H);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "entry.png");
  fs.writeFileSync(outPath, png);
  const sha = crypto.createHash("sha256").update(png).digest("hex");
  console.log(`wrote ${outPath} (${png.length} bytes, sha256 ${sha})`);
  console.log(`stories: ${countStories()} (4 heroes + ${countStories() - 4} briefs)`);
}

main();
