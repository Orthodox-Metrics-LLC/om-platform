# Server storage (runtime / durable data)

Writable and large artifacts for the OM backend. Not application source.

| Path | Purpose |
|------|---------|
| `feeder/` | OCR feeder job artifacts |
| `uploads/` | **Deprecated** — canonical uploads root is `/prod/uploads` |
| `certificates/` | Certificate studio output + `templates/` for PNG templates |
| `tessdata/` | Tesseract `*.traineddata` (set `TESSDATA_PREFIX` here if needed) |
| `ocr-reference/` | OCR reference corpora (e.g. ssppoc-record-images) |
| `om-assets/` | OM assets library blobs |
| `ssl-staging/` | SSL staging |

Versioned cemetery geometry lives in `server/assets/cemetery-map/`.
