// generate-pacman.mjs
// Builds one animated SVG: a single white 2D Pac-Man wanders randomly through
// your GitHub contribution graph. Squares turn grey when eaten, month labels
// sit on top, and the loop resets with a soft fade (no abrupt ending).
//
// Usage:
//   GITHUB_USER=you GITHUB_TOKEN=xxx node generate-pacman.mjs
//   node generate-pacman.mjs --demo        (random data, no token needed)

import { mkdirSync, writeFileSync } from 'node:fs';

// ---------- easy-to-edit settings ----------
const SETTINGS = {
  cell: 14,             // square size (px)
  gap: 3,               // space between squares
  pad: 22,              // padding inside the card
  labelH: 18,           // height reserved for month labels
  secondsPerCell: 0.075,// Pac-Man speed (higher = slower)
  lead: 1.2,            // seconds before he starts moving (fade-in)
  tail: 2.6,            // seconds after he finishes (fade-out + reset)
  chompSeconds: 0.38,   // mouth open/close cycle
  mouthOpenDeg: 38,
  mouthShutDeg: 3,
  minSteps: 160,        // he keeps wandering at least this many cells
  pacman: '#ffffff',    // Pac-Man colour
  card: '#0d1117',      // card background
  border: '#30363d',    // card border
  empty: '#161b22',     // squares with no contributions
  levels: ['#0e4429', '#006d32', '#26a641', '#39d353'], // low -> high (greens)
  eaten: '#30363d',     // colour a square turns after it is eaten
  monthText: '#8b949e', // month label colour
};
// -------------------------------------------

const USER = process.env.GITHUB_USER;
const TOKEN = process.env.GITHUB_TOKEN;
const OUT_DIR = process.env.OUT_DIR || 'dist';
const DEMO = process.argv.includes('--demo');

const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Returns { grid, firstDays }
//   grid[col][row] = level 0-4, or null where no day exists
//   firstDays[col] = "YYYY-MM-DD" of the first day of that week
async function fetchData() {
  if (DEMO) {
    const today = new Date();
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    start.setUTCDate(start.getUTCDate() - start.getUTCDay() - 52 * 7);
    const grid = [];
    const firstDays = [];
    for (let c = 0; c < 53; c++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + c * 7);
      firstDays.push(d.toISOString().slice(0, 10));
      grid.push(
        Array.from({ length: 7 }, (_, r) => {
          const day = new Date(d);
          day.setUTCDate(day.getUTCDate() + r);
          if (day > today) return null;
          return Math.random() < 0.55 ? Math.ceil(Math.random() * 4) : 0;
        })
      );
    }
    return { grid, firstDays };
  }

  if (!USER || !TOKEN) throw new Error('Set GITHUB_USER and GITHUB_TOKEN (or use --demo).');
  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{weeks{firstDay contributionDays{weekday contributionLevel}}}}}}`;
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
  const grid = weeks.map((week) => {
    const col = Array(7).fill(null);
    for (const d of week.contributionDays) col[d.weekday] = LEVEL[d.contributionLevel] || 0;
    return col;
  });
  return { grid, firstDays: weeks.map((w) => w.firstDay) };
}

// ---------- random route ----------
// Pac-Man wanders: he prefers unvisited squares (especially ones with
// contributions), turns at random moments, and when boxed in he heads to the
// nearest uneaten contribution. Every run produces a new route.
function planRoute(grid) {
  const cols = grid.length;
  const ok = (c, r) => c >= 0 && c < cols && r >= 0 && r < 7 && grid[c][r] !== null;
  const id = (c, r) => c * 7 + r;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  const cells = [];
  for (let c = 0; c < cols; c++) for (let r = 0; r < 7; r++) if (ok(c, r)) cells.push([c, r]);
  const targets = new Set(cells.filter(([c, r]) => grid[c][r] > 0).map(([c, r]) => id(c, r)));
  let remaining = targets.size;

  const visited = new Set();
  const route = [];
  const firstVisit = new Map();
  const visit = (c, r) => {
    route.push([c, r]);
    const k = id(c, r);
    if (!visited.has(k)) {
      visited.add(k);
      firstVisit.set(k, route.length - 1);
      if (targets.has(k)) remaining--;
    }
  };

  const bfsToTarget = (sc, sr) => {
    const prev = new Map([[id(sc, sr), null]]);
    const queue = [[sc, sr]];
    while (queue.length) {
      const [c, r] = queue.shift();
      if (targets.has(id(c, r)) && !visited.has(id(c, r))) {
        const path = [];
        let cur = [c, r];
        while (cur && !(cur[0] === sc && cur[1] === sr)) {
          path.unshift(cur);
          cur = prev.get(id(cur[0], cur[1]));
        }
        return path;
      }
      for (const [dx, dy] of DIRS) {
        const nc = c + dx, nr = r + dy;
        if (ok(nc, nr) && !prev.has(id(nc, nr))) {
          prev.set(id(nc, nr), [c, r]);
          queue.push([nc, nr]);
        }
      }
    }
    return [];
  };

  const start = cells[Math.floor(Math.random() * cells.length)];
  visit(start[0], start[1]);
  let dir = null;
  const MAX = 3000;

  while ((remaining > 0 || route.length < SETTINGS.minSteps) && route.length < MAX) {
    const [c, r] = route[route.length - 1];
    let opts = DIRS.filter(([dx, dy]) => ok(c + dx, r + dy));
    const noBack = dir ? opts.filter(([dx, dy]) => !(dx === -dir[0] && dy === -dir[1])) : opts;
    if (noBack.length) opts = noBack;

    const fresh = opts.filter(([dx, dy]) => !visited.has(id(c + dx, r + dy)));
    if (fresh.length === 0 && remaining > 0) {
      const path = bfsToTarget(c, r);
      if (!path.length) break;
      for (const [pc, pr] of path) visit(pc, pr);
      const n = route.length;
      dir = [route[n - 1][0] - route[n - 2][0], route[n - 1][1] - route[n - 2][1]];
      continue;
    }

    const weights = opts.map(([dx, dy]) => {
      const k = id(c + dx, r + dy);
      let w = 1;
      if (!visited.has(k)) w += targets.has(k) ? 7 : 2;
      if (dir && dx === dir[0] && dy === dir[1]) w *= 1.3;
      return w;
    });
    let pick = Math.random() * weights.reduce((a, b) => a + b, 0);
    let chosen = opts[opts.length - 1];
    for (let i = 0; i < opts.length; i++) {
      pick -= weights[i];
      if (pick <= 0) { chosen = opts[i]; break; }
    }
    dir = chosen;
    visit(c + chosen[0], r + chosen[1]);
  }
  return { route, firstVisit };
}

const f = (n) => Number(n.toFixed(3));

// Approximate length of a quadratic curve
function qLen(p0, c, p1) {
  let len = 0;
  let prev = p0;
  for (let i = 1; i <= 40; i++) {
    const t = i / 40;
    const x = (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0];
    const y = (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1];
    len += Math.hypot(x - prev[0], y - prev[1]);
    prev = [x, y];
  }
  return len;
}

function build({ grid, firstDays }) {
  const { cell, gap, pad, labelH } = SETTINGS;
  const step = cell + gap;
  const cols = grid.length;
  const top = pad + labelH;
  const W = pad * 2 + cols * step - gap;
  const H = top + 7 * step - gap + pad;
  const center = (c, r) => [pad + c * step + cell / 2, top + r * step + cell / 2];

  const { route, firstVisit } = planRoute(grid);
  const M = route.length;
  const pts = route.map(([c, r]) => center(c, r));
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

  // Smooth path: straight lines on straights, rounded curves at every turn.
  // nodeDist[i] = distance along the path when Pac-Man passes node i.
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  const nodeDist = new Array(M).fill(0);
  let s = 0;
  if (M > 1) {
    const m0 = mid(pts[0], pts[1]);
    d += ` L${f(m0[0])},${f(m0[1])}`;
    s = step / 2;
    for (let i = 1; i < M - 1; i++) {
      const a = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]];
      const b = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]];
      const mIn = mid(pts[i - 1], pts[i]);
      const mOut = mid(pts[i], pts[i + 1]);
      if (a[0] === b[0] && a[1] === b[1]) {
        d += ` L${f(mOut[0])},${f(mOut[1])}`;
        nodeDist[i] = s + step / 2;
        s += step;
      } else {
        d += ` Q${f(pts[i][0])},${f(pts[i][1])} ${f(mOut[0])},${f(mOut[1])}`;
        const len = qLen(mIn, pts[i], mOut);
        nodeDist[i] = s + len / 2;
        s += len;
      }
    }
    d += ` L${f(pts[M - 1][0])},${f(pts[M - 1][1])}`;
    s += step / 2;
    nodeDist[M - 1] = s;
  }
  const totalLen = Math.max(s, 1);
  const speed = step / SETTINGS.secondsPerCell; // px per second
  const move = totalLen / speed;
  const D = SETTINGS.lead + move + SETTINGS.tail;
  const dur = `${f(D)}s`;
  const kt = (t) => f(t / D);

  // Month labels (from the real dates in your graph)
  let labels = '';
  const marks = [];
  let lastMonth = -1;
  firstDays.forEach((day, c) => {
    const m = new Date(day + 'T00:00:00Z').getUTCMonth();
    if (m !== lastMonth) { marks.push([c, m]); lastMonth = m; }
  });
  if (marks.length > 1 && marks[1][0] - marks[0][0] < 3) marks.shift();
  for (const [c, m] of marks) {
    labels += `<text x="${pad + c * step}" y="${pad + 9}" fill="${SETTINGS.monthText}" font-size="10" ` +
      `font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">${MONTHS[m]}</text>`;
  }

  // Squares
  let rects = '';
  const tBack = SETTINGS.lead + move + SETTINGS.tail * 0.45;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < 7; r++) {
      const level = grid[c][r];
      if (level === null) continue;
      const x = pad + c * step;
      const y = top + r * step;
      const base = level === 0 ? SETTINGS.empty : SETTINGS.levels[Math.min(level, 4) - 1];
      if (level === 0) {
        rects += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${base}"/>`;
        continue;
      }
      const idx = firstVisit.get(c * 7 + r);
      if (idx === undefined) {
        rects += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${base}"/>`;
        continue;
      }
      const tEat = SETTINGS.lead + nodeDist[idx] / speed - 0.05;
      const tDone = tEat + 0.3;
      rects +=
        `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${base}">` +
        `<animate attributeName="fill" dur="${dur}" repeatCount="indefinite" calcMode="linear" ` +
        `values="${base};${base};${SETTINGS.eaten};${SETTINGS.eaten};${base}" ` +
        `keyTimes="0;${kt(tEat)};${kt(tDone)};${kt(tBack)};1"/></rect>`;
    }
  }

  // Pac-Man (flat 2D wedge)
  const rad = cell * 0.62;
  const wedge = (deg) => {
    const a = (deg * Math.PI) / 180;
    const x = f(rad * Math.cos(a));
    const y = f(rad * Math.sin(a));
    return `M0,0 L${x},${-y} A${f(rad)},${f(rad)} 0 1 0 ${x},${y} Z`;
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
    `keyPoints="0;0;1;1" keyTimes="0;${kt(tMoveStart)};${kt(tMoveEnd)};1" path="${d}"/>` +
    `<path d="${open}" fill="${SETTINGS.pacman}">` +
    `<animate attributeName="d" dur="${SETTINGS.chompSeconds}s" repeatCount="indefinite" ` +
    `values="${open};${shut};${open}"/></path></g>`;

  const info = { steps: M, seconds: D };
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ` +
    `role="img" aria-label="Pac-Man eating my GitHub contribution graph">` +
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="${SETTINGS.card}" stroke="${SETTINGS.border}"/>` +
    labels + rects + pacman +
    `</svg>`;
  return { svg, info };
}

const data = await fetchData();
mkdirSync(OUT_DIR, { recursive: true });
const { svg, info } = build(data);
writeFileSync(`${OUT_DIR}/pacman.svg`, svg);
console.log(`Wrote ${OUT_DIR}/pacman.svg (${(svg.length / 1024).toFixed(1)} KB, ${data.grid.length} weeks, ${info.steps} steps, ${info.seconds.toFixed(1)}s loop)`);
