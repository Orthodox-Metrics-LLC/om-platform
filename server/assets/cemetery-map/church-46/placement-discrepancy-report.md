# Church 46 Cemetery Placement Discrepancy Report

**Generated:** 2026-07-12 (pre-fix audit)  
**Sources:** `tmp/ssppoc_all_grave_mappings_with_locations.xlsx`, `tmp/reference-final.png`, `tmp/cemetery-section-3-reference-image.png`, current `geometry/rows.json` + `import-manifest.json`

## Executive summary

The primary defect is **92 NEW-MN graves rendered north of the white fence** (map_y 6.0–18.3) due to `rows.json` anchorY values placed above the horizontal NS road (y=18) and north of the gate fence (y=30). Reference images place this M/N grid **inside the cemetery**, east of the entrance path, **south of the fence** and **above** the R16–R22 traffic-circle rows (y≈47–68).

Graves **801–824** are **not** part of the NEW-MN cluster. Workbook assigns them to Section 2 west rows L21–L27 (807–824) and Section 3 west L28 (800–802). Operator overlay suggesting east upper S3 for 801–824 **conflicts with workbook and section-3 reference image** (801–802 shown west at L28). **No workbook row changes proposed.**

## Coordinate system

- SVG viewBox: y increases **downward** (south). Lower y = north (top of map).
- White fence / gate: `y = 30` (`world.json` → `landmarks.whiteGate`)
- Horizontal NS road: `y = 18`
- Traffic circle center: `(42, 62)`; R22 east row: `y ≈ 47`

Graves must satisfy `map_y > 31.2` (fence + half plot + gap) to be inside the cemetery.

## Critical findings (pre-fix)

| Issue | Count | Detail |
|-------|------:|--------|
| NEW-MN north of fence | 92 | All `region_code=NEW-MN` at y 6.0–18.3; should be y 33–45 |
| NEW-MN north of horizontal road | 92 | Above y=18 T-path horizontal leg |
| Workbook vs manifest section-1 delta | +22 synthetic | Manifest 92 vs workbook 70 in section 1 (synthetic multi-slot plots) |
| 801–824 east-S3 operator claim | 0 moved | Workbook: west L21–L28; reference agrees for 801–802 |
| Orphan interments (occupied, no name) | 5 | R21/R22 operator overrides — expected until import refresh |

## NEW-MN workbook assignment (authoritative)

- **Section:** NS (92 plots)
- **Region:** NEW-MN
- **Rows:** N-04, N-03, N-02, N-01, M-02, M-01 (column-major grid)
- **Numbers:** 1M–9M, 10M–24M, 18N–85N (N/M suffix graves)

## 801–824 workbook assignment (authoritative)

| Grave range | Workbook section | Row(s) | Side |
|-------------|-----------------|--------|------|
| 800–802 | 3 | L28 | West (circle) |
| 807–824 | 2 | L21–L27 | West (upper field) |

Families cited by operator (CHEREPANIA/Chepan, Romanofsky, etc.) match west-side L23–L24/L28 rows in workbook — **not** NEW-MN.

## Planned geometry fix

Shift NEW-MN row anchors **+27** on Y axis:

| Row | Old anchorY | New anchorY |
|-----|------------|-------------|
| N-04 | 6.0 | 33.0 |
| N-03 | 8.2 | 35.2 |
| N-02 | 10.4 | 37.4 |
| N-01 | 12.6 | 39.6 |
| M-02 | 14.8 | 41.8 |
| M-01 | 16.6 | 43.6 |

Resulting bounds: x 41.5–64.5, y 33.0–45.3 — south of fence, north of R22 (y=47), east of path (x=33).

## Unresolved / follow-up

1. **801–824 east placement:** Operator overlay conflicts with workbook; needs operator confirmation before any row reassignment.
2. **Section-1 synthetic plots:** 22 extra manifest slots from multi-grave physical lots — data model, not geometry.
3. **NEW-MN column width:** Reference shows ~6 columns to x≈85; current spacing may be narrow — verify visually post-deploy.
