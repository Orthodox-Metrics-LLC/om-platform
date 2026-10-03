import type { Slide } from 'yet-another-react-lightbox';
import type { CloudFileEntry } from './om-assets-api';

import { useLightboxState } from 'yet-another-react-lightbox';
import { useMemo, useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Table from '@mui/material/Table';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import InputAdornment from '@mui/material/InputAdornment';
import LinearProgress from '@mui/material/LinearProgress';
import TableContainer from '@mui/material/TableContainer';

import { fData } from 'src/utils/format-number';
import { fDateTime } from 'src/utils/format-time';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Lightbox } from 'src/components/lightbox';
import { Scrollbar } from 'src/components/scrollbar';
import { EmptyContent } from 'src/components/empty-content';
import { FileThumbnail } from 'src/components/file-thumbnail';

import { deleteCloudFileScreenshot, fetchCloudFilesScreenshots } from './om-assets-api';

// ----------------------------------------------------------------------

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|ico)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|avi)$/i;
const VIDEO_MIME: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', avi: 'video/x-msvideo' };

const isImageEntry = (e: CloudFileEntry) => e.type === 'file' && IMAGE_EXT.test(e.name);
const isVideoEntry = (e: CloudFileEntry) => e.type === 'file' && VIDEO_EXT.test(e.name);
const videoMime = (name: string) => VIDEO_MIME[name.split('.').pop()?.toLowerCase() ?? ''] || 'video/mp4';

/**
 * Cloud Files: real-time browse of the \\192.168.1.79\screenshots SMB share
 * (mounted at /mnt/storage/screenshots). Lists the live filesystem on every
 * load/navigation — not the om_assets DB, so it always matches exactly
 * what's physically on the share right now. Not a managed/recoverable Asset
 * Manager resource: delete here removes the real file from the share, with
 * no Archive-style undo tier.
 */
export function CloudFilesView() {
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<CloudFileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const [lightboxEpoch, setLightboxEpoch] = useState(0);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    try {
      const res = await fetchCloudFilesScreenshots(p);
      setEntries(res.entries);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load share contents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(path);
    setQuery('');
  }, [path, load]);

  const filteredEntries = useMemo(
    () => (query.trim() ? entries.filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase())) : entries),
    [entries, query]
  );

  const previewableEntries = useMemo(
    () => filteredEntries.filter((e) => isImageEntry(e) || isVideoEntry(e)),
    [filteredEntries]
  );

  const lightboxSlides: Slide[] = useMemo(
    () =>
      previewableEntries.map((e): Slide =>
        isVideoEntry(e)
          ? { type: 'video', sources: [{ src: e.file_url || '', type: videoMime(e.name) }], title: e.name }
          : { src: e.file_url || '', title: e.name }
      ),
    [previewableEntries]
  );

  const removeEntry = useCallback((filePath: string) => {
    setEntries((prev) => prev.filter((e) => e.path !== filePath));
  }, []);

  const deleteFile = useCallback(
    async (entry: CloudFileEntry) => {
      try {
        await deleteCloudFileScreenshot(entry.path);
        removeEntry(entry.path);
        toast.success(`Deleted ${entry.name}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not delete file');
      }
    },
    [removeEntry]
  );

  const deleteFromPreview = useCallback(
    (entry: CloudFileEntry, viewedIndex: number) => {
      const newLength = previewableEntries.length - 1;
      setLightboxIndex(newLength <= 0 ? -1 : Math.min(viewedIndex, newLength - 1));
      setLightboxEpoch((e) => e + 1);
      deleteFile(entry);
    },
    [deleteFile, previewableEntries.length]
  );

  const openEntry = (entry: CloudFileEntry) => {
    if (entry.type === 'directory') { setPath(entry.path); return; }
    if (isImageEntry(entry) || isVideoEntry(entry)) {
      const idx = previewableEntries.findIndex((e) => e.path === entry.path);
      if (idx >= 0) setLightboxIndex(idx);
    }
  };

  const crumbs = path ? path.split('/').filter(Boolean) : [];

  return (
    <>
      <Box sx={{ mb: 2, gap: 1.5, display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip
          size="small"
          variant="soft"
          color="info"
          icon={<Iconify icon="eva:cloud-upload-fill" width={16} />}
          label="\\192.168.1.79\screenshots"
        />
        <Breadcrumbs separator={<Iconify icon="carbon:chevron-right" width={14} />}>
          <Typography
            component="button"
            onClick={() => setPath('')}
            sx={{
              border: 'none',
              bgcolor: 'transparent',
              cursor: 'pointer',
              typography: 'body2',
              color: path ? 'text.secondary' : 'text.primary',
              fontWeight: path ? 400 : 600,
            }}
          >
            screenshots
          </Typography>
          {crumbs.map((part, i) => {
            const crumbPath = crumbs.slice(0, i + 1).join('/');
            const isLast = i === crumbs.length - 1;
            return (
              <Typography
                key={crumbPath}
                component="button"
                onClick={() => setPath(crumbPath)}
                sx={{
                  border: 'none',
                  bgcolor: 'transparent',
                  cursor: 'pointer',
                  typography: 'body2',
                  color: isLast ? 'text.primary' : 'text.secondary',
                  fontWeight: isLast ? 600 : 400,
                }}
              >
                {part}
              </Typography>
            );
          })}
        </Breadcrumbs>
        <Box sx={{ flexGrow: 1 }} />
        <TextField
          size="small"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter this folder…"
          sx={{ width: 220 }}
          slotProps={{
            input: {
              startAdornment: <InputAdornment position="start"><Iconify icon="eva:search-fill" width={18} sx={{ color: 'text.disabled' }} /></InputAdornment>,
            },
          }}
        />
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          startIcon={<Iconify icon="solar:restart-bold" />}
          onClick={() => load(path)}
        >
          Refresh
        </Button>
      </Box>

      {loading && <LinearProgress sx={{ mb: 2 }} />}
      {error && <EmptyContent filled title={error} sx={{ py: 6 }} />}

      {!loading && !error && (
        <TableContainer sx={{ border: (theme) => `1px solid ${theme.vars.palette.divider}`, borderRadius: 1.5 }}>
          <Scrollbar>
            <Table size="small" sx={{ minWidth: 720 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell align="right">Size</TableCell>
                  <TableCell>Modified</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredEntries.map((entry) => (
                  <TableRow
                    key={entry.path}
                    hover
                    sx={{ cursor: entry.type === 'directory' || isImageEntry(entry) || isVideoEntry(entry) ? 'pointer' : 'default' }}
                    onClick={() => openEntry(entry)}
                  >
                    <TableCell>
                      <Box sx={{ gap: 1.5, display: 'flex', alignItems: 'center' }}>
                        <FileThumbnail
                          file={entry.type === 'directory' ? 'folder' : entry.name}
                          showImage
                          previewUrl={entry.type === 'file' ? entry.file_url ?? undefined : undefined}
                          sx={{ width: 28, height: 28 }}
                        />
                        <Typography variant="body2" noWrap>
                          {entry.name}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell align="right">{entry.size != null ? fData(entry.size) : '—'}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{fDateTime(entry.modified_at)}</TableCell>
                    <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                      {entry.type === 'file' && (
                        <>
                          <Tooltip title="Download">
                            <IconButton size="small" component="a" href={entry.file_url ?? undefined} download={entry.name}>
                              <Iconify icon="eva:cloud-download-fill" width={18} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete from share">
                            <IconButton size="small" color="error" onClick={() => deleteFile(entry)}>
                              <Iconify icon="solar:trash-bin-trash-bold" width={18} />
                            </IconButton>
                          </Tooltip>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!filteredEntries.length && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <EmptyContent title={query ? 'No files match' : 'Nothing on the share yet'} sx={{ py: 6 }} />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Scrollbar>
        </TableContainer>
      )}

      <Lightbox
        key={`${lightboxIndex}-${lightboxEpoch}`}
        open={lightboxIndex >= 0}
        close={() => setLightboxIndex(-1)}
        slides={lightboxSlides}
        index={Math.max(lightboxIndex, 0)}
        disableTotal={false}
        thumbnails={{ position: 'end' }}
        toolbarExtraButtons={[
          <CloudFileDeleteButton key="delete-from-preview" entries={previewableEntries} onDelete={deleteFromPreview} />,
        ]}
      />
    </>
  );
}

// ----------------------------------------------------------------------

/** Lightbox toolbar button: deletes the slide currently being viewed from the share right away. */
function CloudFileDeleteButton({
  entries,
  onDelete,
}: {
  entries: CloudFileEntry[];
  onDelete: (entry: CloudFileEntry, viewedIndex: number) => void;
}) {
  const { currentIndex } = useLightboxState();
  const entry = entries[currentIndex];

  if (!entry) return null;

  return (
    <Tooltip title="Delete this">
      <IconButton className="yarl__button" onClick={() => onDelete(entry, currentIndex)} sx={{ color: 'common.white' }}>
        <Iconify icon="solar:trash-bin-trash-bold" width={22} />
      </IconButton>
    </Tooltip>
  );
}
