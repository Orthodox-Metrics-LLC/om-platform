import type { Slide } from 'yet-another-react-lightbox';
import type { WebsiteFileEntry } from './om-assets-api';

import { useMemo, useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import LinearProgress from '@mui/material/LinearProgress';
import InputAdornment from '@mui/material/InputAdornment';

import { fData } from 'src/utils/format-number';
import { fDateTime } from 'src/utils/format-time';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Lightbox } from 'src/components/lightbox';
import { EmptyContent } from 'src/components/empty-content';
import { FileThumbnail } from 'src/components/file-thumbnail';

import { fetchWebsiteFiles, uploadWebsiteFile, replaceWebsiteFile } from './om-assets-api';

// ----------------------------------------------------------------------

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;
const VIDEO_MIME: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4' };
const ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.svg,.ico,.mp4,.webm,.mov,.m4v,.ttf,.otf,.woff,.woff2';

const isImageEntry = (entry: WebsiteFileEntry) => entry.type === 'file' && IMAGE_EXT.test(entry.name);
const isVideoEntry = (entry: WebsiteFileEntry) => entry.type === 'file' && VIDEO_EXT.test(entry.name);
const videoMime = (name: string) => VIDEO_MIME[name.split('.').pop()?.toLowerCase() ?? ''] || 'video/mp4';

function fileExt(name: string) {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

/** Public files are served under the app base (`/` in dev, `/om-platform/` in production). */
function websiteHref(relPath: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/${relPath}`;
}

type DialogState =
  | { mode: 'replace'; entry: WebsiteFileEntry }
  | { mode: 'add' };

// ----------------------------------------------------------------------

/**
 * Website: browse and replace files in front-end/public.
 * Replace keeps the filename (so existing URLs keep working) and the API
 * also updates the dist copy nginx is serving.
 */
export function WebsiteFilesView() {
  const [dirPath, setDirPath] = useState('');
  const [entries, setEntries] = useState<WebsiteFileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogNonce, setDialogNonce] = useState(0);
  const [picked, setPicked] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (nextPath: string) => {
    setLoading(true);
    try {
      const res = await fetchWebsiteFiles(nextPath);
      setEntries(res.entries);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load website files');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(dirPath); }, [dirPath, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((entry) => entry.name.toLowerCase().includes(q));
  }, [entries, query]);

  const folders = useMemo(() => filtered.filter((entry) => entry.type === 'directory'), [filtered]);
  const files = useMemo(() => filtered.filter((entry) => entry.type === 'file'), [filtered]);
  const previewable = useMemo(() => files.filter((entry) => isImageEntry(entry) || isVideoEntry(entry)), [files]);

  const slides: Slide[] = useMemo(
    () => previewable.map((entry): Slide => (
      isVideoEntry(entry)
        ? { type: 'video', sources: [{ src: entry.file_url || '', type: videoMime(entry.name) }], title: entry.name }
        : { src: entry.file_url || entry.thumb_url || '', title: entry.name }
    )),
    [previewable]
  );

  const crumbs = dirPath ? dirPath.split('/').filter(Boolean) : [];

  const openPreview = (entry: WebsiteFileEntry) => {
    const index = previewable.findIndex((item) => item.path === entry.path);
    if (index >= 0) setLightboxIndex(index);
  };

  const closeDialog = () => {
    if (busy) return;
    setDialog(null);
    setPicked(null);
  };

  const expectedExt = dialog?.mode === 'replace' ? fileExt(dialog.entry.name) : '';
  const pickedExt = picked ? fileExt(picked.name) : '';
  const extMismatch = dialog?.mode === 'replace' && !!picked && pickedExt !== expectedExt;

  const submit = async () => {
    if (!dialog || !picked || extMismatch) return;
    setBusy(true);
    try {
      const res = dialog.mode === 'replace'
        ? await replaceWebsiteFile(dialog.entry.path, picked)
        : await uploadWebsiteFile(dirPath, picked);
      const name = dialog.mode === 'replace' ? dialog.entry.name : picked.name;
      if (res.mirrored) toast.success(`${dialog.mode === 'replace' ? 'Replaced' : 'Added'} ${name}`);
      else toast.warning(`${name} was saved in public/, but the live site copy was not updated`);
      setDialog(null);
      setPicked(null);
      await load(dirPath);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the website file');
    } finally {
      setBusy(false);
    }
  };

  const grid = {
    gap: 2,
    display: 'grid',
    gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(4, 1fr)', lg: 'repeat(6, 1fr)' },
  } as const;

  return (
    <>
      <Box sx={{ mb: 2, gap: 1.5, display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
        <Label color="info" startIcon={<Iconify icon="solar:global-bold-duotone" width={16} />}>front-end/public</Label>
        <Breadcrumbs separator={<Iconify icon="carbon:chevron-right" width={14} />}>
          <Typography
            component="button"
            type="button"
            onClick={() => { setQuery(''); setDirPath(''); }}
            sx={{ border: 'none', bgcolor: 'transparent', cursor: 'pointer', typography: 'body2', color: dirPath ? 'text.secondary' : 'text.primary', fontWeight: dirPath ? 400 : 600 }}
          >
            public
          </Typography>
          {crumbs.map((part, index) => {
            const crumbPath = crumbs.slice(0, index + 1).join('/');
            const isLast = index === crumbs.length - 1;
            return (
              <Typography
                key={crumbPath}
                component="button"
                type="button"
                onClick={() => { setQuery(''); setDirPath(crumbPath); }}
                sx={{ border: 'none', bgcolor: 'transparent', cursor: 'pointer', typography: 'body2', color: isLast ? 'text.primary' : 'text.secondary', fontWeight: isLast ? 600 : 400 }}
              >
                {part}
              </Typography>
            );
          })}
        </Breadcrumbs>
        <Box sx={{ flexGrow: 1 }} />
        <Button size="small" variant="outlined" color="inherit" startIcon={<Iconify icon="solar:restart-bold" />} onClick={() => load(dirPath)}>
          Refresh
        </Button>
        <Button size="small" variant="contained" startIcon={<Iconify icon="eva:cloud-upload-fill" />} onClick={() => { setPicked(null); setDialogNonce((n) => n + 1); setDialog({ mode: 'add' }); }}>
          Add file
        </Button>
      </Box>

      <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
        Files the website serves from this folder. Replace keeps the same filename, so existing links keep working, and updates the live copy immediately.
      </Typography>

      <TextField
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search this folder..."
        size="small"
        slotProps={{ input: { startAdornment: <InputAdornment position="start"><Iconify icon="eva:search-fill" sx={{ color: 'text.disabled' }} /></InputAdornment> } }}
        sx={{ mb: 2, width: { xs: 1, md: 320 } }}
      />

      {loading && <LinearProgress sx={{ mb: 2 }} />}
      {error && <EmptyContent filled title={error} sx={{ py: 6 }} />}

      {!loading && !error && !filtered.length && (
        <EmptyContent filled title={query ? 'No files match' : 'This folder is empty'} sx={{ py: 10 }} />
      )}

      {!loading && !error && !!folders.length && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 1.5 }}>Folders</Typography>
          <Box sx={grid}>
            {folders.map((folder) => (
              <Box
                key={folder.path}
                component="button"
                type="button"
                onClick={() => { setQuery(''); setDirPath(folder.path); }}
                sx={{
                  p: 2,
                  gap: 1,
                  border: (theme) => `1px solid ${theme.vars.palette.divider}`,
                  borderRadius: 2,
                  display: 'flex',
                  alignItems: 'center',
                  textAlign: 'left',
                  cursor: 'pointer',
                  bgcolor: 'background.paper',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <FileThumbnail file="folder" sx={{ width: 36, height: 36 }} />
                <Typography variant="subtitle2" noWrap>{folder.name}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {!loading && !error && !!files.length && (
        <Box>
          <Typography variant="h6" sx={{ mb: 1.5 }}>Files</Typography>
          <Box sx={grid}>
            {files.map((file) => {
              const href = websiteHref(file.path);
              const preview = file.thumb_url || (isImageEntry(file) ? file.file_url : null);
              return (
                <Box
                  key={file.path}
                  sx={{
                    border: (theme) => `1px solid ${theme.vars.palette.divider}`,
                    borderRadius: 2,
                    overflow: 'hidden',
                    bgcolor: 'background.paper',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <Box
                    onClick={() => openPreview(file)}
                    sx={{
                      height: 140,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: 'background.neutral',
                      cursor: isImageEntry(file) || isVideoEntry(file) ? 'pointer' : 'default',
                    }}
                  >
                    {preview ? (
                      <Box component="img" alt="" src={preview} loading="lazy" sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    ) : (
                      <FileThumbnail file={file.name} sx={{ width: 40, height: 40 }} />
                    )}
                  </Box>
                  <Box sx={{ p: 1.5, gap: 0.5, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <Typography variant="subtitle2" noWrap title={file.name}>{file.name}</Typography>
                    <Typography variant="caption" noWrap sx={{ color: 'text.disabled' }}>
                      {file.size != null ? fData(file.size) : '—'} · {fDateTime(file.modified_at)}
                    </Typography>
                    <Typography variant="caption" noWrap title={href} sx={{ color: 'text.secondary' }}>{href}</Typography>
                    <Box sx={{ mt: 0.5, display: 'flex', gap: 1 }}>
                      <Button size="small" variant="contained" onClick={() => { setPicked(null); setDialogNonce((n) => n + 1); setDialog({ mode: 'replace', entry: file }); }}>
                        Replace
                      </Button>
                      <Button size="small" color="inherit" component="a" href={href} target="_blank" rel="noopener">
                        Open
                      </Button>
                    </Box>
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      <Dialog open={!!dialog} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>{dialog?.mode === 'replace' ? `Replace ${dialog.entry.name}` : 'Add a website file'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {dialog?.mode === 'replace'
              ? `Upload a ${expectedExt} file. The website keeps the address ${websiteHref(dialog.entry.path)}.`
              : 'The file is added to this folder and served on the website under its filename.'}
          </Typography>
          <Button variant="outlined" component="label" color="inherit" startIcon={<Iconify icon="eva:cloud-upload-fill" />}>
            {picked ? picked.name : 'Choose file'}
            <input
              key={dialogNonce}
              hidden
              type="file"
              accept={dialog?.mode === 'replace' ? expectedExt : ACCEPT}
              onChange={(event) => setPicked(event.target.files?.[0] ?? null)}
            />
          </Button>
          {extMismatch && (
            <Typography variant="caption" sx={{ color: 'error.main' }}>
              This file is {pickedExt}. Choose a {expectedExt} file.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            variant="contained"
            loading={busy}
            disabled={!picked || extMismatch}
            onClick={submit}
          >
            {dialog?.mode === 'replace' ? 'Replace' : 'Add file'}
          </Button>
          <Button variant="outlined" color="inherit" onClick={closeDialog} disabled={busy}>Cancel</Button>
        </DialogActions>
      </Dialog>

      <Lightbox
        open={lightboxIndex >= 0}
        close={() => setLightboxIndex(-1)}
        slides={slides}
        index={Math.max(lightboxIndex, 0)}
      />
    </>
  );
}
