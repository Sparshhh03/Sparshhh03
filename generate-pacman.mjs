// generate-pacman.mjs
// Builds one animated SVG: a single white 2D Pac-Man glides through your
// GitHub contribution graph. Squares change colour when eaten, and the loop
// resets with a soft fade (no abrupt ending).
//
// Usage:
//   GITHUB_USER=you GITHUB_TOKEN=xxx node generate-pacman.mjs
//   node generate-pacman.mjs --demo        (random data, no token needed)

import { mkdirSync, writeFileSync } from 'node:fs';

// ---------- easy-to-edit settings ----------
const SETTINGS = {
  cell: 14,            // square size (px)
  gap: 3,              // space between squares
  pad: 22,             // padding inside the card
  secondsPerCell: 0.09,// Pac-Man speed (higher = slower)
  lead: 1.2,           // seconds before he starts moving (fade-in)
  tail: 2.6,           // seconds after he finishes (fade-out + reset)
  chompSeconds: 0.38,  // mouth open/close cycle
  mouthOpenDeg: 38,
  mouthShutDeg: 3,
  pacman: '#ffffff',   // Pac-Man colour
  card: '#0d1117',     // card background
  border: '#30363d',   // card border
  empty: '#161b22',    // squares with no contributions
  levels: ['#0c2d6b', '#1158c7', '#388bfd', '#79c0ff'], // low -> high
  eaten: '#30363d',    // colour a square turns after it is eaten
};
// -------------------------------------------

const USER = process.env.GITHUB_USER;
const TOKEN = process.env.GITHUB_TOKEN;
const OUT_DIR = process.env.OUT_DIR || 'dist';
const DEMO = process.argv.includes('--demo');

const LEVEL = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

async function fetchGrid() {
  if (DEMO) {
    return Array.from({ length: 53 }, () =>
      Array.from({ length: 7 }, () => (Math.random() < 0.55 ? Math.ceil(Math.random() * 4) : 0))
    );
  }
  if (!USER || !TOKEN) throw new Error('Set GITHUB_USER and GITHUB_TOKEN (or use --demo).');

  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{weeks{contributionDays{weekday contributionLevel}}}}}}`;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'pacman-contribution-graph',
    },
    body: JSON.stringify({ query, variables: { login: USER } }),
  });
  const json = await res.json();
  if (json.errors || !json.data || !json.data.user) {
    throw new Error('GitHub API error: ' + JSON.stringify(json.errors || json));
  }
  const weeks = json.data.user.contributionsCollection.contributionCalendar.weeks;
  return weeks.map((week) => {
    const col = Array(7).fill(0);
    for (const d of week.contributionDays) col[d.weekday] = LEVEL[d.contributionLevel] || 0;
    return col;
  });
}

const f = (n) => Number(n.toFixed(3));

function build(grid) {
  const { cell, gap, pad } = SETTINGS;
  const step = cell + gap;
  const cols = grid.length;
  const W = pad * 2 + cols * step - gap;
  const H = pad * 2 + 7 * step - gap;
  const center = (c, r) => [pad + c * step + cell / 2, pad + r * step + cell / 2];

  // Serpentine route: down column 0, up column 1, down column 2, ...
  const route = [];
  for (let c = 0; c < cols; c++) {
    const rows = c % 2 === 0 ? [0, 1, 2, 3, 4, 5, 6] : [6, 5, 4, 3, 2, 1, 0];
    for (const r of rows) route.push([c, r]);
  }
  const N = route.length;

  // Path: keep only the corner points so rotation is clean
  const pts = route.map(([c, r]) => center(c, r));
  const corners = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const [cx, cy] = pts[i + 1];
    if ((bx - ax) * (cy - by) - (by - ay) * (cx - bx) !== 0) corners.push(pts[i]);
  }
  corners.push(pts[pts.length - 1]);
  const pathD = 'M' + corners.map(([x, y]) => `${f(x)},${f(y)}`).join(' L');

  const move = N * SETTINGS.secondsPerCell;
  const D = SETTINGS.lead + move + SETTINGS.tail;
  const dur = `${f(D)}s`;
  const kt = (t) => f(t / D);

  // Squares
  let rects = '';
  route.forEach(([c, r], k) => {
    const level = grid[c][r];
    const x = pad + c * step;
    const y = pad + r * step;
    const base = level === 0 ? SETTINGS.empty : SETTINGS.levels[Math.min(level, 4) - 1];
    if (level === 0) {
      rects += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${base}"/>`;
      return;
    }
    const tEat = SETTINGS.lead + (k / (N - 1)) * move - 0.05;
    const tDone = tEat + 0.3;
    const tBack = SETTINGS.lead + move + SETTINGS.tail * 0.45; // start fading back in
    rects +=
      `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${base}">` +
      `<animate attributeName="fill" dur="${dur}" repeatCount="indefinite" calcMode="linear" ` +
      `values="${base};${base};${SETTINGS.eaten};${SETTINGS.eaten};${base}" ` +
      `keyTimes="0;${kt(tEat)};${kt(tDone)};${kt(tBack)};1"/></rect>`;
  });

  // Pac-Man (flat 2D wedge)
  const r = cell * 0.62;
  const wedge = (deg) => {
    const a = (deg * Math.PI) / 180;
    const x = f(r * Math.cos(a));
    const y = f(r * Math.sin(a));
    return `M0,0 L${x},${-y} A${f(r)},${f(r)} 0 1 0 ${x},${y} Z`;
  };
  const open = wedge(SETTINGS.mouthOpenDeg);
  const shut = wedge(SETTINGS.mouthShutDeg);

  const tMoveStart = SETTINGS.lead;
  const tMoveEnd = SETTINGS.lead + move;
  const tFadeOut = tMoveEnd + 0.8;

  const pacman =
    `<g opacity="0">` +
    `<animate attributeName="opacity" dur="${dur}" repeatCount="indefinite" calcMode="linear" ` +
    `values="0;1;1;0;0" keyTimes="0;${kt(tMoveStart)};${kt(tMoveEnd)};${kt(tFadeOut)};1"/>` +
    `<animateMotion dur="${dur}" repeatCount="indefinite" rotate="auto" calcMode="linear" ` +
    `keyPoints="0;0;1;1" keyTimes="0;${kt(tMoveStart)};${kt(tMoveEnd)};1" path="${pathD}"/>` +
    `<path d="${open}" fill="${SETTINGS.pacman}">` +
    `<animate attributeName="d" dur="${SETTINGS.chompSeconds}s" repeatCount="indefinite" ` +
    `values="${open};${shut};${open}"/></path></g>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ` +
    `role="img" aria-label="Pac-Man eating my GitHub contribution graph">` +
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="${SETTINGS.card}" stroke="${SETTINGS.border}"/>` +
    rects +
    pacman +
    `</svg>`
  );
}

const grid = await fetchGrid();
mkdirSync(OUT_DIR, { recursive: true });
const svg = build(grid);
writeFileSync(`${OUT_DIR}/pacman.svg`, svg);
console.log(`Wrote ${OUT_DIR}/pacman.svg (${(svg.length / 1024).toFixed(1)} KB, ${grid.length} weeks)`);
