/**
 * Reseed cemetery data for a tenant database (cemetery_* tables).
 *
 * Usage:
 *   DB_HOST=192.168.1.241 DB_USER=orthodoxapps DB_PASSWORD=... \
 *     node server/scripts/cemetery-reseed.mjs om_church_46
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mysql from 'mysql2/promise';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = join(__dirname, '../../../server');
const REPO_ROOT = join(__dirname, '../../..');
const data = JSON.parse(readFileSync(join(__dirname, 'cemetery-seed-data.json'), 'utf8'));

const dbName = process.argv[2] || process.env.CEMETERY_DB || 'om_church_46';
const host = process.env.DB_HOST || '127.0.0.1';
const port = Number(process.env.DB_PORT || 3306);
const user = process.env.DB_USER || 'orthodoxapps';
const password = process.env.DB_PASSWORD || '';

const ROAD_HALF = 3.2;
const GRAVE_GAP = 2.6;
const ROUNDABOUT = { x: 42, y: 72, r: 13 };
const ROUNDABOUT_CLEAR = { x: 42, y: 72, r: 16 };

const SPINE_PTS = [
  [42, 85],
  [45, 96],
  [47, 122],
  [49, 150],
  [50, 176],
  [52, 190],
];

function spineCenterXAt(y) {
  if (y <= SPINE_PTS[0][1]) return SPINE_PTS[0][0];
  if (y >= SPINE_PTS[SPINE_PTS.length - 1][1]) return SPINE_PTS[SPINE_PTS.length - 1][0];
  for (let i = 1; i < SPINE_PTS.length; i++) {
    if (y <= SPINE_PTS[i][1]) {
      const [ax, ay] = SPINE_PTS[i - 1];
      const [bx, by] = SPINE_PTS[i];
      const t = (y - ay) / (by - ay);
      return ax + (bx - ax) * t;
    }
  }
  return SPINE_PTS[SPINE_PTS.length - 1][0];
}

const PLOT_W = 3.0;
const PLOT_H = 2.6;
const COL_STEP = 4.0;
const ROW_STEP = 4.4;
const FIELD_Y_TOP = 58;
const FIELD_Y_BOTTOM = 184;
const MAX_COLS_PER_ROW = 5;
const LEFT_EDGE = 5;
const RIGHT_EDGE = 95;

function innerEdgeAt(y, side) {
  const dyc = Math.abs(y - ROUNDABOUT.y);
  if (dyc < ROUNDABOUT_CLEAR.r) {
    const halfChord = Math.sqrt(Math.max(0, ROUNDABOUT_CLEAR.r * ROUNDABOUT_CLEAR.r - dyc * dyc));
    return ROUNDABOUT.x + side * (halfChord + GRAVE_GAP);
  }
  const cx = spineCenterXAt(y);
  return cx + side * (ROAD_HALF + GRAVE_GAP);
}

const REMAP = { W: 'L', E: 'R', S: 'R', N: 'N' };
const NEW_SECTIONS = {
  L: ['L', 'Left Lawn'],
  R: ['R', 'Right Lawn'],
  N: ['N', 'Section N (New Grid)'],
};

const SECTION_BANDS = {
  L: { side: -1 },
  R: { side: +1 },
  N: { side: +1, yTop: 37, cols: 12, fixedInnerX: 57, colStep: 3.2, rowStep: 3.4 },
};

const FIELD_ROWS = Math.floor((FIELD_Y_BOTTOM - FIELD_Y_TOP) / ROW_STEP) + 1;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function fieldCells(side, count) {
  const cells = [];
  const ROW_CEIL = FIELD_ROWS + 8;
  for (let r = 0; r < ROW_CEIL && cells.length < count; r++) {
    const y = FIELD_Y_TOP + r * ROW_STEP;
    const inner = innerEdgeAt(y, side);
    const outer = side < 0 ? LEFT_EDGE : RIGHT_EDGE;
    const usable = (outer - inner) * side;
    const fit = Math.max(0, Math.floor((usable - PLOT_W) / COL_STEP) + 1);
    const cols = Math.min(MAX_COLS_PER_ROW, fit);
    for (let col = 0; col < cols && cells.length < count; col++) {
      const x = inner + side * (col * COL_STEP) + side * (PLOT_W / 2);
      cells.push({ x: round2(x), y: round2(y), w: PLOT_W, h: PLOT_H });
    }
  }
  return cells;
}

function placeAll(section, count) {
  const band = SECTION_BANDS[section];
  if (band.fixedInnerX != null) {
    const cells = [];
    const cStep = band.colStep ?? COL_STEP;
    const rStep = band.rowStep ?? ROW_STEP;
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / band.cols);
      const col = i % band.cols;
      const y = band.yTop + row * rStep;
      const x = band.fixedInnerX + col * cStep + PLOT_W / 2;
      cells.push({ x: round2(x), y: round2(y), w: PLOT_W, h: PLOT_H });
    }
    return cells;
  }
  return fieldCells(band.side, count);
}

const TABLES = [
  'cemetery_interments',
  'cemetery_relationships',
  'cemetery_maintenance_tasks',
  'cemetery_path_edges',
  'cemetery_path_nodes',
  'cemetery_plots',
  'cemetery_rows',
  'cemetery_people',
  'cemetery_sections',
];

const conn = await mysql.createConnection({ host, port, user, password, database: dbName });
console.log('connected to', dbName);

async function run() {
  await conn.query('SET FOREIGN_KEY_CHECKS=0');
  for (const t of TABLES) {
    await conn.query(`DELETE FROM \`${t}\``);
    await conn.query(`ALTER TABLE \`${t}\` AUTO_INCREMENT = 1`);
  }
  await conn.query('SET FOREIGN_KEY_CHECKS=1');
  console.log('cleared cemetery tables');

  const byCode = { L: [], R: [], N: [] };
  for (const p of data.plots) {
    const nc = REMAP[p.section];
    byCode[nc].push(p);
  }

  const sectionId = {};
  const placedCoords = {};
  for (const code of Object.keys(NEW_SECTIONS)) {
    const list = byCode[code] || [];
    const coords = placeAll(code, list.length);
    placedCoords[code] = coords;
    const cx = coords.length ? coords.reduce((s, c) => s + c.x, 0) / coords.length : 50;
    const cy = coords.length ? coords.reduce((s, c) => s + c.y, 0) / coords.length : 100;
    const [, name] = NEW_SECTIONS[code];
    const [res] = await conn.query(
      'INSERT INTO cemetery_sections (code, name, description, center_x, center_y) VALUES (?,?,?,?,?)',
      [code, name, `${list.length} plots`, round2(cx), round2(cy)],
    );
    sectionId[code] = res.insertId;
  }
  console.log('inserted sections', sectionId);

  let peopleCount = 0;
  let intermentCount = 0;
  for (const code of Object.keys(byCode)) {
    const list = byCode[code];
    const coords = placedCoords[code];
    const secId = sectionId[code];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const c = coords[i];
      const [pr] = await conn.query(
        'INSERT INTO cemetery_plots (section_id, plot_number, status, map_x, map_y, map_w, map_h, map_page, notes) VALUES (?,?,?,?,?,?,?,?,?)',
        [secId, p.plot_number || `${code}-${i + 1}`, p.status, c.x, c.y, c.w, c.h, p.page,
          p.surname ? `${p.surname} family plot` : null],
      );
      const plotId = pr.insertId;

      const surname = p.surname || (p.given_names.length ? '' : 'Unknown');
      const names = p.given_names.length ? p.given_names : [];
      for (let j = 0; j < names.length; j++) {
        const given = names[j];
        const last = surname || given.split(' ').slice(-1)[0];
        const first = surname ? given : given.split(' ').slice(0, -1).join(' ') || given;
        const gi = data.plots.indexOf(p);
        const birthYear = 1890 + ((gi * 7 + j * 13) % 80);
        const deathYear = birthYear + 50 + ((gi + j) % 35);
        const [per] = await conn.query(
          'INSERT INTO cemetery_people (first_name, last_name, birth_date, death_date) VALUES (?,?,?,?)',
          [first || given, last || 'Unknown', `${birthYear}-01-01`, `${deathYear}-06-15`],
        );
        peopleCount++;
        await conn.query(
          'INSERT INTO cemetery_interments (plot_id, person_id, burial_date, interment_type) VALUES (?,?,?,?)',
          [plotId, per.insertId, `${deathYear}-06-20`, 'burial'],
        );
        intermentCount++;
      }
    }
  }
  console.log('inserted plots:', data.plots.length, 'people:', peopleCount, 'interments:', intermentCount);

  const petSectionId = sectionId.R;
  const petY = 120;
  const petInner = spineCenterXAt(petY) + (ROAD_HALF + GRAVE_GAP) + PLOT_W / 2;
  const petX = round2(petInner + MAX_COLS_PER_ROW * COL_STEP);
  const [petPlot] = await conn.query(
    'INSERT INTO cemetery_plots (section_id, plot_number, status, map_x, map_y, map_w, map_h, map_page, notes) VALUES (?,?,?,?,?,?,?,?,?)',
    [petSectionId, 'B-12-24', 'occupied', petX, petY, 3.4, 3.0, 'pg1', 'Petrovski family plot (demo)'],
  );
  const petPlotId = petPlot.insertId;
  for (const [f, l, b, dd] of [
    ['Michael', 'Petrovski', '1942-03-10', '2018-05-16'],
    ['Helen', 'Petrovski', '1945-08-22', '2021-11-03'],
  ]) {
    const [per] = await conn.query(
      'INSERT INTO cemetery_people (first_name, last_name, birth_date, death_date) VALUES (?,?,?,?)',
      [f, l, b, dd],
    );
    await conn.query(
      'INSERT INTO cemetery_interments (plot_id, person_id, burial_date, interment_type) VALUES (?,?,?,?)',
      [petPlotId, per.insertId, dd, 'burial'],
    );
    peopleCount++;
    intermentCount++;
  }
  console.log('inserted Petrovski demo family');

  const nodes = [
    ['Main Entrance', 52, 190, 1],
    ['Welcome Drive', 50, 176, 0],
    ['Lower Road', 49, 150, 0],
    ['Mid Road', 47, 122, 0],
    ['Circle Approach', 45, 96, 0],
    ['Circle South', 42, 85, 0],
    ['Circle East', 55, 72, 0],
    ['Circle North', 42, 59, 0],
    ['Circle West', 29, 72, 0],
    ['Upper Road', 36, 48, 0],
    ['White Gate', 33, 33, 1],
  ];
  const nodeId = {};
  for (const [label, x, y, ent] of nodes) {
    const [r] = await conn.query(
      'INSERT INTO cemetery_path_nodes (label, map_x, map_y, is_entrance) VALUES (?,?,?,?)',
      [label, x, y, ent],
    );
    nodeId[label] = r.insertId;
  }
  const dist = (a, b) => {
    const A = nodes.find((n) => n[0] === a);
    const B = nodes.find((n) => n[0] === b);
    const dx = A[1] - B[1];
    const dy = A[2] - B[2];
    return Math.round(Math.sqrt(dx * dx + dy * dy) * 7);
  };
  const edges = [
    ['Main Entrance', 'Welcome Drive'],
    ['Welcome Drive', 'Lower Road'],
    ['Lower Road', 'Mid Road'],
    ['Mid Road', 'Circle Approach'],
    ['Circle Approach', 'Circle South'],
    ['Circle South', 'Circle East'],
    ['Circle East', 'Circle North'],
    ['Circle North', 'Circle West'],
    ['Circle West', 'Circle South'],
    ['Circle North', 'Upper Road'],
    ['Upper Road', 'White Gate'],
  ];
  for (const [a, b] of edges) {
    await conn.query(
      'INSERT INTO cemetery_path_edges (from_node_id, to_node_id, distance_ft) VALUES (?,?,?)',
      [nodeId[a], nodeId[b], dist(a, b)],
    );
  }

  const tasks = [
    ['Reset leaning headstone', 'Headstone tilted after frost heave; needs releveling.', 'open'],
    ['Trim overgrowth near memorial', 'Shrubs encroaching on plot markers.', 'in_progress'],
    ['Repair gravel on main drive', 'Washout along the central road after heavy rain.', 'open'],
    ['Replace faded section marker', 'Section sign weathered and unreadable.', 'open'],
    ['Reseed bare lawn area', 'Patchy turf near the circle.', 'done'],
    ['Service storage shed', 'Inspect roof and clear debris around the storage shed.', 'open'],
  ];
  const [someSec] = await conn.query('SELECT id, code FROM cemetery_sections');
  for (let i = 0; i < tasks.length; i++) {
    const sec = someSec[i % someSec.length];
    await conn.query(
      'INSERT INTO cemetery_maintenance_tasks (section_id, title, description, status) VALUES (?,?,?,?)',
      [sec.id, tasks[i][0], tasks[i][1], tasks[i][2]],
    );
  }

  const [[pc]] = await conn.query('SELECT COUNT(*) AS c FROM cemetery_plots');
  const [[pp]] = await conn.query('SELECT COUNT(*) AS c FROM cemetery_people');
  console.log('DONE. plots=', pc.c, 'people=', pp.c);
}

try {
  await run();
} catch (e) {
  console.error('SEED ERROR', e);
  process.exitCode = 1;
} finally {
  await conn.end();
}
