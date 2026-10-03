import './ocr-upload-flow.css';

import { useNavigate } from 'react-router';
import { useMemo, useState, useEffect, useCallback } from 'react';

import { paths } from 'src/routes/paths';

import { Icon, Card, Button, Select, TextField, IconButton } from './ocr-upload-flow';
import {
  fetchOcrJobs,
  deleteOcrJobs,
  renameOcrBatch,
  mapJobsToBatchRows,
  type OmOcrBatchRow,
  processingModeLabel,
  type OmOcrWizardStatus,
} from './om-ocr-api';

// ----------------------------------------------------------------------
// Records list — same Figma markup/CSS as the upload wizard (scoped under
// `.om-record-upload`), wired to the real OCR jobs API instead of mock rows.

type ChipBucket = 'complete' | 'processing' | 'review' | 'pending';

function statusBucket(status: OmOcrWizardStatus): ChipBucket {
  if (status === 'completed' || status === 'already-exists') return 'complete';
  if (status === 'ready-for-review' || status === 'returned') return 'review';
  if (status === 'failed' || status === 'not-church-record') return 'pending';
  return 'processing';
}

function statusLabel(bucket: ChipBucket): string {
  if (bucket === 'complete') return 'Completed';
  if (bucket === 'review') return 'Needs review';
  if (bucket === 'pending') return 'Pending';
  return 'Processing';
}

function readinessText(row: OmOcrBatchRow): { title: string; detail: string } {
  if (row.reviewReady) return { title: 'Ready for review', detail: 'OCR processing complete' };
  if (!row.allProcessed) return { title: 'Not ready', detail: 'Processing in progress' };
  if (row.needsReview > 0) return { title: 'Needs review', detail: `${row.needsReview} issues detected` };
  return { title: 'Ready for review', detail: 'OCR processing complete' };
}

function StatusChip({ bucket }: { bucket: ChipBucket }) {
  return <span className={`chip chip--${bucket}`}>{statusLabel(bucket)}</span>;
}

type Props = {
  churchId: number | null;
};

export function OcrListView({ churchId }: Props) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<OmOcrBatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('All record types');
  const [status, setStatus] = useState('All statuses');
  const [selected, setSelected] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!churchId) return;
    setLoading(true);
    setError(null);
    try {
      const jobs = await fetchOcrJobs(churchId, { limit: 200 });
      setRows(mapJobsToBatchRows(jobs));
    } catch (err: any) {
      setError(err?.message || 'Failed to load OCR uploads');
    } finally {
      setLoading(false);
    }
  }, [churchId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!rows.some((r) => !r.allProcessed)) return undefined;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [rows, load]);

  const handleRename = async (row: OmOcrBatchRow) => {
    if (!churchId || !row.batchId) return;
    const name = window.prompt('Rename this upload', row.displayName);
    if (!name || !name.trim()) return;
    try {
      await renameOcrBatch(churchId, row.batchId, name.trim());
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not rename upload');
    }
  };

  const handleDelete = async (row: OmOcrBatchRow) => {
    if (!churchId) return;
    if (!window.confirm(`Delete "${row.displayName}" and its ${row.totalImages} image(s)? This cannot be undone.`)) return;
    try {
      await deleteOcrJobs(churchId, row.jobIds);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not delete upload');
    }
  };

  const visibleRows = useMemo(
    () =>
      rows.filter((row) => {
        const recordTypeLabel = row.recordType.charAt(0).toUpperCase() + row.recordType.slice(1);
        const bucket = statusBucket(row.status);
        if (type !== 'All record types' && recordTypeLabel !== type) return false;
        if (status !== 'All statuses' && bucket !== status) return false;
        if (!query.trim()) return true;
        const q = query.trim().toLowerCase();
        return row.displayName.toLowerCase().includes(q) || (row.originalName || '').toLowerCase().includes(q);
      }),
    [rows, query, status, type],
  );

  const toggleAll = () =>
    setSelected(selected.length === visibleRows.length ? [] : visibleRows.map((row) => row.id));

  const goToUpload = () => navigate(paths.portal.ocr.upload);

  return (
    <div className="om-record-upload">
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

        {error && (
          <div className="alert alert--error">
            <span className="alert-icon">
              <Icon name="alert" size={16} />
            </span>
            <span>
              <b>{error}</b>
            </span>
            <IconButton icon="close" label="Dismiss" onClick={() => setError(null)} />
          </div>
        )}

        <Card className="records-card">
          <div className="table-tools">
            <div className="filters">
              <Select label="Record type" value={type} onChange={setType}>
                <option>All record types</option>
                <option>Baptism</option>
                <option>Marriage</option>
                <option>Funeral</option>
                <option>Custom</option>
              </Select>
              <Select label="Processing status" value={status} onChange={setStatus}>
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
                      checked={visibleRows.length > 0 && selected.length === visibleRows.length}
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
                {loading && rows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="table-loading">
                      Loading…
                    </td>
                  </tr>
                ) : visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={11}>
                      <div className="empty-state">
                        <span className="document-icon">
                          <Icon name="search" />
                        </span>
                        <h2>No records found</h2>
                        <p>
                          {rows.length === 0
                            ? 'Use Upload batch above to get started.'
                            : 'Try adjusting your search or filters.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((row, index) => {
                    const bucket = statusBucket(row.status);
                    const pct = row.totalImages > 0 ? Math.round((row.completedImages / row.totalImages) * 100) : 0;
                    const readiness = readinessText(row);
                    return (
                      <tr key={row.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.displayName}`}
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
                            <span className={`batch-preview batch-preview--${index % 5}`}>
                              <span />
                            </span>
                            <span>
                              <b>
                                {row.displayName}
                                {row.totalImages > 1 ? ` (${row.totalImages} images)` : ''}
                              </b>
                              <small>
                                {row.originalName || row.id}
                                {row.batchId && (
                                  <>
                                    <br />
                                    {row.batchId}
                                  </>
                                )}
                              </small>
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className={`type-chip type-chip--${row.recordType}`}>
                            {row.recordType.charAt(0).toUpperCase() + row.recordType.slice(1)}
                          </span>
                        </td>
                        <td>{new Date(row.date).toLocaleDateString()}</td>
                        <td>
                          <b>{row.totalImages}</b>
                        </td>
                        <td>
                          <b>{row.recordsDetected || '—'}</b>
                        </td>
                        <td>
                          <span className={`mode mode--${row.mode}`}>
                            <i />
                            {processingModeLabel(row.mode)}
                          </span>
                        </td>
                        <td>
                          <div className="progress-cell">
                            <div>
                              <StatusChip bucket={bucket} />
                              <span>{pct}%</span>
                            </div>
                            <span className={`progress progress--${bucket}`}>
                              <i style={{ width: `${pct}%` }} />
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className={`readiness readiness--${bucket}`}>
                            <i />
                            <span>
                              <b>{readiness.title}</b>
                              <small>{readiness.detail}</small>
                            </span>
                          </div>
                        </td>
                        <td>
                          <Button
                            variant={row.allProcessed ? 'contained' : 'outlined'}
                            disabled={!row.allProcessed}
                            onClick={() => navigate(paths.portal.ocr.details(row.primaryJobId))}
                          >
                            {row.allProcessed ? 'Review images' : 'View progress'}
                          </Button>
                        </td>
                        <td>
                          <div className="row-menu">
                            <IconButton
                              icon="more"
                              label={`More actions for ${row.displayName}`}
                              onClick={() => {
                                const action = window.prompt('Type "rename" or "delete"');
                                if (action === 'rename') handleRename(row);
                                else if (action === 'delete') handleDelete(row);
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="table-footer">
            <span>
              Showing {visibleRows.length} of {rows.length} records
            </span>
          </div>
        </Card>
      </main>
    </div>
  );
}
