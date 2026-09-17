# Adapting the OM front-end into Minimal

**Principle:** the Minimal template's structure and idioms are canonical. OM code is
rewritten to look as though it had always been written here — not dropped in as a foreign
`features/` tree beside it.

Consequence: **this is a rewrite per feature, not a file move.** Budget accordingly. What
makes it tractable is that the target shape is already decided for us.

---

## 1. The two structures

OM is **feature-sliced** — everything for a feature lives under `features/<name>/`.
Minimal is **layer-sliced** — a feature's parts are distributed across fixed layers.

| OM (`prod/front-end/src`) | Minimal (`om-platform/front-end/src`) | Notes |
|---|---|---|
| `features/<f>/<F>Page.tsx` | `pages/dashboard/<f>.tsx` | Page becomes a thin shell: metadata + render the view |
| — | `sections/<f>/view/<f>-view.tsx` | The composition the page renders. OM has no equivalent layer; it must be created |
| `features/<f>/components/*.tsx` | `sections/<f>/<f>-*.tsx` | **Flat**, feature-prefixed. No `components/` subfolder |
| `features/<f>/hooks/*.ts` | `sections/<f>/hooks/use-*.ts` | Kebab-case filenames |
| `features/<f>/api/<f>Api.ts` | `actions/<f>.ts` + `endpoints` in `lib/axios.ts` | Becomes SWR hooks; see §3 |
| `features/<f>/types.ts` | `types/<f>.ts` | Interfaces get the `I` prefix |
| `features/<f>/*.css` | `sections/<f>/styles.tsx` | Minimal uses styled components, not CSS files |
| `shared/ui/*` | `components/*` | Reconcile against Minimal's existing components first — do not duplicate |
| `shared/api/axiosInstance.ts` | `lib/axios.ts` | One client for the whole app; see §3 |
| `app/providers/*Context.tsx` | `auth/context/` or `contexts/` | Only if Minimal has no equivalent |
| `routes/publicRoutes.tsx` etc. | `routes/sections/*.tsx` | |

### Naming rules to apply

| | OM | Minimal |
|---|---|---|
| Component files | `LiturgicalDaySidebar.tsx` | `calendar-day-sidebar.tsx` |
| Hook files | `useLiturgicalCalendar.ts` | `use-calendar.ts` |
| Types | `LiturgicalDay` | `ILiturgicalDay` |
| Data hooks | `fetchSeason()` | `useGetSeason()` |

---

## 2. The template is on loan

`front-end/` is the full template so OM features have somewhere to land. When an OM feature
occupies a Minimal slot, **the template's demo content for that slot is deleted in the same
commit.** Deferring that is exactly how `prod/front-end` accumulated 280 MB.

Slots already claimed by Minimal that OM will take over: `calendar`, `chat`, `mail`,
`file-manager`, `kanban`, `blog`, `user`, `account`, `overview`. Slots with no OM
counterpart (`checkout`, `product`, `invoice`, `job`, `tour`, `banking`, `booking`,
`ecommerce`) get deleted outright once we confirm nothing needs them.

Track in `front-end/TEMPLATE-DEBT.md`. That file reaching empty is the definition of done.

---

## 3. The real work: collapsing three data patterns into one

This is the substance of the migration, not the directory moves.

**Measured across OM's real features (excluding the vendored template):**

| Pattern | Files |
|---|---|
| `apiClient.*` called directly from components | **144** |
| raw `useState` + `useEffect` fetching | **77** |
| `useSWR` | 5 |
| `useQuery` (react-query) | 4 |

`package.json` carries `swr`, `@tanstack/react-query` **and** `axios` — three data stacks
for one app.

**Minimal has exactly one pattern:** a per-feature `actions/<f>.ts` exporting `useGetX()`
SWR hooks that call `fetcher` with a URL from the central `endpoints` map.

### Conversion, concretely

Before (OM — endpoint inline, fetch inside the component):

```ts
// features/liturgical-calendar/api/liturgicalCalendarApi.ts
const res = await apiClient.get(`/orthodox-calendar/pascha/${year}`);
```

After (Minimal idiom):

```ts
// lib/axios.ts — every endpoint centralised, none inline
orthodoxCalendar: {
  season: '/api/orthodox-calendar/season',
  pascha: '/api/orthodox-calendar/pascha',
  feastsSearch: '/api/orthodox-calendar/feasts/search',
  saintsSearch: '/api/orthodox-calendar/saints/search',
},
```

```ts
// actions/calendar.ts
export function useGetPascha(year: number) {
  const url = `${endpoints.orthodoxCalendar.pascha}/${year}`;
  const { data, isLoading, error, isValidating } = useSWR<PaschaData>(url, fetcher, swrOptions);

  return useMemo(
    () => ({ pascha: data?.pascha, paschaLoading: isLoading, paschaError: error, paschaValidating: isValidating }),
    [data, error, isLoading, isValidating]
  );
}
```

**Rules:**
1. No component calls `apiClient` or `fetch` directly. Ever.
2. No endpoint string appears outside `lib/axios.ts`.
3. `useState` + `useEffect` fetching is replaced by SWR, not wrapped in it.
4. react-query is not carried over — one client only.
5. OM's `apiClient` class (interceptors, error handling, `/api` prefixing) is **not**
   ported wholesale. Anything genuinely needed moves into `lib/axios.ts`; the rest is
   dropped. Two axios wrappers in one app is how this got messy.

### Other conversions that bite

- **MUI 7 → 9.** `Grid` API, `sx` array signature, `slotProps` replacing many
  `*Props`, `styled` import paths. Not optional and not automatic.
- **React 18 → 19.** `ref` as a prop, stricter effect semantics.
- **`theme.vars.*`.** Minimal is CSS-variables-first. `theme.palette.x` becomes
  `theme.vars.palette.x` in `sx`, and dark mode uses `theme.applyStyles('dark', …)`.
- **Icons.** OM uses lucide via `shared/ui/icons`; Minimal uses a typed offline Iconify
  registry — an unregistered name is a **compile error**, so every icon needs a mapped
  equivalent or a registry addition.
- **Tailwind.** OM's front-end uses Tailwind; Minimal does not. Tailwind classes must be
  converted to `sx`, not carried across.

---

## 4. Worked example — the pilot

`features/liturgical-calendar` → `sections/calendar`. Chosen because Minimal already owns a
`calendar` slot, so it proves the "native component" idea and lets us delete a template demo
in the same commit.

| OM file | Becomes |
|---|---|
| `LiturgicalCalendarPage.tsx` | `pages/dashboard/calendar.tsx` + `sections/calendar/view/calendar-view.tsx` |
| `components/LiturgicalCalendarToolbar.tsx` | `sections/calendar/calendar-toolbar.tsx` *(replaces the template's)* |
| `components/LiturgicalDaySidebar.tsx` | `sections/calendar/calendar-day-sidebar.tsx` |
| `hooks/useLiturgicalCalendar.ts` | `sections/calendar/hooks/use-calendar.ts` *(replaces the template's)* |
| `hooks/useLiturgicalAutoTheme.ts` | `sections/calendar/hooks/use-liturgical-theme.ts` |
| `api/liturgicalCalendarApi.ts` | `actions/calendar.ts` + 4 entries in `endpoints` |
| `liturgical-calendar.css` | `sections/calendar/styles.tsx` |
| `LiturgicalThemeSync.tsx` | `sections/calendar/liturgical-theme-sync.tsx` |

Endpoints to register: `/orthodox-calendar/season`, `/pascha/:year`,
`/feasts/search`, `/saints/search`.

Deleted in the same commit: the template's demo `calendar-form.tsx`,
`calendar-filters*.tsx` and its `_mock` calendar events, unless a real OM need is identified.

---

## 5. Definition of done, per feature

1. Files sit in Minimal's layers with Minimal's naming.
2. Zero `apiClient`/`fetch` calls in components; all data via `actions/<f>.ts`.
3. Zero endpoint strings outside `lib/axios.ts`.
4. Types in `types/<f>.ts`, `I`-prefixed.
5. No Tailwind classes; no CSS files.
6. Icons resolve against the typed registry.
7. The template demo content it replaced is deleted, and `TEMPLATE-DEBT.md` updated.
8. `tsc --noEmit` and `eslint` clean; feature exercised against the **real** backend.
9. Route registered in `routes/sections/`.

---

## 6. Open questions

1. **Feature triage** — `docs/migration-contract.md` §3 needs operator marks; nothing
   migrates by default.
2. **Dashboard shell** — OM's existing dashboard layout/menu vs Minimal's. Minimal's is
   canonical per this guide, so OM's `layouts/` and `MenuItems.ts` are reference material,
   not migration candidates. Worth confirming.
3. **Auth** — the public-site work already authenticates against the real OM backend via
   `auth/context/om-auth.tsx`. Minimal's four provider demos (Auth0, Amplify, Supabase,
   Firebase) should be deleted rather than adapted.
4. **`_mock`** — must reach zero. It is currently load-bearing for template demos only.
