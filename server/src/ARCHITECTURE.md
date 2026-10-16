# Server `src/` layering (target)

Prefer these homes for **new** code. Existing `api/`, `modules/`, and `controllers/` clusters remain until migrated deliberately.

| Layer | Path | Role |
|-------|------|------|
| Entry | `index.ts` | Express bootstrap, route mounts |
| HTTP routes | `routes/` | Request handlers / routers |
| Domain services | `services/` | Business logic |
| Feature packs | `features/` | Cohesive vertical slices (when used) |
| Data access | `dal/`, `models/`, `db/` | Persistence helpers |
| Config | `config/` | Env, DB pools, session |
| Workers | `workers/` | Background jobs |
| OCR | `ocr/` | OCR pipeline |
| Middleware | `middleware/` | Auth, logging, tenancy |
| Utils | `utils/`, `types/` | Shared helpers / types |

**Avoid for new work:** adding parallel top-level trees (`api/` vs `routes/`, new `controllers/` files). Extend an existing route+service pair instead.

**Build:** only `server/src` compiles/copies to `server/dist`. Ops scripts live in `/prod/scripts/server/` (build tools stay in `server/scripts/`).
