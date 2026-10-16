/**
 * Probabilistic cross-record relationship matching.
 * Never presents matches as confirmed identity merges.
 */

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' & ')
    .replace(/[^a-z0-9\s&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameParts(primaryName) {
  const n = normalizeName(primaryName);
  const parts = n.split(' ').filter(Boolean);
  if (!parts.length) return { first: '', last: '' };
  if (parts.includes('&')) {
    // marriage couple — use first party
    const idx = parts.indexOf('&');
    const left = parts.slice(0, idx);
    return { first: left[0] || '', last: left[left.length - 1] || '' };
  }
  return { first: parts[0], last: parts[parts.length - 1] };
}

function scorePair(a, b) {
  const pa = nameParts(a.primaryName || a.primary_name);
  const pb = nameParts(b.primaryName || b.primary_name);
  if (!pa.last || !pb.last) return 0;
  if (pa.last !== pb.last) return 0;
  let score = 55;
  if (pa.first && pb.first && pa.first === pb.first) score += 35;
  else if (pa.first && pb.first && (pa.first.startsWith(pb.first[0]) || pb.first.startsWith(pa.first[0]))) score += 15;
  // date ordering bonus for baptism→marriage
  const da = a.canonicalEventDate || a.canonical_event_date;
  const db = b.canonicalEventDate || b.canonical_event_date;
  if (da && db && String(da) < String(db)) score += 5;
  return Math.min(99, score);
}

function labelForScore(score) {
  if (score >= 90) return `Probable person match — ${score}%`;
  if (score >= 70) return `Probable person match — ${score}%`;
  if (score >= 55) return 'Possible family relationship';
  return null;
}

/**
 * Given normalized rows from union search, attach relationship labels for related mode.
 */
function applyRelationshipLabels(rows, relationships = []) {
  if (!relationships.length) return rows;
  const out = rows.map((r) => ({ ...r }));
  const byLast = new Map();
  for (const r of out) {
    const last = nameParts(r.primaryName).last;
    if (!last) continue;
    if (!byLast.has(last)) byLast.set(last, []);
    byLast.get(last).push(r);
  }

  const wantsSame = relationships.some((x) => x.type === 'same_person' || x.type === 'baptized_then_married');
  const wantsFamily = relationships.some((x) => x.type === 'family');

  for (const [, group] of byLast) {
    if (group.length < 2) {
      if (wantsFamily) {
        for (const r of group) {
          r.matchLabel = 'Exact field match';
          r.matchConfidence = 100;
        }
      }
      continue;
    }
    for (let i = 0; i < group.length; i++) {
      let best = 0;
      for (let j = 0; j < group.length; j++) {
        if (i === j) continue;
        if (wantsSame && group[i].recordType === group[j].recordType) continue;
        best = Math.max(best, scorePair(group[i], group[j]));
      }
      if (best >= 55) {
        group[i].matchLabel = labelForScore(best);
        group[i].matchConfidence = best;
      } else if (wantsFamily) {
        group[i].matchLabel = 'Possible family relationship';
        group[i].matchConfidence = 55;
      }
    }
  }

  // For baptized_then_married, keep baptism/marriage rows that share a last name with the other type
  if (relationships.some((x) => x.type === 'baptized_then_married')) {
    const baptisms = out.filter((r) => r.recordType === 'baptism');
    const marriages = out.filter((r) => r.recordType === 'marriage');
    const keep = [];
    for (const b of baptisms) {
      for (const m of marriages) {
        const s = scorePair(b, m);
        if (s >= 55) {
          b.matchLabel = labelForScore(s);
          b.matchConfidence = s;
          m.matchLabel = labelForScore(s);
          m.matchConfidence = s;
          if (!keep.includes(b)) keep.push(b);
          if (!keep.includes(m)) keep.push(m);
        }
      }
    }
    return keep;
  }
  return out;
}

module.exports = {
  normalizeName,
  nameParts,
  scorePair,
  labelForScore,
  applyRelationshipLabels,
};
