/**
 * Walking directions from Main Entrance to a cemetery plot (Dijkstra on path graph).
 */

const WALK_FT_PER_MIN = 250;

function mapDist(a, b) {
  const dx = a.mapX - b.mapX;
  const dy = a.mapY - b.mapY;
  return Math.sqrt(dx * dx + dy * dy) * 6;
}

async function getPathGraph(pool) {
  const [nodes] = await pool.query(
    'SELECT id, label, map_x AS mapX, map_y AS mapY, is_entrance AS isEntrance FROM cemetery_path_nodes',
  );
  const [edges] = await pool.query(
    'SELECT id, from_node_id AS fromNodeId, to_node_id AS toNodeId, distance_ft AS distanceFt FROM cemetery_path_edges',
  );
  return { nodes, edges };
}

async function getPlotForDirections(pool, plotId) {
  const [rows] = await pool.query(
    `SELECT p.id, p.plot_number AS plotNumber, p.map_x AS mapX, p.map_y AS mapY,
            s.code AS sectionCode, r.number AS rowNo
       FROM cemetery_plots p
       JOIN cemetery_sections s ON s.id = p.section_id
       LEFT JOIN cemetery_rows r ON r.id = p.row_id
      WHERE p.id = ?
      LIMIT 1`,
    [plotId],
  );
  return rows[0] ?? null;
}

async function computeDirections(pool, plotId) {
  const plot = await getPlotForDirections(pool, plotId);
  if (!plot) return null;

  const { nodes, edges } = await getPathGraph(pool);
  if (!nodes.length) return null;

  const entrance = nodes.find((n) => n.isEntrance === 1) ?? nodes[0];

  let target = nodes[0];
  let best = Infinity;
  for (const n of nodes) {
    const d = mapDist(n, plot);
    if (d < best) {
      best = d;
      target = n;
    }
  }

  const adj = new Map();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    adj.get(e.fromNodeId)?.push({ to: e.toNodeId, w: e.distanceFt });
    adj.get(e.toNodeId)?.push({ to: e.fromNodeId, w: e.distanceFt });
  }

  const distMap = new Map();
  const prev = new Map();
  for (const n of nodes) {
    distMap.set(n.id, Infinity);
    prev.set(n.id, null);
  }
  distMap.set(entrance.id, 0);

  const visited = new Set();
  while (visited.size < nodes.length) {
    let u = null;
    let min = Infinity;
    for (const n of nodes) {
      const d = distMap.get(n.id) ?? Infinity;
      if (!visited.has(n.id) && d < min) {
        min = d;
        u = n.id;
      }
    }
    if (u === null) break;
    visited.add(u);
    for (const { to, w } of adj.get(u) ?? []) {
      const nd = (distMap.get(u) ?? Infinity) + w;
      if (nd < (distMap.get(to) ?? Infinity)) {
        distMap.set(to, nd);
        prev.set(to, u);
      }
    }
  }

  const pathIds = [];
  let cur = target.id;
  while (cur !== null) {
    pathIds.unshift(cur);
    cur = prev.get(cur) ?? null;
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const routeNodes = pathIds.map((id) => nodeById.get(id)).filter(Boolean);

  let graphDist = distMap.get(target.id);
  if (graphDist === undefined || graphDist === Infinity) graphDist = 0;
  const finalLeg = mapDist(target, plot);
  const totalFt = Math.round(graphDist + finalLeg);

  const steps = [];
  steps.push(`Start at the ${entrance.label}.`);
  for (let i = 1; i < routeNodes.length; i++) {
    const from = routeNodes[i - 1];
    const to = routeNodes[i];
    const edge = edges.find(
      (e) =>
        (e.fromNodeId === from.id && e.toNodeId === to.id)
        || (e.fromNodeId === to.id && e.toNodeId === from.id),
    );
    const segFt = edge ? Math.round(edge.distanceFt) : Math.round(mapDist(from, to));
    steps.push(`Walk ${segFt} ft to ${to.label}.`);
  }
  steps.push(
    `Continue ${Math.round(finalLeg)} ft to Plot ${plot.plotNumber} (Section ${plot.sectionCode}${
      plot.rowNo ? `, Row ${plot.rowNo}` : ''
    }).`,
  );

  const walkMinutes = Math.max(1, Math.round(totalFt / WALK_FT_PER_MIN));

  return {
    plot: {
      id: plot.id,
      plotNumber: plot.plotNumber,
      sectionCode: plot.sectionCode,
      rowNo: plot.rowNo,
      mapX: plot.mapX,
      mapY: plot.mapY,
    },
    totalDistanceFt: totalFt,
    estimatedMinutes: walkMinutes,
    steps,
    routePoints: [
      ...routeNodes.map((n) => ({ x: n.mapX, y: n.mapY, label: n.label })),
      { x: plot.mapX, y: plot.mapY, label: `Plot ${plot.plotNumber}` },
    ],
  };
}

module.exports = { computeDirections };
