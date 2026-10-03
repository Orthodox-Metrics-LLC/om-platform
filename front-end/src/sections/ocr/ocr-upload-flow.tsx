/* eslint-disable */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react"
import { useNavigate } from "react-router"

import { paths } from "src/routes/paths"
import {
  useActiveChurchId,
  useWorkspaces,
} from "src/layouts/components/use-active-church"

import {
  fetchOcrJobs,
  isJobTerminal,
  uploadOcrFiles,
  fetchOcrSettings,
  wizardProcessingStepIndex,
  type OmOcrJob,
  type OmOcrRecordType,
} from "./om-ocr-api"

type Page = "upload" | "image-review" | "records" | "processing" | "record-review" | "final-audit"
type Preset = "green" | "blue" | "purple" | "orange" | "red"
type FontChoice = "Public Sans" | "Inter" | "DM Sans" | "Nunito Sans"
type RecordType = "Baptism" | "Marriage" | "Funeral" | "Custom"
type BatchState = {
  recordType: RecordType
  language: string
  files: string[]
  fileBlobs: File[]
  previews: string[]
  jobIds: string[]
  batchId: string
  church: string
}

function recordTypeToApi(type: RecordType): OmOcrRecordType {
  if (type === "Baptism") return "baptism"
  if (type === "Marriage") return "marriage"
  if (type === "Funeral") return "funeral"
  return "custom"
}

function makeBatchId(): string {
  return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
type WorkflowNavigation = {
  maxReached: number
  onNavigate: (step: number) => void
}
const fallbackWorkflowNavigation: WorkflowNavigation = {
  maxReached: 0,
  onNavigate: () => undefined,
}

const iconPaths: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
      <path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
    </>
  ),
  records: (
    <>
      <path d="M6 2h9l4 4v16H6z" />
      <path d="M14 2v5h5M9 12h6M9 16h6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </>
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  more: (
    <>
      <circle cx="12" cy="5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8z" />,
  columns: (
    <>
      <rect x="3" y="5" width="5" height="14" rx="1" />
      <rect x="10" y="5" width="5" height="14" rx="1" />
      <rect x="17" y="5" width="4" height="14" rx="1" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12 4 4L19 6" />,
  cloud: (
    <>
      <path d="M6.5 18H5a3 3 0 0 1-.3-6A7 7 0 0 1 18 10a4 4 0 0 1 1 7.9" />
      <path d="M12 19V9m0 0-3 3m3-3 3 3" />
    </>
  ),
  menu: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  church: (
    <>
      <path d="M5 21V10l7-5 7 5v11M9 21v-7h6v7" />
      <path d="M12 2v5M9.5 4.5h5" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 15-5-5L5 20" />
    </>
  ),
  sync: (
    <>
      <path d="M20 7h-5V2" />
      <path d="M19 5a9 9 0 1 0 2 8" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7h.01" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2.5 20h19z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  eye: (
    <>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  rotateLeft: (
    <>
      <path d="M4 7h5V2" />
      <path d="M5.5 5.5A8 8 0 1 1 4 14" />
    </>
  ),
  rotateRight: (
    <>
      <path d="M20 7h-5V2" />
      <path d="M18.5 5.5A8 8 0 1 0 20 14" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
}

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  )
}

export function Button({
  children,
  variant = "contained",
  icon,
  onClick,
  disabled,
  className = "",
}: {
  children: ReactNode
  variant?: "contained" | "outlined" | "text"
  icon?: string
  onClick?: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      className={`button button--${variant} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon && <Icon name={icon} size={18} />}
      <span>{children}</span>
    </button>
  )
}

export function IconButton({
  icon,
  label,
  onClick,
  className = "",
}: {
  icon: string
  label: string
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  )
}

export function Select({
  value,
  onChange,
  children,
  label,
}: {
  value: string
  onChange: (value: string) => void
  children: ReactNode
  label: string
}) {
  return (
    <label className="select-field">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
      <span className="select-arrow">⌄</span>
    </label>
  )
}

export function TextField({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="text-field">
      <Icon name="search" size={18} />
      <span className="sr-only">{placeholder}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  )
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode
  className?: string
}) {
  return <section className={`card ${className}`}>{children}</section>
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <span />
        <span />
        <span />
      </span>
      <span className="brand-name">
        Orthodox <b>Metrics</b>
      </span>
    </div>
  )
}

const recordTypes: { name: RecordType; subtitle: string }[] = [
  { name: "Baptism", subtitle: "Baptismal registers" },
  { name: "Marriage", subtitle: "Marriage registers" },
  { name: "Funeral", subtitle: "Funeral registers" },
  { name: "Custom", subtitle: "Other record types" },
]

function SacramentIcon({ type }: { type: RecordType | "Other" }) {
  if (type === "Baptism")
    return (
      <svg className="sacrament" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M13 21h22l-3 16H16z" />
        <path d="M10 39h28M18 16h12M24 6v10M19 10h10" />
        <path
          className="accent-fill"
          d="M24 18c5 6 6 9 6 12a6 6 0 0 1-12 0c0-3 2-7 6-12Z"
        />
      </svg>
    )
  if (type === "Marriage")
    return (
      <svg className="sacrament" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="18" cy="28" r="10" />
        <circle cx="30" cy="28" r="10" />
        <path d="M24 4v10M19 9h10M15 18l4-6h10l4 6" />
      </svg>
    )
  if (type === "Funeral")
    return (
      <svg className="sacrament" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M24 5v31M17 12h14M14 20h20M12 40c5-5 7-7 12-7s7 2 12 7" />
        <path
          className="accent-fill"
          d="M9 38c5-2 9 0 12 5H11zM39 38c-5-2-9 0-12 5h10z"
        />
      </svg>
    )
  return (
    <svg className="sacrament" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M12 5h18l7 7v30H12zM29 5v9h8M18 22h13M18 28h9" />
      <circle className="accent-fill" cx="34" cy="35" r="8" />
      <path className="on-accent" d="M34 31v8M30 35h8" />
    </svg>
  )
}

function Sidebar({
  page,
  setPage,
  openSettings,
}: {
  page: Page
  setPage: (page: Page) => void
  openSettings: () => void
}) {
  return (
    <aside className="sidebar">
      <Brand />
      <nav className="nav-list" aria-label="Main navigation">
        <span className="nav-label">Workspace</span>
        <button type="button" className="nav-item">
          <Icon name="dashboard" />
          <span>Dashboard</span>
        </button>
        <button
          type="button"
          className={`nav-item ${
            page === "upload" || page === "image-review" ? "active" : ""
          }`}
          onClick={() => setPage("upload")}
        >
          <Icon name="upload" />
          <span>Upload records</span>
        </button>
        <button
          type="button"
          className={`nav-item ${
            page === "records" ||
            page === "processing" ||
            page === "record-review" ||
            page === "final-audit"
              ? "active"
              : ""
          }`}
          onClick={() => setPage("records")}
        >
          <Icon name="records" />
          <span>Records</span>
          <span className="nav-badge">5</span>
        </button>
        <span className="nav-label nav-label--second">Manage</span>
        <button type="button" className="nav-item" onClick={openSettings}>
          <Icon name="settings" />
          <span>Appearance</span>
        </button>
      </nav>
      <div className="sidebar-profile">
        <span className="avatar">NK</span>
        <span>
          <b>Niko Karras</b>
          <small>Administrator</small>
        </span>
        <Icon name="more" />
      </div>
    </aside>
  )
}

function Header({
  page,
  openSettings,
  openNav,
  embedded,
}: {
  page: Page
  openSettings: () => void
  openNav: () => void
  embedded?: boolean
}) {
  const pageNames: Record<Page, string> = {
    upload: "Upload records",
    "image-review": "Image Review",
    records: "Records",
    processing: "Processing",
    "record-review": "Record review",
    "final-audit": "Final audit",
  }
  return (
    <header className="topbar">
      <IconButton
        icon="menu"
        label="Open navigation"
        className="mobile-menu"
        onClick={openNav}
      />
      <div className="breadcrumbs">
        <span>Dashboard</span>
        <Icon name="chevron" size={14} />
        <b>{pageNames[page]}</b>
      </div>
      {/* Appearance/search/avatar controls are the app's own header
          (DashboardLayout) when embedded — this bar only needs the gear
          in standalone/demo mode, where there's no outer chrome. */}
      {!embedded && (
        <div className="top-actions">
          <IconButton icon="search" label="Search" />
          <IconButton
            icon="settings"
            label="Appearance settings"
            onClick={openSettings}
          />
          <span className="avatar avatar--small">NK</span>
        </div>
      )}
    </header>
  )
}

function UploadPage({
  goToRecords,
  goToImageReview,
  batch,
  setBatch,
  churchId,
  workflow = fallbackWorkflowNavigation,
}: {
  goToRecords: () => void
  goToImageReview: () => void
  batch: BatchState
  setBatch: Dispatch<SetStateAction<BatchState>>
  churchId: number | null
  workflow?: WorkflowNavigation
}) {
  const [search, setSearch] = useState("")
  const [uploaded, setUploaded] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Record language is determined by how the church is configured, not a
  // per-upload choice — no visible selector on this screen.
  const [churchLanguage, setChurchLanguage] = useState("en")
  const inputRef = useRef<HTMLInputElement>(null)
  const { recordType: type, files } = batch

  useEffect(() => {
    if (!churchId) return
    fetchOcrSettings(churchId)
      .then((settings) => {
        const lang = settings.defaultLanguage || settings.language
        if (lang) setChurchLanguage(lang)
      })
      .catch(() => {
        /* fall back to English if church settings can't be loaded */
      })
  }, [churchId])

  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? [])
    event.target.value = ""
    if (!picked.length) return
    setError(null)
    setBatch((current) => ({
      ...current,
      files: [...current.files, ...picked.map((file) => file.name)],
      fileBlobs: [...current.fileBlobs, ...picked],
      previews: [
        ...current.previews,
        ...picked.map((file) => URL.createObjectURL(file)),
      ],
    }))
  }

  const removeAt = (index: number) => {
    setBatch((current) => {
      const preview = current.previews[index]
      if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview)
      return {
        ...current,
        files: current.files.filter((_, itemIndex) => itemIndex !== index),
        fileBlobs: current.fileBlobs.filter((_, itemIndex) => itemIndex !== index),
        previews: current.previews.filter((_, itemIndex) => itemIndex !== index),
      }
    })
  }

  const startUpload = async () => {
    if (!churchId) {
      setError("Select a parish before uploading.")
      return
    }
    if (!batch.fileBlobs.length) {
      setError("Select files before starting the upload.")
      return
    }
    setUploading(true)
    setError(null)
    try {
      const result = await uploadOcrFiles(churchId, batch.fileBlobs, {
        recordType: recordTypeToApi(type),
        language: churchLanguage,
        batchId: batch.batchId,
      })
      const jobIds = (result.jobs ?? []).map((job) => String(job.id))
      const serverBatchId = result.jobs?.[0]?.batch_id || batch.batchId
      setBatch((current) => ({
        ...current,
        jobIds,
        batchId: serverBatchId || current.batchId,
      }))
      setUploaded(true)
      goToImageReview()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed"
      setError(message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <main className="page">
      <WorkflowStepper
        current={0}
        maxReached={workflow.maxReached}
        onNavigate={workflow.onNavigate}
      />
      <div className="page-title">
        <div>
          <h1>New OCR upload</h1>
          <p>Digitize and organize your parish records.</p>
        </div>
        <Button variant="outlined" onClick={goToRecords}>
          View records
        </Button>
      </div>
      {!churchId && (
        <div className="alert alert--error">
          <span className="alert-icon">
            <Icon name="info" size={16} />
          </span>
          <span>
            <b>Select a parish</b>
            <small>Choose the parish in the header before uploading records.</small>
          </span>
        </div>
      )}
      {error && (
        <div className="alert alert--error">
          <span className="alert-icon">
            <Icon name="alert" size={16} />
          </span>
          <span>
            <b>Upload failed</b>
            <small>{error}</small>
          </span>
          <IconButton
            icon="close"
            label="Dismiss"
            onClick={() => setError(null)}
          />
        </div>
      )}
      {uploaded && (
        <div className="alert alert--success">
          <span className="alert-icon">
            <Icon name="check" size={16} />
          </span>
          <span>
            <b>Upload started</b>
            <small>
              {files.length} images are being prepared for OCR review.
            </small>
          </span>
          <IconButton
            icon="close"
            label="Dismiss"
            onClick={() => setUploaded(false)}
          />
        </div>
      )}
      <Card>
        <div className="section-heading">
          <h2>Record type</h2>
          <p>What kind of register are you uploading?</p>
        </div>
        <div className="type-grid">
          {recordTypes.map((item) => (
            <button
              type="button"
              key={item.name}
              className={`type-card ${type === item.name ? "selected" : ""}`}
              onClick={() =>
                setBatch((current) => ({
                  ...current,
                  recordType: item.name,
                }))
              }
            >
              <span className="selected-check">
                <Icon name="check" size={13} />
              </span>
              <SacramentIcon type={item.name} />
              <span>
                <b>{item.name}</b>
                <small>{item.subtitle}</small>
              </span>
            </button>
          ))}
        </div>
      </Card>
      <Card className="search-card">
        <div className="section-heading">
          <h2>Link an existing register</h2>
          <p>
            Optional — connect this batch to a register already in your archive.
          </p>
        </div>
        <TextField
          value={search}
          onChange={setSearch}
          placeholder="Search registers by parish, year, or title..."
        />
        {search && (
          <div className="search-result">
            <span className="document-icon">
              <Icon name="records" />
            </span>
            <span>
              <b>Saint Nicholas {type} register</b>
              <small>1895–1910 · 214 records</small>
            </span>
            <Button variant="text">Select</Button>
          </div>
        )}
      </Card>
      <Card>
        <div className="section-heading section-heading--row">
          <div>
            <h2>Upload files</h2>
            <p>JPG, PNG, or PDF. Maximum 50 files per batch.</p>
          </div>
          <span className="counter">{files.length}/50 files</span>
        </div>
        <div className="dropzone" onClick={() => inputRef.current?.click()}>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.pdf"
            onChange={addFiles}
          />
          <span className="upload-illustration">
            <span className="file-sheet">
              <Icon name="records" size={30} />
            </span>
            <span className="upload-circle">
              <Icon name="upload" size={18} />
            </span>
          </span>
          <b>Drop files here or select files</b>
          <p>
            Drag images here, or <span>browse your device</span>
          </p>
        </div>
        {files.length > 0 && (
          <div className="file-strip">
            {files.map((file, index) => (
              <div className="file-thumb" key={`${file}-${index}`}>
                <span className="paper-lines" />
                <IconButton
                  icon="close"
                  label={`Remove ${file}`}
                  onClick={() => removeAt(index)}
                  className={uploading ? "is-disabled" : ""}
                />
                <small>{index + 1}</small>
              </div>
            ))}
            <button
              type="button"
              className="add-more"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              <Icon name="plus" />
              <span>Add more</span>
            </button>
          </div>
        )}
        {uploading && (
          <div className="upload-progress" role="status" aria-live="polite">
            <span className="upload-progress-spinner" aria-hidden="true" />
            <span>
              Uploading {files.length} file{files.length === 1 ? "" : "s"} to the server — this can take a
              moment for larger batches. Don&rsquo;t close this page.
            </span>
          </div>
        )}
        <div className="upload-footer">
          <span>
            {files.length
              ? `${files.length} files ready to upload`
              : "No files selected"}
          </span>
          <div>
            <Button
              variant="text"
              onClick={() => {
                batch.previews.forEach((preview) => {
                  if (preview.startsWith("blob:")) URL.revokeObjectURL(preview)
                })
                setBatch((current) => ({
                  ...current,
                  files: [],
                  fileBlobs: [],
                  previews: [],
                }))
              }}
              disabled={!files.length || uploading}
            >
              Remove all
            </Button>
            <Button
              icon="upload"
              disabled={!churchId || !batch.fileBlobs.length || uploading}
              onClick={startUpload}
            >
              {uploading ? "Uploading…" : "Start upload"}
            </Button>
          </div>
        </div>
      </Card>
    </main>
  )
}

const rows = [
  {
    id: "B-2024-0186",
    title: "Baptism Ledger 1895–1910",
    type: "Baptism",
    date: "Oct 1, 2024",
    images: 24,
    records: 72,
    mode: "Automatic",
    status: "complete",
    progress: 100,
    readiness: "Ready for review",
  },
  {
    id: "B-2024-0182",
    title: "Saint George register",
    type: "Baptism",
    date: "Sep 30, 2024",
    images: 18,
    records: 54,
    mode: "Automatic",
    status: "complete",
    progress: 100,
    readiness: "Ready for review",
  },
  {
    id: "F-2024-0084",
    title: "funeral_20",
    type: "Funeral",
    date: "Sep 29, 2024",
    images: 10,
    records: 18,
    mode: "Automatic",
    status: "processing",
    progress: 60,
    readiness: "Not ready",
  },
  {
    id: "M-2024-0173",
    title: "marriage_1932",
    type: "Marriage",
    date: "Sep 28, 2024",
    images: 8,
    records: 8,
    mode: "Manual",
    status: "review",
    progress: 100,
    readiness: "Needs review",
  },
  {
    id: "C-2024-0221",
    title: "misc_records_041",
    type: "Other",
    date: "Sep 27, 2024",
    images: 5,
    records: 4,
    mode: "Automatic",
    status: "pending",
    progress: 0,
    readiness: "Not ready",
  },
] as const

function StatusChip({ status }: { status: string }) {
  const labels: Record<string, string> = {
    complete: "Completed",
    processing: "Processing",
    review: "Needs review",
    pending: "Pending",
  }
  return <span className={`chip chip--${status}`}>{labels[status]}</span>
}

function RecordsPage({ goToUpload }: { goToUpload: () => void }) {
  const [query, setQuery] = useState("")
  const [type, setType] = useState("All record types")
  const [status, setStatus] = useState("All statuses")
  const [selected, setSelected] = useState<string[]>([])
  const visibleRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          (type === "All record types" || row.type === type) &&
          (status === "All statuses" || row.status === status) &&
          `${row.title} ${row.id}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [query, status, type],
  )

  const toggleAll = () =>
    setSelected(
      selected.length === visibleRows.length
        ? []
        : visibleRows.map((row) => row.id),
    )
  return (
    <main className="page page--wide">
      <div className="page-title">
        <div>
          <h1>Records</h1>
          <p>Track OCR processing and review parish records.</p>
        </div>
        <Button icon="upload" onClick={goToUpload}>
          Upload batch
        </Button>
      </div>
      <Card className="records-card">
        <div className="table-tools">
          <div className="filters">
            <Select label="Record type" value={type} onChange={setType}>
              <option>All record types</option>
              <option>Baptism</option>
              <option>Marriage</option>
              <option>Funeral</option>
              <option>Other</option>
            </Select>
            <Select
              label="Processing status"
              value={status}
              onChange={setStatus}
            >
              <option>All statuses</option>
              <option value="complete">Completed</option>
              <option value="processing">Processing</option>
              <option value="review">Needs review</option>
              <option value="pending">Pending</option>
            </Select>
            <TextField
              value={query}
              onChange={setQuery}
              placeholder="Search batches, filenames, or IDs..."
            />
          </div>
          <div className="table-actions">
            <Button variant="text" icon="columns">
              Columns
            </Button>
            <Button variant="text" icon="filter">
              Filters
            </Button>
          </div>
        </div>
        {selected.length > 0 && (
          <div className="selection-bar">
            <b>{selected.length} selected</b>
            <span />
            <Button variant="text">Export</Button>
            <Button variant="text" onClick={() => setSelected([])}>
              Clear
            </Button>
          </div>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all records"
                    checked={
                      visibleRows.length > 0 &&
                      selected.length === visibleRows.length
                    }
                    onChange={toggleAll}
                  />
                </th>
                <th>Batch</th>
                <th>Record type</th>
                <th>Submitted</th>
                <th>Images</th>
                <th>Detected records</th>
                <th>Processing mode</th>
                <th>Processing status</th>
                <th>Review readiness</th>
                <th>Review action</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, index) => (
                <tr key={row.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.title}`}
                      checked={selected.includes(row.id)}
                      onChange={() =>
                        setSelected((current) =>
                          current.includes(row.id)
                            ? current.filter((id) => id !== row.id)
                            : [...current, row.id],
                        )
                      }
                    />
                  </td>
                  <td>
                    <div className="batch-cell">
                      <span className={`batch-preview batch-preview--${index}`}>
                        <span />
                      </span>
                      <span>
                        <b>{row.title}</b>
                        <small>
                          {row.id}
                          <br />
                          batch_{String(index + 421).padStart(4, "0")}
                        </small>
                      </span>
                    </div>
                  </td>
                  <td>
                    <span
                      className={`type-chip type-chip--${row.type.toLowerCase()}`}
                    >
                      {row.type}
                    </span>
                  </td>
                  <td>{row.date}</td>
                  <td>
                    <b>{row.images}</b>
                  </td>
                  <td>
                    <b>{row.records}</b>
                  </td>
                  <td>
                    <span className={`mode mode--${row.mode.toLowerCase()}`}>
                      <i />
                      {row.mode}
                    </span>
                  </td>
                  <td>
                    <div className="progress-cell">
                      <div>
                        <StatusChip status={row.status} />
                        <span>{row.progress}%</span>
                      </div>
                      <span className={`progress progress--${row.status}`}>
                        <i style={{ width: `${row.progress}%` }} />
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className={`readiness readiness--${row.status}`}>
                      <i />
                      <span>
                        <b>{row.readiness}</b>
                        <small>
                          {row.status === "complete"
                            ? "OCR processing complete"
                            : row.status === "review"
                              ? "2 issues detected"
                              : "Processing in progress"}
                        </small>
                      </span>
                    </div>
                  </td>
                  <td>
                    <Button
                      variant={
                        row.status === "pending" || row.status === "processing"
                          ? "outlined"
                          : "contained"
                      }
                      disabled={row.status === "pending"}
                    >
                      {row.status === "processing"
                        ? "View progress"
                        : "Review images"}
                    </Button>
                  </td>
                  <td>
                    <IconButton
                      icon="more"
                      label={`More actions for ${row.title}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visibleRows.length && (
            <div className="empty-state">
              <span className="document-icon">
                <Icon name="search" />
              </span>
              <h2>No records found</h2>
              <p>Try adjusting your search or filters.</p>
            </div>
          )}
        </div>
        <div className="table-footer">
          <span>
            Showing {visibleRows.length} of {rows.length} records
          </span>
          <div>
            <span>
              Rows per page: <b>10</b>
            </span>
            <span>
              1–{visibleRows.length} of {visibleRows.length}
            </span>
            <IconButton icon="chevron" label="Next page" />
          </div>
        </div>
      </Card>
    </main>
  )
}

type PipelineState = "pending" | "running" | "complete" | "warning" | "failed"

const processingStages = [
  {
    title: "Upload complete",
    detail: "The accepted image batch is securely available.",
  },
  {
    title: "Preparing images",
    detail: "Images are being normalized for accurate recognition.",
  },
  {
    title: "Running OCR",
    detail:
      "Orthodox Metrics is reading the accepted images and identifying structured record data.",
  },
  {
    title: "Extracting records",
    detail: "Baptism entries are being separated into individual records.",
  },
  {
    title: "Matching clergy & locations",
    detail:
      "Detected names and locations are being compared with known church data.",
  },
  {
    title: "Validating fields",
    detail: "Dates, names, and sacramental fields are being checked.",
  },
  {
    title: "Checking for duplicates",
    detail: "Extracted entries are being compared with existing records.",
  },
  {
    title: "Preparing records for review",
    detail: "Extracted records are being prepared for human verification.",
  },
] as const

const workflowSteps = [
  "Upload",
  "Image Review",
  "Processing",
  "Record Review",
  "Final Audit",
]

function WorkflowStepper({
  current,
  maxReached = current,
  onNavigate,
}: {
  current: number
  maxReached?: number
  onNavigate?: (step: number) => void
}) {
  return (
    <ol className="workflow-stepper" aria-label="Record digitization progress">
      {workflowSteps.map((step, index) => {
        const reached = index <= maxReached
        const complete =
          index < current || (index < maxReached && index !== current)
        return (
          <li
            key={step}
            className={`${complete ? "complete" : ""} ${
              index === current ? "active" : ""
            } ${reached && index !== current ? "clickable" : ""}`}
          >
            <button
              type="button"
              className="workflow-step-button"
              disabled={!reached || index === current}
              onClick={() => onNavigate?.(index)}
            >
              <span className="workflow-marker">
                {complete ? <Icon name="check" size={14} /> : index + 1}
              </span>
              <b>{step}</b>
            </button>
            {index < workflowSteps.length - 1 && <i />}
          </li>
        )
      })}
    </ol>
  )
}

type ImageQuality = "Good quality" | "Needs review" | "Flagged" | "Duplicate" | "Failed upload"

type ReviewPageImage = {
  id: number
  name: string
  quality: ImageQuality
  accepted: boolean
  issue?: string
  preview?: string
}

function pagesFromBatch(batch: BatchState): ReviewPageImage[] {
  return batch.files.map((name, index) => ({
    id: index + 1,
    name,
    quality: "Good quality" as ImageQuality,
    accepted: true,
    preview: batch.previews[index],
  }))
}

function ImageReviewPage({
  batch,
  setBatch,
  workflow = fallbackWorkflowNavigation,
  goToProcessing,
}: {
  batch: BatchState
  setBatch: Dispatch<SetStateAction<BatchState>>
  workflow?: WorkflowNavigation
  goToProcessing: (reprocess: boolean) => void
}) {
  const [pages, setPages] = useState<ReviewPageImage[]>(() => pagesFromBatch(batch))
  const [selectedPageId, setSelectedPageId] = useState(1)
  const [filter, setFilter] = useState<"all" | "flagged">("all")
  const [zoom, setZoom] = useState(82)
  const [rotation, setRotation] = useState(0)
  const [flagOpen, setFlagOpen] = useState(false)
  const [flagReason, setFlagReason] = useState("Glare")
  const [flagNotes, setFlagNotes] = useState("")
  const [rechecking, setRechecking] = useState(false)
  const [changesDetected, setChangesDetected] = useState(false)

  useEffect(() => {
    if (workflow.maxReached !== 0) return
    setPages(pagesFromBatch(batch))
  }, [batch.files, batch.previews, workflow.maxReached])

  const selectedPage =
    pages.find((page) => page.id === selectedPageId) ?? pages[0]
  const flaggedPages = pages.filter(
    (page) =>
      page.quality === "Flagged" ||
      page.quality === "Needs review" ||
      page.quality === "Duplicate" ||
      page.quality === "Failed upload",
  )
  const visiblePages = filter === "all" ? pages : flaggedPages
  const passed = pages.filter((page) => page.quality === "Good quality").length
  const duplicates = pages.filter((page) => page.quality === "Duplicate").length
  const failed = pages.filter((page) => page.quality === "Failed upload").length
  const markDownstreamChange = () => {
    if (workflow.maxReached >= 2) setChangesDetected(true)
  }

  const acceptPage = () => {
    setPages((current) =>
      current.map((page) =>
        page.id === selectedPage.id
          ? {
              ...page,
              accepted: true,
              quality: "Good quality",
              issue: undefined,
            }
          : page,
      ),
    )
    const next = pages.find((page) => page.id > selectedPage.id)
    if (next) setSelectedPageId(next.id)
    markDownstreamChange()
  }

  const replacePage = () => {
    const replacementName = `replacement_page_${String(selectedPage.id).padStart(2, "0")}.jpg`
    setPages((current) =>
      current.map((page) =>
        page.id === selectedPage.id
          ? {
              ...page,
              name: replacementName,
              quality: "Needs review",
              accepted: false,
              issue: "Replacement image is being quality checked",
            }
          : page,
      ),
    )
    setBatch((current) => ({
      ...current,
      files: current.files.map((file, index) =>
        index === selectedPage.id - 1 ? replacementName : file,
      ),
    }))
    markDownstreamChange()
    window.setTimeout(() => {
      setPages((current) =>
        current.map((page) =>
          page.id === selectedPage.id
            ? {
                ...page,
                quality: "Good quality",
                accepted: true,
                issue: undefined,
              }
            : page,
        ),
      )
    }, 900)
  }

  const addPage = () => {
    const id = pages.length + 1
    const name = `manville_marriages_1970_page_${String(id).padStart(2, "0")}.jpg`
    setPages((current) => [
      ...current,
      {
        id,
        name,
        quality: "Good quality",
        accepted: true,
      },
    ])
    setBatch((current) => ({ ...current, files: [...current.files, name] }))
    setSelectedPageId(id)
    markDownstreamChange()
  }

  const recheckQuality = () => {
    setRechecking(true)
    window.setTimeout(() => {
      setPages((current) =>
        current.map((page) =>
          page.quality === "Needs review"
            ? {
                ...page,
                quality: "Good quality",
                accepted: true,
                issue: undefined,
              }
            : page,
        ),
      )
      setRechecking(false)
    }, 900)
  }

  const submitFlag = () => {
    setPages((current) =>
      current.map((page) =>
        page.id === selectedPage.id
          ? {
              ...page,
              quality:
                flagReason === "Duplicate"
                  ? "Duplicate"
                  : flagReason === "Unreadable"
                    ? "Failed upload"
                    : "Flagged",
              accepted: false,
              issue: `${flagReason}${flagNotes ? ` — ${flagNotes}` : ""}`,
            }
          : page,
      ),
    )
    setFlagOpen(false)
    setFlagNotes("")
    markDownstreamChange()
  }

  return (
    <main className="page page--image-review">
      <WorkflowStepper
        current={1}
        maxReached={workflow.maxReached}
        onNavigate={workflow.onNavigate}
      />
      <div className="page-title image-review-title">
        <div>
          <h1>Image QR Review</h1>
          <p>
            {batch.church || "Selected parish"} —{" "}
            {batch.files[0] || "uploaded pages"} — review source pages before
            extraction begins.
          </p>
        </div>
        <div className="image-filter">
          <button
            type="button"
            className={filter === "all" ? "active" : ""}
            onClick={() => setFilter("all")}
          >
            All pages ({pages.length})
          </button>
          <button
            type="button"
            className={filter === "flagged" ? "active" : ""}
            onClick={() => setFilter("flagged")}
          >
            Flagged ({flaggedPages.length})
          </button>
        </div>
      </div>

      {changesDetected && (
        <div className="image-change-alert">
          <Icon name="alert" size={18} />
          <span>
            <b>Changes detected — processing must be run again.</b>
            <small>
              Downstream review history is preserved until you explicitly
              reprocess this batch.
            </small>
          </span>
        </div>
      )}

      <div className="image-review-layout">
        <Card className="page-thumbnails">
          {visiblePages.length ? (
            visiblePages.map((page) => (
              <button
                type="button"
                className={`page-thumbnail ${
                  selectedPage?.id === page.id ? "selected" : ""
                }`}
                key={page.id}
                onClick={() => setSelectedPageId(page.id)}
              >
                <span className="thumbnail-ledger">
                  <i />
                </span>
                <b>Page {String(page.id).padStart(2, "0")}</b>
                <small
                  className={`quality-dot quality-dot--${page.quality
                    .toLowerCase()
                    .replaceAll(" ", "-")}`}
                />
              </button>
            ))
          ) : (
            <div className="thumbnail-empty">
              <span className="empty-icon">
                <Icon name="image" size={24} />
              </span>
              <b>No flagged pages</b>
              <Button variant="text" onClick={() => setFilter("all")}>
                View all
              </Button>
            </div>
          )}
        </Card>

        <Card className="image-viewer-card">
          <div className="image-viewer-header">
            <h2>Page {String(selectedPage?.id ?? 1).padStart(2, "0")}</h2>
            <span
              className={`image-quality image-quality--${selectedPage?.quality
                .toLowerCase()
                .replaceAll(" ", "-")}`}
            >
              <i />
              {selectedPage?.quality}
            </span>
          </div>
          <div className="viewer-toolbar">
            <IconButton
              icon="close"
              label="Zoom out"
              onClick={() => setZoom((value) => Math.max(40, value - 10))}
            />
            <span>{zoom}%</span>
            <IconButton
              icon="plus"
              label="Zoom in"
              onClick={() => setZoom((value) => Math.min(150, value + 10))}
            />
            <Button variant="outlined" onClick={() => setZoom(92)}>
              Fit Width
            </Button>
            <Button variant="text" onClick={() => setZoom(72)}>
              Fit Page
            </Button>
            <Button variant="text" onClick={() => setZoom(100)}>
              Fit Content
            </Button>
            <IconButton
              icon="rotateLeft"
              label="Rotate left"
              onClick={() => setRotation((value) => value - 90)}
            />
            <IconButton
              icon="rotateRight"
              label="Rotate right"
              onClick={() => setRotation((value) => value + 90)}
            />
            <IconButton icon="image" label="Crop or frame" />
            <IconButton icon="grid" label="Viewer settings" />
          </div>
          <SourceLedger
            zoom={zoom}
            rotation={rotation}
            activeFieldIndex={selectedPage?.id ?? 0}
            src={selectedPage?.preview}
          />
          <div className="image-review-message">
            <Icon
              name={failed ? "alert" : flaggedPages.length ? "info" : "check"}
              size={17}
            />
            <span>
              {failed
                ? `${failed} page must be replaced before processing.`
                : flaggedPages.length
                  ? `${flaggedPages.length} page issue is retained for operator review.`
                  : "All pages passed automated job-level checks. Manual inspection is optional."}
            </span>
          </div>
          <div className="image-page-actions">
            <Button icon="check" onClick={acceptPage}>
              Accept Page
            </Button>
            <Button variant="outlined" icon="upload" onClick={replacePage}>
              Replace Page
            </Button>
            <Button
              variant="outlined"
              icon="alert"
              onClick={() => setFlagOpen(true)}
            >
              Flag Issue
            </Button>
          </div>
        </Card>

        <aside className="image-review-sidebar">
          <Card className="batch-quality-card">
            <h2>Batch summary</h2>
            {[
              ["Total pages", pages.length, "neutral"],
              ["Passed", passed, "success"],
              ["Flagged", flaggedPages.length, "warning"],
              ["Duplicates", duplicates, "preset"],
              ["Failed uploads", failed, "error"],
            ].map(([label, count, tone]) => (
              <span
                className={`quality-summary quality-summary--${tone}`}
                key={label}
              >
                <small>{label}</small>
                <b>{count}</b>
              </span>
            ))}
          </Card>
          <Card className="issues-card">
            <div className="issues-heading">
              <Icon name="records" size={18} />
              <h2>Issues found</h2>
            </div>
            {flaggedPages.length ? (
              flaggedPages.map((page) => (
                <button
                  type="button"
                  key={page.id}
                  onClick={() => setSelectedPageId(page.id)}
                >
                  <b>Page {String(page.id).padStart(2, "0")}</b>
                  <small>{page.issue}</small>
                </button>
              ))
            ) : (
              <p>No job-level issues on these pages.</p>
            )}
          </Card>
          <Button variant="outlined" icon="plus" onClick={addPage}>
            Add more pages
          </Button>
          <Button
            variant="outlined"
            icon="sync"
            disabled={rechecking}
            onClick={recheckQuality}
          >
            {rechecking ? "Checking quality..." : "Recheck page quality"}
          </Button>
          <Button
            className="continue-processing"
            disabled={failed > 0}
            onClick={() => {
              goToProcessing(changesDetected)
              setChangesDetected(false)
            }}
          >
            {changesDetected ? "Reprocess Batch" : "Continue to processing"}{" "}
            <Icon name="arrow" size={17} />
          </Button>
          <p className="image-continue-note">
            {failed
              ? "Replace failed uploads before continuing."
              : "Automated checks passed — processing is the next step."}
          </p>
        </aside>
      </div>

      {flagOpen && (
        <div className="dialog-scrim">
          <section className="reject-dialog" role="dialog" aria-modal="true">
            <div className="dialog-header">
              <span className="summary-icon">
                <Icon name="alert" size={18} />
              </span>
              <div>
                <h2>Flag page {String(selectedPage?.id).padStart(2, "0")}</h2>
                <p>Record the image issue before extraction begins.</p>
              </div>
              <IconButton
                icon="close"
                label="Close flag dialog"
                onClick={() => setFlagOpen(false)}
              />
            </div>
            <div className="dialog-body">
              <span className="dialog-label">Issue reason</span>
              <Select
                label="Issue reason"
                value={flagReason}
                onChange={setFlagReason}
              >
                <option>Blur</option>
                <option>Glare</option>
                <option>Bad crop</option>
                <option>Wrong orientation</option>
                <option>Duplicate</option>
                <option>Not a record page</option>
                <option>Unreadable</option>
                <option>Other</option>
              </Select>
              <label className="dialog-textarea">
                <span>Optional notes</span>
                <textarea
                  rows={3}
                  value={flagNotes}
                  onChange={(event) => setFlagNotes(event.target.value)}
                  placeholder="Add context for this issue"
                />
              </label>
            </div>
            <div className="dialog-actions">
              <Button variant="text" onClick={() => setFlagOpen(false)}>
                Cancel
              </Button>
              <Button className="button--error" onClick={submitFlag}>
                Flag page
              </Button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

function ProcessingStateIcon({ state }: { state: PipelineState }) {
  return (
    <span className={`pipeline-state pipeline-state--${state}`}>
      {state === "complete" || state === "warning" ? (
        <Icon name={state === "warning" ? "alert" : "check"} size={17} />
      ) : state === "failed" ? (
        <Icon name="close" size={17} />
      ) : state === "running" ? (
        <span className="spinner" />
      ) : (
        <span className="pending-dot" />
      )}
    </span>
  )
}

function BatchSummary({
  elapsed,
  batch,
}: {
  elapsed: number
  batch: BatchState
}) {
  const summary = [
    {
      icon: "records",
      label: "Upload #",
      value: `${batch.batchId}.jpg`,
    },
    {
      icon: "records",
      label: "Source file",
      value: batch.files[0] ?? "No source file",
    },
    {
      icon: "church",
      label: "Church",
      value: batch.church,
    },
    {
      icon: "layers",
      label: "Record type",
      value: batch.recordType,
      chip: true,
    },
    { icon: "image", label: "Images", value: String(batch.files.length) },
    { icon: "settings", label: "Mode", value: "Automatic", chip: true },
    {
      icon: "clock",
      label: "Elapsed",
      value: `00:${String(elapsed).padStart(2, "0")}`,
    },
  ]

  return (
    <Card className="batch-summary">
      {summary.map((item) => (
        <div className="batch-summary__item" key={item.label}>
          <span className="summary-icon">
            <Icon name={item.icon} size={19} />
          </span>
          <span>
            <small>{item.label}</small>
            {item.chip ? (
              <b className="summary-chip">{item.value}</b>
            ) : (
              <b>{item.value}</b>
            )}
          </span>
        </div>
      ))}
    </Card>
  )
}

function ProcessingPage({
  goToRecordReview,
  workflow = fallbackWorkflowNavigation,
  runId,
  started,
  batch,
  churchId,
}: {
  goToRecordReview: () => void
  workflow?: WorkflowNavigation
  runId: number
  started: boolean
  batch: BatchState
  churchId: number | null
}) {
  const live = batch.jobIds.length > 0 && churchId != null
  const [activeStage, setActiveStage] = useState(1)
  const [elapsed, setElapsed] = useState(0)
  const [failedStage, setFailedStage] = useState<number | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [liveJobs, setLiveJobs] = useState<OmOcrJob[]>([])
  const [liveError, setLiveError] = useState<string | null>(null)
  const complete =
    activeStage >= processingStages.length && failedStage === null

  useEffect(() => {
    if (!started || !live || !churchId) return
    let cancelled = false
    const tick = async () => {
      try {
        const all = await fetchOcrJobs(churchId, { limit: 200 })
        const mine = all.filter((job) => batch.jobIds.includes(String(job.id)))
        if (cancelled) return
        setLiveJobs(mine)
        setLiveError(null)
        if (mine.length === 0) return
        const failedJobs = mine.filter(
          (job) => job.status === "failed" || job.status === "error",
        )
        if (failedJobs.length === mine.length) {
          setFailedStage(wizardProcessingStepIndex(mine))
          return
        }
        if (mine.every((job) => isJobTerminal(job))) {
          setFailedStage(null)
          setActiveStage(processingStages.length)
          return
        }
        setFailedStage(null)
        setActiveStage(wizardProcessingStepIndex(mine))
      } catch (err: unknown) {
        if (!cancelled) {
          setLiveError(err instanceof Error ? err.message : "Could not refresh processing status")
        }
      }
    }
    tick()
    const timer = window.setInterval(tick, 4000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [batch.jobIds, churchId, live, runId, started])

  useEffect(() => {
    if (live || !started || complete || failedStage !== null) return
    const timer = window.setTimeout(
      () => setActiveStage((current) => current + 1),
      1800,
    )
    return () => window.clearTimeout(timer)
  }, [activeStage, complete, failedStage, live, started])

  useEffect(() => {
    if (!started || complete || failedStage !== null) return
    const timer = window.setInterval(
      () => setElapsed((value) => value + 1),
      1000,
    )
    return () => window.clearInterval(timer)
  }, [complete, failedStage, started])

  useEffect(() => {
    if (!runId) return
    setActiveStage(live ? wizardProcessingStepIndex(liveJobs) : 1)
    setElapsed(0)
    setFailedStage(null)
    setShowDetails(false)
  }, [runId])

  const stageState = (index: number): PipelineState => {
    if (failedStage === index) return "failed"
    if (index === activeStage && !complete) return "running"
    if (index < activeStage || complete) {
      if (!live && index === 4) return "warning"
      return "complete"
    }
    return "pending"
  }

  const imageCount = Math.max(1, batch.files.length)
  const liveRecordsFound = liveJobs.reduce(
    (sum, job) => sum + (typeof job.records_count === "number" ? job.records_count : 0),
    0,
  )
  const processedImages = live
    ? liveJobs.filter((job) => isJobTerminal(job)).length
    : activeStage < 2
      ? 0
      : Math.min(imageCount, Math.max(1, activeStage - 1))
  const remainingImages = imageCount - processedImages
  const targetRecords = imageCount * 3
  const recordsFound = live
    ? liveRecordsFound
    : activeStage < 3
      ? 0
      : activeStage === 3
        ? Math.ceil(targetRecords / 3)
        : activeStage === 4
          ? Math.ceil((targetRecords * 2) / 3)
          : targetRecords
  const reviewRecords = activeStage < 4 ? 0 : recordsFound
  const currentStage = processingStages[Math.min(activeStage, 7)]

  const retryStage = () => {
    setShowDetails(false)
    setFailedStage(null)
    setElapsed((value) => value + 1)
  }

  const resetSimulation = () => {
    setActiveStage(1)
    setElapsed(10)
    setFailedStage(null)
    setShowDetails(false)
  }

  return (
    <main className="page page--processing">
      <div className="page-title processing-title">
        <div>
          <h1>Processing Records</h1>
          <p>
            Orthodox Metrics is actively processing the accepted image batch.
          </p>
        </div>
        <span
          className={`processing-status ${
            failedStage !== null
              ? "processing-status--failed"
              : complete
                ? "processing-status--complete"
                : ""
          }`}
        >
          {failedStage !== null ? (
            <Icon name="alert" size={17} />
          ) : complete ? (
            <Icon name="check" size={17} />
          ) : (
            <span className="spinner" />
          )}
          {failedStage !== null
            ? "Processing failed"
            : complete
              ? "Processing complete"
              : "Processing"}
        </span>
      </div>

      <WorkflowStepper
        current={2}
        maxReached={workflow.maxReached}
        onNavigate={workflow.onNavigate}
      />
      <BatchSummary elapsed={elapsed} batch={batch} />

      <div className="processing-layout">
        <Card className="pipeline-card">
          <div className="pipeline-header">
            <span className="summary-icon">
              <Icon name="sync" size={20} />
            </span>
            <div>
              <h2>Live overview</h2>
              <p>All processing stages, top to bottom</p>
            </div>
            <div className="pipeline-tools">
              {!live && !complete && failedStage === null && (
                <Button
                  variant="text"
                  icon="alert"
                  onClick={() => setFailedStage(activeStage)}
                >
                  Simulate issue
                </Button>
              )}
              {!live && (
                <Button variant="text" icon="sync" onClick={resetSimulation}>
                  Restart
                </Button>
              )}
            </div>
          </div>
          <div className="pipeline-list">
            {processingStages.map((stage, index) => {
              const state = stageState(index)
              return (
                <div
                  className={`pipeline-row pipeline-row--${state}`}
                  key={stage.title}
                >
                  <div className="pipeline-rail">
                    <ProcessingStateIcon state={state} />
                    {index < processingStages.length - 1 && <i />}
                  </div>
                  <div className="pipeline-copy">
                    <b>{stage.title}</b>
                    <span>
                      {state === "complete"
                        ? "Complete"
                        : state === "warning"
                          ? "Completed with warnings"
                          : state === "running"
                            ? "Running"
                            : state === "failed"
                              ? "Failed"
                              : "Pending"}
                    </span>
                    {state === "running" && (
                      <div className="stage-progress">
                        <i />
                      </div>
                    )}
                    {state === "warning" && (
                      <small>
                        Some matches need confirmation during record review.
                      </small>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {liveError && (
            <div className="processing-error">
              <span className="alert-icon alert-icon--error">
                <Icon name="alert" size={17} />
              </span>
              <div>
                <b>Could not refresh status</b>
                <p>{liveError}</p>
              </div>
            </div>
          )}
          {failedStage !== null && (
            <div className="processing-error">
              <span className="alert-icon alert-icon--error">
                <Icon name="alert" size={17} />
              </span>
              <div>
                <b>Processing issue detected</b>
                <p>One or more images could not be processed successfully.</p>
                {showDetails && (
                  <small>
                    OCR engine response timed out for image 2 of 3. The original
                    image remains safe and can be retried.
                  </small>
                )}
              </div>
              <Button variant="outlined" icon="sync" onClick={retryStage}>
                Retry stage
              </Button>
              <Button
                variant="text"
                onClick={() => setShowDetails((value) => !value)}
              >
                {showDetails ? "Hide details" : "View details"}
              </Button>
            </div>
          )}
        </Card>

        <aside className="processing-sidebar">
          <Card className="metric-card">
            <div className="metric-heading">
              <span className="summary-icon">
                <Icon name="image" size={19} />
              </span>
              <h2>Images remaining</h2>
              <span>
                {remainingImages} of {imageCount}
              </span>
            </div>
            <div className="metric-value">
              <strong>{remainingImages}</strong>
              <span>of {imageCount}</span>
            </div>
            <span className="metric-progress">
              <i
                style={{ width: `${(processedImages / imageCount) * 100}%` }}
              />
            </span>
            <p>
              {processedImages} of {imageCount} images processed
              {processedImages === imageCount ? " — consumed one by one" : ""}
            </p>
          </Card>

          <Card className="metric-card records-found-card">
            <div className="metric-heading">
              <span className="summary-icon">
                <Icon name="records" size={19} />
              </span>
              <h2>Records found</h2>
            </div>
            <div className="records-total">
              <strong>{recordsFound}</strong>
              <span>extracted</span>
            </div>
            <div className="record-outcomes">
              <span className="outcome outcome--auto">
                <b>0</b>
                <small>Auto</small>
              </span>
              <span className="outcome outcome--review">
                <b>{reviewRecords}</b>
                <small>Review</small>
              </span>
              <span className="outcome outcome--failed">
                <b>{failedStage === null ? 0 : 1}</b>
                <small>Failed</small>
              </span>
            </div>
          </Card>

          <div
            className={`current-stage-card ${
              failedStage !== null ? "current-stage-card--error" : ""
            }`}
          >
            <span className="summary-icon">
              <Icon
                name={
                  failedStage !== null ? "alert" : complete ? "check" : "info"
                }
                size={19}
              />
            </span>
            <div>
              <small>
                {failedStage !== null
                  ? "Blocking issue"
                  : complete
                    ? "Ready for next step"
                    : "Current stage"}
              </small>
              <b>
                {failedStage !== null
                  ? processingStages[failedStage].title
                  : complete
                    ? "Processing complete"
                    : currentStage.title}
              </b>
              <p>
                {failedStage !== null
                  ? "Processing is paused until this stage is retried successfully."
                  : complete
                    ? "All images have been processed and the extracted records are ready for review."
                    : currentStage.detail}
              </p>
            </div>
          </div>

          <div className="background-note">
            <Icon name="info" size={18} />
            <p>
              <b>Processing continues in the background.</b>
              You can safely leave this page and return later.
            </p>
          </div>

          <Button
            className="continue-button"
            disabled={!complete || failedStage !== null}
            onClick={goToRecordReview}
          >
            Continue to record review <Icon name="arrow" size={18} />
          </Button>
          <p className="continue-note">
            {complete
              ? "Automated processing checks passed — record review is the next step."
              : failedStage !== null
                ? "Resolve the blocking issue before continuing."
                : "Processing continues automatically. You can safely leave this page and return later."}
          </p>
        </aside>
      </div>
    </main>
  )
}

type ReviewMode = "simple" | "detailed"
type ReviewFilter = "all" | "attention" | "reviewed"
type ReviewStatus = "Unreviewed" | "In Review" | "Reviewed" | "Skipped" | "Rejected" | "Needs Attention"
type FieldConfidence = "High" | "Medium" | "Low" | "Modified" | "Confirmed"

type ReviewField = {
  id: string
  label: string
  value: string
  original: string
  confidence: FieldConfidence
  large?: boolean
  flagged?: boolean
}

type ReviewRecord = {
  id: number
  type: "Marriage"
  status: ReviewStatus
  rejectReason?: string
  fields: ReviewField[]
}

const baseReviewFields: ReviewField[] = [
  {
    id: "date",
    label: "Marriage Date",
    value: "2-14-70",
    original: "2-14-70",
    confidence: "High",
  },
  {
    id: "groomFirst",
    label: "Groom's First Name",
    value: "HARRY",
    original: "HARRY",
    confidence: "High",
  },
  {
    id: "groomLast",
    label: "Groom's Last Name",
    value: "GUSTICH",
    original: "GUSTICH",
    confidence: "High",
  },
  {
    id: "groomParents",
    label: "Groom's Parents",
    value: "PAUL and MARY",
    original: "PAUL and MARY",
    confidence: "Medium",
  },
  {
    id: "brideFirst",
    label: "Bride's First Name",
    value: "LEONA M.",
    original: "LEONA M.",
    confidence: "High",
  },
  {
    id: "brideLast",
    label: "Bride's Last Name",
    value: "HOUSTON",
    original: "HOUSTON",
    confidence: "High",
  },
  {
    id: "brideParents",
    label: "Bride's Parents",
    value: "VICTOR and IOLA",
    original: "VICTOR and IOLA",
    confidence: "High",
  },
  {
    id: "witnesses",
    label: "Witnesses",
    value:
      "MR. GEORGE GRABANIA, 1311 TERRILL ROAD, SCOTCH PLAINS, NEW JERSEY; MRS. LYDIA GRABANIA, 1311 TERRILL ROAD, SCOTCH PLAINS, NEW JERSEY",
    original:
      "MR. GEORGE GRABANIA, 1311 TERRILL ROAD, SCOTCH PLAINS, NEW JERSEY; MRS. LYDIA GRABANIA, 1311 TERRILL ROAD, SCOTCH PLAINS, NEW JERSEY",
    confidence: "Low",
    large: true,
  },
  {
    id: "license",
    label: "Marriage License",
    value: "FEB. 13, 1970, No. 23 (NORTH PLAINFIELD, N.J.)",
    original: "FEB. 13, 1970, No. 23 (NORTH PLAINFIELD, N.J.)",
    confidence: "High",
  },
  {
    id: "priest",
    label: "Officiating Priest",
    value: "REV. ROBERT A. GEORGE LEWIS",
    original: "REV. ROBERT A. GEORGE LEWIS",
    confidence: "High",
  },
  {
    id: "notes",
    label: "Notes",
    value:
      "Groom details: 57 CODINGTON AVENUE, NORTH PLAINFIELD, N.J., AGE: 44 (AUG. 31, 1925), ORTHODOX CHRISTIAN, 1ST MARRIAGE. Bride details: 57 CODINGTON AVENUE, NORTH PLAINFIELD, N.J., AGE: 51 (JAN. 6, 1919), ORTHODOX CHRISTIAN, 2ND MARRIAGE. License notes: ORTHODOX SACRAMENTAL MARRIAGE FOR THE PREVIOUSLY CONTRACTED CIVIL MARRIAGE ON 30 JUNE 1959. MISSIONARY HOUR CHURCH, 148 E. MAIN STREET, ELKTON, MARYLAND, REV. WILLIAM F. HOPKINS; WITNESSED BY MRS. W. F. HOPKINS.",
    original:
      "Groom details: 57 CODINGTON AVENUE, NORTH PLAINFIELD, N.J., AGE: 44 (AUG. 31, 1925), ORTHODOX CHRISTIAN, 1ST MARRIAGE. Bride details: 57 CODINGTON AVENUE, NORTH PLAINFIELD, N.J., AGE: 51 (JAN. 6, 1919), ORTHODOX CHRISTIAN, 2ND MARRIAGE. License notes: ORTHODOX SACRAMENTAL MARRIAGE FOR THE PREVIOUSLY CONTRACTED CIVIL MARRIAGE ON 30 JUNE 1959. MISSIONARY HOUR CHURCH, 148 E. MAIN STREET, ELKTON, MARYLAND, REV. WILLIAM F. HOPKINS; WITNESSED BY MRS. W. F. HOPKINS.",
    confidence: "Modified",
    large: true,
  },
]

function createReviewRecords(): ReviewRecord[] {
  return Array.from({ length: 9 }, (_, index) => ({
    id: index + 1,
    type: "Marriage" as const,
    status: "Unreviewed" as const,
    fields: baseReviewFields.map((field) => ({
      ...field,
      confidence:
        index === 0
          ? field.confidence
          : field.confidence === "Low" || field.confidence === "Modified"
            ? "High"
            : field.confidence,
    })),
  }))
}

function ReviewFieldControl({
  field,
  focused,
  onFocus,
  onChange,
  onFlag,
}: {
  field: ReviewField
  focused: boolean
  onFocus: () => void
  onChange: (value: string) => void
  onFlag: () => void
}) {
  return (
    <label
      className={`review-field ${field.large ? "review-field--large" : ""} ${
        focused ? "focused" : ""
      }`}
    >
      <span className="review-field__header">
        <small>{field.label}</small>
        <span
          className={`confidence confidence--${field.confidence.toLowerCase()}`}
        >
          <i />
          {field.confidence}
        </span>
        <button
          type="button"
          className={`field-flag ${field.flagged ? "active" : ""}`}
          title={field.flagged ? "Remove attention flag" : "Flag for attention"}
          aria-label={
            field.flagged ? "Remove attention flag" : "Flag for attention"
          }
          onClick={(event) => {
            event.preventDefault()
            onFlag()
          }}
        >
          <Icon name="alert" size={13} />
        </button>
      </span>
      {field.large ? (
        <textarea
          value={field.value}
          onFocus={onFocus}
          onChange={(event) => onChange(event.target.value)}
          rows={field.id === "notes" ? 4 : 3}
        />
      ) : (
        <input
          value={field.value}
          onFocus={onFocus}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {field.confidence === "Modified" && field.value !== field.original && (
        <span className="original-value">Original: {field.original}</span>
      )}
    </label>
  )
}

function SourceLedger({
  zoom,
  rotation,
  activeFieldIndex,
  src,
}: {
  zoom: number
  rotation: number
  activeFieldIndex: number
  src?: string
}) {
  if (src) {
    return (
      <div className="ledger-stage">
        <img
          className="source-photo"
          src={src}
          alt=""
          style={{ transform: `scale(${zoom / 100}) rotate(${rotation}deg)` }}
        />
      </div>
    )
  }
  const columns = [
    "Date",
    "Groom",
    "Parents",
    "Bride",
    "Parents",
    "Witnesses",
    "License",
  ]
  return (
    <div className="ledger-stage">
      <div
        className={`ledger-page ledger-focus-${activeFieldIndex}`}
        style={{ transform: `scale(${zoom / 100}) rotate(${rotation}deg)` }}
      >
        <div className="ledger-heading">
          <b>Marriage Register</b>
          <span>Year 1970</span>
        </div>
        <div className="ledger-grid">
          {columns.map((column, index) => (
            <b key={`${column}-${index}`}>{column}</b>
          ))}
          {Array.from({ length: 35 }, (_, index) => (
            <span key={index}>
              {index % 7 === 0
                ? "2/14"
                : index % 7 === 1
                  ? "H. GUSTICH"
                  : index % 7 === 3
                    ? "LEONA M."
                    : index % 7 === 5
                      ? "G. GRABANIA"
                      : "—"}
            </span>
          ))}
        </div>
        <div className="source-highlight" />
      </div>
    </div>
  )
}

function RecordReviewPage({
  back,
  goToFinalAudit,
  workflow = fallbackWorkflowNavigation,
}: {
  back: () => void
  goToFinalAudit: () => void
  workflow?: WorkflowNavigation
}) {
  const [records, setRecords] = useState(createReviewRecords)
  const [mode, setMode] = useState<ReviewMode>("simple")
  const [filter, setFilter] = useState<ReviewFilter>("all")
  const [currentRecordId, setCurrentRecordId] = useState(1)
  const [activeFieldId, setActiveFieldId] = useState("date")
  const [zoom, setZoom] = useState(82)
  const [rotation, setRotation] = useState(0)
  const [split, setSplit] = useState(52)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState("Not a valid record")
  const [rejectDetails, setRejectDetails] = useState("")
  const autoAdvancedRef = useRef(false)

  const isAttention = (record: ReviewRecord) =>
    record.status !== "Reviewed" &&
    record.status !== "Skipped" &&
    record.status !== "Rejected" &&
    record.fields.some(
      (field) =>
        field.confidence === "Low" ||
        field.confidence === "Modified" ||
        field.flagged,
    )
  const reviewedCount = records.filter(
    (record) => record.status === "Reviewed",
  ).length
  const rejectedCount = records.filter(
    (record) => record.status === "Rejected",
  ).length
  const attentionCount = records.filter(isAttention).length
  const requireReviewCount = records.filter(
    (record) =>
      record.status === "Unreviewed" ||
      record.status === "In Review" ||
      record.status === "Needs Attention",
  ).length
  const visibleRecords = records.filter((record) =>
    filter === "all"
      ? true
      : filter === "attention"
        ? isAttention(record)
        : record.status === "Reviewed",
  )
  const currentRecord =
    records.find((record) => record.id === currentRecordId) ?? records[0]
  const visiblePosition = visibleRecords.findIndex(
    (record) => record.id === currentRecordId,
  )
  const activeFieldIndex = Math.max(
    0,
    currentRecord.fields.findIndex((field) => field.id === activeFieldId),
  )
  const canFinalAudit = requireReviewCount === 0 && attentionCount === 0

  useEffect(() => {
    if (
      visibleRecords.length &&
      !visibleRecords.some((record) => record.id === currentRecordId)
    ) {
      setCurrentRecordId(visibleRecords[0].id)
    }
  }, [currentRecordId, visibleRecords])

  const moveRecord = (direction: number) => {
    if (!visibleRecords.length) return
    const position = Math.max(0, visiblePosition)
    const next =
      (position + direction + visibleRecords.length) % visibleRecords.length
    setCurrentRecordId(visibleRecords[next].id)
    setActiveFieldId("date")
  }

  const updateField = (fieldId: string, value: string) => {
    setRecords((current) =>
      current.map((record) =>
        record.id === currentRecordId
          ? {
              ...record,
              status:
                record.status === "Unreviewed" ? "In Review" : record.status,
              fields: record.fields.map((field) =>
                field.id === fieldId
                  ? { ...field, value, confidence: "Modified" }
                  : field,
              ),
            }
          : record,
      ),
    )
  }

  const focusField = (fieldId: string) => {
    setActiveFieldId(fieldId)
    setRecords((current) =>
      current.map((record) =>
        record.id === currentRecordId && record.status === "Unreviewed"
          ? { ...record, status: "In Review" }
          : record,
      ),
    )
  }

  const toggleFieldFlag = (fieldId: string) => {
    setRecords((current) =>
      current.map((record) => {
        if (record.id !== currentRecordId) return record
        const field = record.fields.find((item) => item.id === fieldId)
        const willFlag = !field?.flagged
        return {
          ...record,
          status: willFlag ? "Needs Attention" : "In Review",
          fields: record.fields.map((item) =>
            item.id === fieldId ? { ...item, flagged: !item.flagged } : item,
          ),
        }
      }),
    )
  }

  const confirmRecord = () => {
    setRecords((current) =>
      current.map((record) =>
        record.id === currentRecordId
          ? {
              ...record,
              status: "Reviewed",
              fields: record.fields.map((field) => ({
                ...field,
                confidence: "Confirmed",
                flagged: false,
              })),
            }
          : record,
      ),
    )
    moveRecord(1)
  }

  const skipRecord = () => {
    setRecords((current) =>
      current.map((record) =>
        record.id === currentRecordId
          ? { ...record, status: "Skipped" }
          : record,
      ),
    )
    moveRecord(1)
  }

  useEffect(() => {
    const allConfirmedOrSkipped = records.every(
      (record) => record.status === "Reviewed" || record.status === "Skipped",
    )
    if (allConfirmedOrSkipped && !autoAdvancedRef.current) {
      autoAdvancedRef.current = true
      goToFinalAudit()
    }
  }, [goToFinalAudit, records])

  const rejectRecord = () => {
    setRecords((current) =>
      current.map((record) =>
        record.id === currentRecordId
          ? {
              ...record,
              status: "Rejected",
              rejectReason: `${rejectReason}${
                rejectDetails ? `: ${rejectDetails}` : ""
              }`,
            }
          : record,
      ),
    )
    setRejectOpen(false)
    setRejectDetails("")
    moveRecord(1)
  }

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (
        rejectOpen ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
      )
        return
      if (event.key.toLowerCase() === "a") confirmRecord()
      if (event.key.toLowerCase() === "s") skipRecord()
      if (event.key.toLowerCase() === "r") setRejectOpen(true)
    }
    window.addEventListener("keydown", handleShortcut)
    return () => window.removeEventListener("keydown", handleShortcut)
  })

  return (
    <main className="page page--review">
      <WorkflowStepper
        current={3}
        maxReached={workflow.maxReached}
        onNavigate={workflow.onNavigate}
      />
      <div className="page-title review-title">
        <div>
          <h1>Record Review &amp; Correction</h1>
          <p>
            mar003-ssppoc-nj01.jpg — 9 records extracted — focus on the records
            that need a human eye.
          </p>
        </div>
        <div className="final-audit-action">
          <Button disabled={!canFinalAudit} onClick={goToFinalAudit}>
            Final audit <Icon name="arrow" size={17} />
          </Button>
          {!canFinalAudit && (
            <small>{requireReviewCount} records still require review.</small>
          )}
        </div>
      </div>

      <div className="review-mode-grid">
        <button
          type="button"
          className={`review-mode-card ${mode === "simple" ? "selected" : ""}`}
          onClick={() => setMode("simple")}
        >
          <span className="summary-icon">
            <Icon name="eye" size={19} />
          </span>
          <span>
            <b>Simple Review</b>
            <small>
              Review extracted information without opening the original scanned
              pages.
            </small>
          </span>
          {mode === "simple" && <Icon name="check" size={17} />}
        </button>
        <button
          type="button"
          className={`review-mode-card ${
            mode === "detailed" ? "selected" : ""
          }`}
          onClick={() => setMode("detailed")}
        >
          <span className="summary-icon">
            <Icon name="records" size={19} />
          </span>
          <span>
            <b>Detailed Review</b>
            <small>
              Compare extracted data directly against the original source page.
            </small>
          </span>
          {mode === "detailed" && <Icon name="check" size={17} />}
        </button>
      </div>

      <div className="review-summary">
        <span className="review-chip review-chip--info">9 records</span>
        <span className="review-chip review-chip--info">
          {requireReviewCount} require review
        </span>
        <span className="review-chip review-chip--warning">
          {attentionCount} need attention
        </span>
        <span className="review-chip review-chip--error">
          {rejectedCount} failed page
        </span>
      </div>

      <Card className="review-navigation">
        <div className="record-position">
          <b>
            Record {visibleRecords.length ? visiblePosition + 1 : 0} of{" "}
            {visibleRecords.length}
          </b>
          <span>
            <i
              className={`record-progress record-progress-${Math.max(
                0,
                visiblePosition + 1,
              )}`}
            />
          </span>
        </div>
        <div className="review-filters">
          {([
            ["all", "All", records.length],
            ["attention", "Attention", attentionCount],
            ["reviewed", "Reviewed", reviewedCount],
          ] as const).map(([value, label, count]) => (
            <button
              type="button"
              key={value}
              className={filter === value ? "active" : ""}
              onClick={() => setFilter(value)}
            >
              {label} ({count})
            </button>
          ))}
        </div>
        <div className="record-paging">
          <IconButton
            icon="chevron"
            label="Previous record"
            className="previous"
            onClick={() => moveRecord(-1)}
          />
          <IconButton
            icon="chevron"
            label="Next record"
            onClick={() => moveRecord(1)}
          />
        </div>
      </Card>

      {!visibleRecords.length ? (
        <Card className="review-empty">
          <span className="empty-icon">
            <Icon name="search" size={30} />
          </span>
          <h2>No records in this filter</h2>
          <p>
            Try All or Reviewed, or continue to final audit when records are
            confirmed.
          </p>
          <Button variant="outlined" onClick={() => setFilter("all")}>
            View all records
          </Button>
          <Button disabled={!canFinalAudit} onClick={goToFinalAudit}>
            Continue to final audit <Icon name="arrow" size={17} />
          </Button>
        </Card>
      ) : mode === "simple" ? (
        <Card className="record-workspace record-workspace--simple">
          <div className="record-card-header">
            <b>Record {currentRecord.id}</b>
            <span className="type-chip type-chip--baptism">Marriage</span>
            <span className="record-status">{currentRecord.status}</span>
          </div>
          <div className="review-fields">
            {currentRecord.fields.map((field) => (
              <ReviewFieldControl
                field={field}
                focused={field.id === activeFieldId}
                key={field.id}
                onFocus={() => focusField(field.id)}
                onChange={(value) => updateField(field.id, value)}
                onFlag={() => toggleFieldFlag(field.id)}
              />
            ))}
          </div>
          <ReviewActions
            recordNumber={currentRecord.id}
            totalRecords={records.length}
            onConfirm={confirmRecord}
            onSkip={skipRecord}
            onReject={() => setRejectOpen(true)}
          />
        </Card>
      ) : (
        <Card className="record-workspace record-workspace--detailed">
          <div
            className="detailed-split"
            style={{ gridTemplateColumns: `${split}% 8px 1fr` }}
          >
            <section className="source-viewer">
              <div className="viewer-toolbar">
                <IconButton
                  icon="close"
                  label="Zoom out"
                  onClick={() => setZoom((value) => Math.max(40, value - 10))}
                />
                <span>{zoom}%</span>
                <IconButton
                  icon="plus"
                  label="Zoom in"
                  onClick={() => setZoom((value) => Math.min(150, value + 10))}
                />
                <Button variant="outlined" onClick={() => setZoom(92)}>
                  Fit Width
                </Button>
                <Button variant="text" onClick={() => setZoom(72)}>
                  Fit Page
                </Button>
                <Button variant="text" onClick={() => setZoom(100)}>
                  Fit Content
                </Button>
                <IconButton
                  icon="rotateLeft"
                  label="Rotate left"
                  onClick={() => setRotation((value) => value - 90)}
                />
                <IconButton
                  icon="rotateRight"
                  label="Rotate right"
                  onClick={() => setRotation((value) => value + 90)}
                />
                <IconButton icon="grid" label="Viewer settings" />
              </div>
              <SourceLedger
                zoom={zoom}
                rotation={rotation}
                activeFieldIndex={activeFieldIndex}
              />
            </section>
            <div
              className="split-handle"
              role="separator"
              aria-label="Resize document and record panels"
              tabIndex={0}
              onPointerDown={(event) =>
                event.currentTarget.setPointerCapture(event.pointerId)
              }
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId))
                  return
                const workspace =
                  event.currentTarget.parentElement?.getBoundingClientRect()
                if (!workspace) return
                setSplit(
                  Math.min(
                    65,
                    Math.max(
                      35,
                      ((event.clientX - workspace.left) / workspace.width) *
                        100,
                    ),
                  ),
                )
              }}
            >
              <span>⋮</span>
            </div>
            <section className="detailed-record-panel">
              <div className="record-card-header">
                <b>Record {currentRecord.id}</b>
                <span className="type-chip type-chip--baptism">Marriage</span>
                <span className="record-status">{currentRecord.status}</span>
              </div>
              <div className="review-fields">
                {currentRecord.fields.map((field) => (
                  <ReviewFieldControl
                    field={field}
                    focused={field.id === activeFieldId}
                    key={field.id}
                    onFocus={() => focusField(field.id)}
                    onChange={(value) => updateField(field.id, value)}
                    onFlag={() => toggleFieldFlag(field.id)}
                  />
                ))}
              </div>
              <ReviewActions
                recordNumber={currentRecord.id}
                totalRecords={records.length}
                onConfirm={confirmRecord}
                onSkip={skipRecord}
                onReject={() => setRejectOpen(true)}
              />
            </section>
          </div>
        </Card>
      )}

      {rejectOpen && (
        <div className="dialog-scrim" role="presentation">
          <section
            className="reject-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reject-title"
          >
            <div className="dialog-header">
              <span className="alert-icon alert-icon--error">
                <Icon name="alert" size={18} />
              </span>
              <div>
                <h2 id="reject-title">Reject record {currentRecord.id}?</h2>
                <p>The extracted data will be retained with the rejection.</p>
              </div>
              <IconButton
                icon="close"
                label="Close dialog"
                onClick={() => setRejectOpen(false)}
              />
            </div>
            <div className="dialog-body">
              <span className="dialog-label">Reason</span>
              <Select
                label="Reject reason"
                value={rejectReason}
                onChange={setRejectReason}
              >
                <option>Not a valid record</option>
                <option>OCR incorrectly detected a record</option>
                <option>Duplicate</option>
                <option>Wrong record type</option>
                <option>Other</option>
              </Select>
              <label className="dialog-textarea">
                <span>Additional details</span>
                <textarea
                  value={rejectDetails}
                  onChange={(event) => setRejectDetails(event.target.value)}
                  placeholder="Optional context for the audit trail"
                  rows={3}
                />
              </label>
            </div>
            <div className="dialog-actions">
              <Button variant="text" onClick={() => setRejectOpen(false)}>
                Cancel
              </Button>
              <Button className="button--error" onClick={rejectRecord}>
                Reject record
              </Button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

function ReviewActions({
  recordNumber,
  totalRecords,
  onConfirm,
  onSkip,
  onReject,
}: {
  recordNumber: number
  totalRecords: number
  onConfirm: () => void
  onSkip: () => void
  onReject: () => void
}) {
  return (
    <div className="review-actions">
      <Button onClick={onConfirm}>
        Confirm Record <kbd>A</kbd>
      </Button>
      <Button variant="outlined" onClick={onSkip}>
        Skip for Now <kbd>S</kbd>
      </Button>
      <Button variant="text" className="reject-button" onClick={onReject}>
        Reject Record <kbd>R</kbd>
      </Button>
      <span className="review-action-position">
        Record <b>{recordNumber}</b> of {totalRecords}
      </span>
    </div>
  )
}

type AuditGroup = "auto" | "corrected" | "failed"
type SeedState = "idle" | "confirm" | "seeding" | "duplicate" | "partial" | "success"
type SeedScenario = "success" | "duplicate" | "partial"

type AuditRecord = {
  id: string
  name: string
  meta: string
  type: "Baptism" | "Marriage" | "Funeral" | "Custom"
  group: AuditGroup
  confidence: string
  status: string
  original: string
  final: string
  validation: string
  reason: string
  reviewer: string
}

const auditRecords: AuditRecord[] = [
  {
    id: "B-1908-0031",
    name: "Andreas Stavros",
    meta: "Corinth · Mar 1, 1908",
    type: "Baptism",
    group: "auto",
    confidence: "98% — High",
    status: "Auto-reviewed",
    original: "ANDREAS STAVROS",
    final: "Andreas Stavros",
    validation: "Required fields passed · No duplicate detected",
    reason: "Meets the required confidence threshold and validation rules.",
    reviewer: "Orthodox Metrics validation",
  },
  {
    id: "B-1915-0112",
    name: "Sofia Manolis",
    meta: "Volos · Nov 3, 1915",
    type: "Baptism",
    group: "auto",
    confidence: "97% — High",
    status: "Auto-reviewed",
    original: "SOFIA MANOLIS",
    final: "Sofia Manolis",
    validation: "Required fields passed · No duplicate detected",
    reason: "Meets the required confidence threshold and validation rules.",
    reviewer: "Orthodox Metrics validation",
  },
  {
    id: "M-1921-0068",
    name: "Dimitrios Rallis",
    meta: "Athens · Jun 12, 1921",
    type: "Marriage",
    group: "auto",
    confidence: "96% — High",
    status: "Auto-reviewed",
    original: "DIMITRIOS RALLIS",
    final: "Dimitrios Rallis",
    validation: "Required fields passed · No duplicate detected",
    reason: "Meets the required confidence threshold and validation rules.",
    reviewer: "Orthodox Metrics validation",
  },
  {
    id: "B-1919-0017",
    name: "Maria Kalogeropoulou",
    meta: "Sparta · Feb 9, 1919",
    type: "Baptism",
    group: "auto",
    confidence: "99% — High",
    status: "Auto-reviewed",
    original: "MARIA KALOGEROPOULOU",
    final: "Maria Kalogeropoulou",
    validation: "Required fields passed · No duplicate detected",
    reason: "Meets the required confidence threshold and validation rules.",
    reviewer: "Orthodox Metrics validation",
  },
  {
    id: "M-1923-0081",
    name: "Ioannis Vlachos",
    meta: "Nafplio · Aug 4, 1923",
    type: "Marriage",
    group: "auto",
    confidence: "95% — High",
    status: "Auto-reviewed",
    original: "IOANNIS VLACHOS",
    final: "Ioannis Vlachos",
    validation: "Required fields passed · No duplicate detected",
    reason: "Meets the required confidence threshold and validation rules.",
    reviewer: "Orthodox Metrics validation",
  },
  {
    id: "B-1920-0044",
    name: "Nikolaos Papadopoulos",
    meta: "Confirmed · Thessaloniki",
    type: "Baptism",
    group: "corrected",
    confidence: "Confirmed by operator",
    status: "Parish-reviewed",
    original: "NIKOLAOS PAPADOPOULOS",
    final: "Nikolaos Papadopoulos",
    validation: "Operator confirmed · Required fields passed",
    reason: "Explicitly confirmed during parish record review.",
    reviewer: "Parish operator",
  },
  {
    id: "B-1918-0092",
    name: "Eleni Georgiou",
    meta: "Corrected · Patras",
    type: "Baptism",
    group: "corrected",
    confidence: "Corrected and confirmed",
    status: "Parish-corrected",
    original: "ELENI GEORGOY",
    final: "Eleni Georgiou",
    validation: "Correction accepted · Required fields passed",
    reason: "OCR surname corrected against the original source page.",
    reviewer: "Parish operator",
  },
  {
    id: "M-1970-0023",
    name: "Petros Manos",
    meta: "Corrected · Volos",
    type: "Marriage",
    group: "corrected",
    confidence: "Corrected and confirmed",
    status: "Parish-corrected",
    original: "PETR0S MANOS / HARY",
    final: "Petros Manos / HARRY",
    validation: "Correction accepted · Required fields passed",
    reason: "First name characters corrected against the source register.",
    reviewer: "Parish operator",
  },
  {
    id: "Record 41",
    name: "Record 41",
    meta: "Insufficient confidence",
    type: "Marriage",
    group: "failed",
    confidence: "41% — Below threshold",
    status: "Excluded",
    original: "Unresolved OCR text",
    final: "No approved final value",
    validation: "Failed required confidence threshold",
    reason: "Insufficient confidence after record review.",
    reviewer: "Retained for future review",
  },
  {
    id: "Record 58",
    name: "Record 58",
    meta: "Source image unreadable",
    type: "Baptism",
    group: "failed",
    confidence: "Unable to evaluate",
    status: "Excluded",
    original: "Unreadable source region",
    final: "No approved final value",
    validation: "Source quality validation failed",
    reason: "The source image is unreadable and requires a better scan.",
    reviewer: "Retained for future review",
  },
]

const seedStages = [
  "Preparing records",
  "Checking duplicates",
  "Writing Baptism records",
  "Writing Marriage records",
  "Verifying inserted records",
  "Finalizing audit",
]

function RecordTypeChip({ type }: { type: AuditRecord["type"] }) {
  return (
    <span className={`type-chip type-chip--${type.toLowerCase()}`}>{type}</span>
  )
}

function FinalAuditPage({
  back,
  goToRecords,
  workflow = fallbackWorkflowNavigation,
}: {
  back: () => void
  goToRecords: () => void
  workflow?: WorkflowNavigation
}) {
  const [expanded, setExpanded] = useState<Record<AuditGroup, boolean>>({
    auto: true,
    corrected: true,
    failed: true,
  })
  const [selectedRecord, setSelectedRecord] = useState<AuditRecord | null>(null)
  const [showSource, setShowSource] = useState(false)
  const [seedState, setSeedState] = useState<SeedState>("idle")
  const [scenario, setScenario] = useState<SeedScenario>("success")
  const [seedStage, setSeedStage] = useState(0)
  const [validationRuns, setValidationRuns] = useState(1)
  const [showSeedError, setShowSeedError] = useState(false)
  const [seedTimestamp, setSeedTimestamp] = useState("")

  useEffect(() => {
    if (seedState !== "seeding") return
    const timer = window.setTimeout(() => {
      if (scenario === "duplicate" && seedStage === 1) {
        setSeedState("duplicate")
        return
      }
      if (scenario === "partial" && seedStage === 3) {
        setSeedState("partial")
        return
      }
      if (seedStage === seedStages.length - 1) {
        setSeedTimestamp(new Date().toLocaleString())
        setSeedState("success")
        return
      }
      setSeedStage((current) => current + 1)
    }, 900)
    return () => window.clearTimeout(timer)
  }, [scenario, seedStage, seedState])

  const groups: {
    id: AuditGroup
    title: string
    status: string
    description: string
    icon: string
  }[] = [
    {
      id: "auto",
      title: "Auto-Reviewed",
      status: "Will be seeded",
      description:
        "Valid at the required confidence threshold and internal validation.",
      icon: "check",
    },
    {
      id: "corrected",
      title: "Parish-Reviewed / Corrected",
      status: "Will be seeded",
      description:
        "Reviewed, corrected, or explicitly resolved during record review.",
      icon: "eye",
    },
    {
      id: "failed",
      title: "Failed / Unresolved",
      status: "Excluded",
      description:
        "Did not make the cut — these will NOT be written to the database.",
      icon: "close",
    },
  ]

  const startSeed = () => {
    setSeedStage(0)
    setSeedState("seeding")
  }

  const retryFailed = () => {
    setScenario("success")
    setSeedStage(3)
    setShowSeedError(false)
    setSeedState("seeding")
  }

  return (
    <main className="page page--final-audit">
      <WorkflowStepper
        current={4}
        maxReached={workflow.maxReached}
        onNavigate={workflow.onNavigate}
      />
      <div className="page-title final-audit-title">
        <div>
          <h1>Final Audit &amp; Seed to Parish Database</h1>
          <p>
            A final once-over before approved records are written. Nothing is
            auto-seeded.
          </p>
        </div>
        <span className="nothing-seeded-chip">
          <Icon name="info" size={15} /> Operator confirmation required
        </span>
      </div>

      <div className="audit-groups">
        {groups.map((group) => {
          const records = auditRecords.filter(
            (record) => record.group === group.id,
          )
          return (
            <Card
              className={`audit-group audit-group--${group.id}`}
              key={group.id}
            >
              <button
                type="button"
                className="audit-group__header"
                onClick={() =>
                  setExpanded((current) => ({
                    ...current,
                    [group.id]: !current[group.id],
                  }))
                }
                aria-expanded={expanded[group.id]}
              >
                <span className="audit-group__icon">
                  <Icon name={group.icon} size={17} />
                </span>
                <span>
                  <b>{group.title}</b>
                  <small>
                    {group.id === "failed" ? (
                      <Icon name="alert" size={11} />
                    ) : (
                      <Icon name="check" size={11} />
                    )}
                    {group.status}
                  </small>
                </span>
                <strong>{records.length}</strong>
                <span
                  className={`audit-chevron ${
                    expanded[group.id] ? "expanded" : ""
                  }`}
                >
                  <Icon name="chevron" size={16} />
                </span>
              </button>
              {expanded[group.id] && (
                <div className="audit-group__body">
                  <p>{group.description}</p>
                  <div className="audit-record-list">
                    {records.map((record) => (
                      <button
                        type="button"
                        className="audit-record"
                        key={record.id}
                        onClick={() => {
                          setShowSource(false)
                          setSelectedRecord(record)
                        }}
                      >
                        <span>
                          <b>{record.name}</b>
                          <small>{record.meta}</small>
                        </span>
                        <RecordTypeChip type={record.type} />
                        <Icon name="chevron" size={14} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )
        })}
      </div>

      {seedState === "seeding" ? (
        <Card className="seed-progress-card">
          <div className="seed-progress-heading">
            <span className="summary-icon">
              <span className="spinner" />
            </span>
            <div>
              <h2>Adding approved records</h2>
              <p>
                Records are validated and verified before the batch is marked
                complete.
              </p>
            </div>
            <b>{Math.round(((seedStage + 0.5) / seedStages.length) * 100)}%</b>
          </div>
          <span className="seed-progress-bar">
            <i
              className={`seed-progress-width-${Math.min(
                seedStages.length,
                seedStage + 1,
              )}`}
            />
          </span>
          <div className="seed-stage-list">
            {seedStages.map((stage, index) => {
              const state =
                index < seedStage
                  ? "passed"
                  : index === seedStage
                    ? "running"
                    : "pending"
              return (
                <div className={`seed-stage seed-stage--${state}`} key={stage}>
                  <ProcessingStateIcon
                    state={
                      state === "passed"
                        ? "complete"
                        : state === "running"
                          ? "running"
                          : "pending"
                    }
                  />
                  <span>
                    <b>{stage}</b>
                    <small>
                      {state === "passed"
                        ? "Passed"
                        : state === "running"
                          ? "Running"
                          : "Pending"}
                    </small>
                  </span>
                </div>
              )
            })}
          </div>
        </Card>
      ) : seedState === "duplicate" ? (
        <Card className="seed-result seed-result--warning">
          <span className="seed-result__icon">
            <Icon name="alert" size={24} />
          </span>
          <div>
            <h2>Duplicate Review Required</h2>
            <p>
              Sofia Manolis was not inserted because a possible parish record
              already exists. No existing record was overwritten.
            </p>
            <div className="seed-result__actions">
              <Button
                variant="outlined"
                onClick={() => setSelectedRecord(auditRecords[1])}
              >
                View existing record
              </Button>
              <Button
                variant="outlined"
                onClick={() => setSelectedRecord(auditRecords[1])}
              >
                View incoming record
              </Button>
              <Button onClick={back}>Return to Review</Button>
            </div>
          </div>
        </Card>
      ) : seedState === "partial" ? (
        <Card className="seed-result seed-result--error">
          <span className="seed-result__icon">
            <Icon name="alert" size={24} />
          </span>
          <div>
            <h2>7 seeded successfully · 1 database write failed</h2>
            <p>
              Petros Manos was not inserted. The seven successful insertions and
              failed outcome are preserved in the batch audit.
            </p>
            {showSeedError && (
              <div className="seed-error-detail">
                Database constraint timeout for record M-1970-0023. No partial
                row was retained.
              </div>
            )}
            <div className="seed-result__actions">
              <Button icon="sync" onClick={retryFailed}>
                Retry failed record
              </Button>
              <Button
                variant="outlined"
                onClick={() => setShowSeedError((value) => !value)}
              >
                {showSeedError ? "Hide error" : "View error"}
              </Button>
              <Button variant="text" onClick={goToRecords}>
                Return to dashboard
              </Button>
            </div>
          </div>
        </Card>
      ) : seedState === "success" ? (
        <Card className="seed-success">
          <div className="seed-success__hero">
            <span className="seed-success__icon">
              <Icon name="check" size={26} />
            </span>
            <div>
              <h2>Records Added Successfully</h2>
              <p>8 approved records were added to the parish database.</p>
            </div>
          </div>
          <div className="seed-success__counts">
            <span>
              <b>5</b>
              <small>Auto-Reviewed — Seeded</small>
            </span>
            <span>
              <b>3</b>
              <small>Parish-Reviewed / Corrected — Seeded</small>
            </span>
            <span>
              <b>2</b>
              <small>Failed / Unresolved — Excluded</small>
            </span>
          </div>
          <div className="audit-metadata">
            <span>
              <small>Seed completed</small>
              <b>{seedTimestamp}</b>
            </span>
            <span>
              <small>Parish</small>
              <b>Saints Peter &amp; Paul — Manville, NJ (#46)</b>
            </span>
            <span>
              <small>Batch ID</small>
              <b>mar003-ssppoc-nj01</b>
            </span>
            <span>
              <small>Operator</small>
              <b>Niko Karras</b>
            </span>
            <span>
              <small>Records inserted</small>
              <b>B-1908-0031 through M-1970-0023 · 8 IDs</b>
            </span>
            <span>
              <small>Audit record</small>
              <b>AUD-OM-2026-1048 · Permanent</b>
            </span>
          </div>
          <div className="seed-success__actions">
            <Button onClick={goToRecords}>View Seeded Records</Button>
            <Button variant="outlined">View Batch Audit</Button>
            <Button variant="text" onClick={goToRecords}>
              Return to Records
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="seed-summary-bar">
          <span className="summary-icon">
            <Icon name="records" size={19} />
          </span>
          <div>
            <h2>8 approved records will be seeded to the parish database</h2>
            <p>
              5 auto-reviewed + 3 parish-reviewed. 2 failed records stay with
              the batch and remain visible from the dashboard.
            </p>
          </div>
          <Button icon="records" onClick={() => setSeedState("confirm")}>
            Add Approved Records to Parish Database{" "}
            <Icon name="arrow" size={17} />
          </Button>
        </Card>
      )}

      {selectedRecord && (
        <>
          <div
            className="audit-drawer-scrim"
            onClick={() => setSelectedRecord(null)}
          />
          <aside className="audit-drawer">
            <div className="drawer-header">
              <div>
                <h2>{selectedRecord.name}</h2>
                <p>{selectedRecord.id}</p>
              </div>
              <IconButton
                icon="close"
                label="Close record details"
                onClick={() => setSelectedRecord(null)}
              />
            </div>
            {showSource && (
              <div className="audit-source-preview">
                <SourceLedger
                  zoom={55}
                  rotation={0}
                  activeFieldIndex={selectedRecord.group === "failed" ? 7 : 1}
                />
              </div>
            )}
            <div className="audit-drawer__content">
              <div className="drawer-record-heading">
                <RecordTypeChip type={selectedRecord.type} />
                <span
                  className={`review-chip ${
                    selectedRecord.group === "failed"
                      ? "review-chip--error"
                      : selectedRecord.group === "auto"
                        ? "audit-chip--success"
                        : "review-chip--info"
                  }`}
                >
                  {selectedRecord.status}
                </span>
              </div>
              {[
                ["Record ID", selectedRecord.id],
                [
                  "Source image / page",
                  "IMG_2024_10_22_11_27_20S.jpg · Page 2",
                ],
                ["Confidence", selectedRecord.confidence],
                ["Reviewed by", selectedRecord.reviewer],
                ["Validation results", selectedRecord.validation],
                [
                  selectedRecord.group === "failed"
                    ? "Reason for exclusion"
                    : "Reason for inclusion",
                  selectedRecord.reason,
                ],
              ].map(([label, value]) => (
                <div className="audit-detail-row" key={label}>
                  <small>{label}</small>
                  <b>{value}</b>
                </div>
              ))}
              <div className="value-comparison">
                <span>
                  <small>Original OCR value</small>
                  <b>{selectedRecord.original}</b>
                </span>
                <Icon name="arrow" size={17} />
                <span>
                  <small>Final value</small>
                  <b>{selectedRecord.final}</b>
                </span>
              </div>
              <div className="audit-history">
                <h3>Review history</h3>
                <p>
                  Processing completed · Field validation run · Record review
                  decision captured · Final audit classification retained
                </p>
              </div>
            </div>
            <div className="audit-drawer__actions">
              <Button
                variant="outlined"
                icon="image"
                onClick={() => setShowSource((value) => !value)}
              >
                {showSource ? "Hide source image" : "View source image"}
              </Button>
              {selectedRecord.group === "failed" && (
                <>
                  <Button variant="text">View issue</Button>
                  <Button onClick={back}>Return to Record Review</Button>
                </>
              )}
            </div>
          </aside>
        </>
      )}

      {seedState === "confirm" && (
        <div className="dialog-scrim">
          <section
            className="seed-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="seed-confirm-title"
          >
            <div className="dialog-header">
              <span className="summary-icon">
                <Icon name="records" size={19} />
              </span>
              <div>
                <h2 id="seed-confirm-title">
                  Add 8 approved records to parish database?
                </h2>
                <p>
                  Only approved records will be written. Failed and unresolved
                  records will remain excluded.
                </p>
              </div>
              <IconButton
                icon="close"
                label="Close confirmation"
                onClick={() => setSeedState("idle")}
              />
            </div>
            <div className="seed-validation-summary">
              {[
                ["8", "Approved", "success"],
                ["5", "Auto-reviewed", "success"],
                ["3", "Parish-reviewed", "info"],
                ["2", "Excluded", "error"],
                ["0", "Blocking issues", "success"],
              ].map(([count, label, tone]) => (
                <span
                  className={`validation-stat validation-stat--${tone}`}
                  key={label}
                >
                  <b>{count}</b>
                  <small>{label}</small>
                </span>
              ))}
            </div>
            <div className="seed-target-details">
              <span>
                <small>Church</small>
                <b>Saints Peter &amp; Paul — Manville, NJ (#46)</b>
              </span>
              <span>
                <small>Batch</small>
                <b>mar003-ssppoc-nj01</b>
              </span>
              <span>
                <small>Database target</small>
                <b>Parish Records Database</b>
              </span>
            </div>
            <div className="seed-simulation">
              <label>
                <span>Prototype seed outcome</span>
                <select
                  value={scenario}
                  onChange={(event) =>
                    setScenario(event.target.value as SeedScenario)
                  }
                >
                  <option value="success">Successful verified seed</option>
                  <option value="duplicate">Possible duplicate found</option>
                  <option value="partial">
                    Partial database write failure
                  </option>
                </select>
              </label>
              <p>
                This control demonstrates duplicate and partial-failure safety
                without writing real data.
              </p>
            </div>
            <div className="validation-alert">
              <Icon name="check" size={17} />
              Validation run {validationRuns} passed with 0 blocking issues.
            </div>
            <div className="dialog-actions">
              <Button variant="text" onClick={() => setSeedState("idle")}>
                Cancel
              </Button>
              <Button
                variant="outlined"
                icon="sync"
                onClick={() => setValidationRuns((value) => value + 1)}
              >
                Validate Again
              </Button>
              <Button onClick={startSeed}>Add 8 Records</Button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

function AppearancePanel({
  open,
  close,
  preset,
  setPreset,
  font,
  setFont,
  scale,
  setScale,
}: {
  open: boolean
  close: () => void
  preset: Preset
  setPreset: (preset: Preset) => void
  font: FontChoice
  setFont: (font: FontChoice) => void
  scale: number
  setScale: (scale: number) => void
}) {
  const presets: Preset[] = ["green", "blue", "purple", "orange", "red"]
  const fonts: FontChoice[] = ["Public Sans", "Inter", "DM Sans", "Nunito Sans"]
  return (
    <>
      <div className={`scrim ${open ? "visible" : ""}`} onClick={close} />
      <aside
        className={`settings-drawer ${open ? "open" : ""}`}
        aria-hidden={!open}
      >
        <div className="drawer-header">
          <div>
            <h2>Appearance</h2>
            <p>Customize your workspace</p>
          </div>
          <IconButton
            icon="close"
            label="Close appearance settings"
            onClick={close}
          />
        </div>
        <div className="drawer-section">
          <h3>Preset</h3>
          <p>Choose your primary accent color.</p>
          <div className="preset-grid">
            {presets.map((item) => (
              <button
                type="button"
                key={item}
                className={`preset preset--${item} ${
                  preset === item ? "active" : ""
                }`}
                onClick={() => setPreset(item)}
              >
                <i />
                <span>{item}</span>
                {preset === item && <Icon name="check" size={14} />}
              </button>
            ))}
          </div>
        </div>
        <div className="drawer-section">
          <h3>Font family</h3>
          <p>Apply a Minimal UI typography option.</p>
          <div className="font-list">
            {fonts.map((item) => (
              <button
                type="button"
                key={item}
                className={`font-option font-option--${item.toLowerCase().replaceAll(" ", "-")} ${
                  font === item ? "active" : ""
                }`}
                onClick={() => setFont(item)}
              >
                <span>Aa</span>
                <b>{item}</b>
                {font === item && <Icon name="check" size={16} />}
              </button>
            ))}
          </div>
        </div>
        <div className="drawer-section">
          <h3>Font size</h3>
          <p>Scale the interface base size.</p>
          <div className="scale-control">
            {[14, 16, 18].map((item) => (
              <button
                type="button"
                key={item}
                className={scale === item ? "active" : ""}
                onClick={() => setScale(item)}
              >
                {item === 14 ? "Compact" : item === 16 ? "Default" : "Large"}
                <small>{item}px</small>
              </button>
            ))}
          </div>
        </div>
        <div className="drawer-preview">
          <span>Preview</span>
          <h3>Parish records</h3>
          <p>Your chosen preset and typography update the entire interface.</p>
          <Button>Primary action</Button>
        </div>
      </aside>
    </>
  )
}

export function RecordUploadApp({ embedded = true }: { embedded?: boolean }) {
  const navigate = useNavigate()
  const churchId = useActiveChurchId()
  const { active: activeChurch } = useWorkspaces(true)
  const [page, setPage] = useState<Page>("upload")
  const [maxReached, setMaxReached] = useState(0)
  const [processingRun, setProcessingRun] = useState(0)
  const [batch, setBatch] = useState<BatchState>({
    recordType: "Marriage",
    language: "English",
    files: [],
    fileBlobs: [],
    previews: [],
    jobIds: [],
    batchId: makeBatchId(),
    church: "",
  })

  useEffect(() => {
    if (!activeChurch) return
    const place = [activeChurch.city, activeChurch.state].filter(Boolean).join(", ")
    const label = place ? `${activeChurch.name} — ${place}` : activeChurch.name
    setBatch((current) =>
      current.church === label ? current : { ...current, church: label },
    )
  }, [activeChurch])

  const openRecords = () => {
    if (embedded) navigate(paths.portal.ocr.root)
    else setPage("records")
  }
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [preset, setPreset] = useState<Preset>("green")
  const [font, setFont] = useState<FontChoice>("Public Sans")
  const [scale, setScale] = useState(16)
  const stepPages: Page[] = [
    "upload",
    "image-review",
    "processing",
    "record-review",
    "final-audit",
  ]
  const navigateWorkflow = (step: number) => {
    if (step <= maxReached) setPage(stepPages[step])
  }
  const workflow = { maxReached, onNavigate: navigateWorkflow }

  return (
    <div
      className={`app theme-${preset} font-${font.toLowerCase().replaceAll(" ", "-")} scale-${scale} ${
        mobileNavOpen ? "mobile-nav-open" : ""
      }`}
    >
      {!embedded && (
        <div className="mobile-scrim" onClick={() => setMobileNavOpen(false)} />
      )}
      {!embedded && (
        <Sidebar
          page={page}
          setPage={(next) => {
            setPage(next)
            setMobileNavOpen(false)
          }}
          openSettings={() => setSettingsOpen(true)}
        />
      )}
      <div className={embedded ? "shell shell--embedded" : "shell"}>
        <Header
          page={page}
          embedded={embedded}
          openSettings={() => setSettingsOpen(true)}
          openNav={() => setMobileNavOpen(true)}
        />
        {page === "records" && (
          <RecordsPage goToUpload={() => setPage("upload")} />
        )}
        <div hidden={page !== "upload"}>
          <UploadPage
            goToRecords={openRecords}
            goToImageReview={() => {
              setMaxReached((current) => Math.max(current, 1))
              setPage("image-review")
            }}
            batch={batch}
            setBatch={setBatch}
            churchId={churchId}
            workflow={workflow}
          />
        </div>
        <div hidden={page !== "image-review"}>
          <ImageReviewPage
            batch={batch}
            setBatch={setBatch}
            workflow={workflow}
            goToProcessing={(reprocess) => {
              const firstRun = maxReached < 2
              setMaxReached((current) => (reprocess ? 2 : Math.max(current, 2)))
              if (firstRun || reprocess) {
                setProcessingRun((current) => current + 1)
              }
              setPage("processing")
            }}
          />
        </div>
        <div hidden={page !== "processing"}>
          <ProcessingPage
            goToRecordReview={() => {
              setMaxReached((current) => Math.max(current, 3))
              setPage("record-review")
            }}
            workflow={workflow}
            runId={processingRun}
            started={maxReached >= 2}
            batch={batch}
            churchId={churchId}
          />
        </div>
        <div hidden={page !== "record-review"}>
          <RecordReviewPage
            back={() => setPage("processing")}
            goToFinalAudit={() => {
              setMaxReached((current) => Math.max(current, 4))
              setPage("final-audit")
            }}
            workflow={workflow}
          />
        </div>
        <div hidden={page !== "final-audit"}>
          <FinalAuditPage
            back={() => setPage("record-review")}
            goToRecords={openRecords}
            workflow={workflow}
          />
        </div>
      </div>
      <AppearancePanel
        open={settingsOpen}
        close={() => setSettingsOpen(false)}
        preset={preset}
        setPreset={setPreset}
        font={font}
        setFont={setFont}
        scale={scale}
        setScale={setScale}
      />
    </div>
  )
}
