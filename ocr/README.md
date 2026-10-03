# Upload Records (OCR)

MUI port of the **OM-Record-Upload** Figma Make prototype, wired to the real OM OCR APIs.

## Layout

| Path | Role |
|------|------|
| `src/` | Symlink → `front-end/src/sections/ocr` (canonical MUI implementation) |
| `design/OM-Record-Upload/` | Extracted prototype (reference only) |
| `design/OM-Record-Upload.zip` | Source archive from `prod/tmp/9-30-26/record-upload` |

## App routes (om-platform)

- `/dashboard/ocr` — batch list (`OcrListView`)
- `/dashboard/ocr/upload` — five-step wizard (`OcrWizardView`)
- `/dashboard/ocr/:id` — job detail

Legacy shims: `/portal/ocr`, `/portal/ocr/upload`, `/ocr/upload` → dashboard OCR routes.

## Front-end integration

`front-end/vite.config.ts` aliases `@om/ocr` → `../ocr/src`.  
Pages import `src/sections/ocr`, which re-exports this module.
