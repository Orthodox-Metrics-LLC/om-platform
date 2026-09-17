# Template debt

Minimal template content still present in `front-end/`. Each line is deleted in the same
commit as the OM feature that replaces it — see `docs/adaptation-guide.md` §2.

**This file reaching empty is the definition of the migration being finished.**

## Slots OM will take over

| Template slot | Replaced by | Status |
|---|---|---|
| `sections/calendar` | `features/liturgical-calendar` | pending (pilot) |
| `sections/chat` | ? | pending triage |
| `sections/mail` | ? | pending triage |
| `sections/file-manager` | `features/assets-library`? | pending triage |
| `sections/kanban` | ? | pending triage |
| `sections/blog` | — (blog dropped; DB tables empty) | **delete outright** |
| `sections/user`, `sections/account` | `features/account` | pending triage |
| `sections/overview` | `features/dashboard` | pending triage |

## Slots with no OM counterpart — delete once confirmed unused

`sections/checkout` · `sections/product` · `sections/invoice` · `sections/job` ·
`sections/tour` · `sections/_examples` · `sections/address`

## Cross-cutting

| Item | Note |
|---|---|
| `_mock/` | Fake users, invoices, posts, avatars. Must reach zero. Load-bearing for demos only. |
| `auth/context/auth0`, `amplify`, `supabase`, `firebase` | OM uses its own backend. Delete, do not adapt. |
| `pages/auth-demo/`, `pages/components/` | Template showcase pages. |
| `lib/firebase.ts`, `lib/supabase.ts` | Unused providers. |
| `actions/blog.ts`, `product.ts`, `mail.ts`, `chat.ts`, `kanban.ts` | Demo data layers. |
| Placeholder branding / `minimals.cc` links | Must be gone before any production cutover. |
