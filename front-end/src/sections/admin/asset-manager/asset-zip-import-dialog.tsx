import type { OmAssetScope, ZipImportEntry, ZipImportResult, ZipImportAnalysis, ZipNamingStrategy } from './om-assets-api';

import { useRef, useState, useEffect } from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import Table from '@mui/material/Table';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Select from '@mui/material/Select';
import Switch from '@mui/material/Switch';
import MenuItem from '@mui/material/MenuItem';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import Typography from '@mui/material/Typography';
import InputLabel from '@mui/material/InputLabel';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import LinearProgress from '@mui/material/LinearProgress';
import FormControlLabel from '@mui/material/FormControlLabel';

import { fData } from 'src/utils/format-number';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';

import { AssetChurchSelect } from './asset-church-select';
import { commitZipImport, cancelZipImport, analyzeZipImport } from './om-assets-api';
import { ASSET_SCOPES, useAssetManager, ASSET_CATEGORIES } from './asset-manager-context';

// ----------------------------------------------------------------------

type Props = { open: boolean; onClose: () => void; initialFile?: File | null };

type EditableEntry = ZipImportEntry & { title: string; alt_text: string; stored_filename: string };

export function AssetZipImportDialog({ open, onClose, initialFile = null }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { filters, reload, reloadMeta } = useAssetManager();
  const [file, setFile] = useState<File | null>(null);
  const [scope, setScope] = useState<OmAssetScope>('public');
  const [churchId, setChurchId] = useState<number | null>(null);
  const [category, setCategory] = useState('');
  const [folder, setFolder] = useState('');
  const [strategy, setStrategy] = useState<ZipNamingStrategy>('smart');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [analysis, setAnalysis] = useState<ZipImportAnalysis | null>(null);
  const [entries, setEntries] = useState<EditableEntry[]>([]);
  const [result, setResult] = useState<ZipImportResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setScope((filters.scope || 'public') as OmAssetScope);
      setChurchId(filters.churchId);
      if (initialFile) setFile(initialFile);
    }
  }, [open, initialFile, filters.scope, filters.churchId]);

  const reset = () => {
    setFile(null); setAnalysis(null); setEntries([]); setResult(null); setProgress(0);
    setScope((filters.scope || 'public') as OmAssetScope); setChurchId(filters.churchId);
    setCategory(''); setFolder(''); setStrategy('smart'); setSkipDuplicates(true);
  };

  const close = async () => {
    if (busy) return;
    if (analysis && !result) await cancelZipImport(analysis.import_token).catch(() => false);
    reset();
    onClose();
  };

  const chooseAnother = async () => {
    if (analysis) await cancelZipImport(analysis.import_token).catch(() => false);
    setAnalysis(null); setEntries([]); setFile(null); setProgress(0);
  };

  const choose = (selected?: File) => {
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith('.zip')) { toast.error('Choose a .zip archive'); return; }
    setFile(selected); setAnalysis(null); setResult(null); setEntries([]);
  };

  const analyze = async () => {
    if (!file) return;
    if (scope === 'church' && !churchId) { toast.error('Choose a church destination'); return; }
    setBusy(true); setProgress(0);
    try {
      const form = new FormData();
      form.append('archive', file);
      form.append('scope', scope);
      if (churchId) form.append('church_id', String(churchId));
      if (category) form.append('category', category);
      if (folder) form.append('folder', folder);
      form.append('naming_strategy', strategy);
      const next = await analyzeZipImport(form, setProgress);
      setAnalysis(next);
      setCategory(next.category);
      setFolder(next.folder);
      setEntries(next.manifest.filter((entry) => entry.status === 'ready').map((entry) => ({
        ...entry,
        stored_filename: entry.stored_filename || entry.original_name,
        title: entry.title || '',
        alt_text: entry.alt_text || entry.title || '',
      })));
      toast.success(`${next.manifest.filter((entry) => entry.status === 'ready').length} images ready for review`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ZIP analysis failed');
    } finally { setBusy(false); }
  };

  const commit = async () => {
    if (!analysis) return;
    setBusy(true);
    try {
      const imported = await commitZipImport(analysis.import_token, {
        scope, church_id: churchId, category, folder,
        skip_duplicates: skipDuplicates,
        tags: analysis.tags,
        entries: entries.map((entry) => ({
          entry_name: entry.entry_name,
          stored_filename: entry.stored_filename,
          title: entry.title,
          alt_text: entry.alt_text,
        })),
      });
      setResult(imported);
      await Promise.all([reload(), reloadMeta()]);
      if (imported.failed_count) toast.warning(`Imported ${imported.imported_count}; ${imported.failed_count} failed`);
      else toast.success(`${imported.imported_count} images imported`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ZIP import failed');
    } finally { setBusy(false); }
  };

  const patchEntry = (index: number, patch: Partial<EditableEntry>) =>
    setEntries((current) => current.map((entry, row) => (row === index ? { ...entry, ...patch } : entry)));

  return (
    <Dialog fullWidth maxWidth="lg" open={open} onClose={close}>
      <DialogTitle>Import image ZIP</DialogTitle>
      <DialogContent dividers>
        {!analysis && !result && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <Alert severity="info">
              The archive name becomes the import folder and filename prefix. Generic names such as image.png or ChatGPT exports are renamed sequentially; meaningful names are preserved after the archive prefix.
            </Alert>
            <Box
              onClick={() => fileRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); choose(event.dataTransfer.files[0]); }}
              sx={{ py: 5, px: 3, textAlign: 'center', cursor: 'pointer', borderRadius: 2, border: '1px dashed', borderColor: 'divider', bgcolor: 'background.neutral' }}
            >
              <Iconify icon="solar:archive-down-minimlistic-bold" width={48} sx={{ color: 'primary.main' }} />
              <Typography variant="h6" sx={{ mt: 1 }}>{file?.name || 'Drop a ZIP here or browse'}</Typography>
              {file && <Typography variant="body2" color="text.secondary">{fData(file.size)}</Typography>}
              <input ref={fileRef} hidden type="file" accept=".zip,application/zip" onChange={(event) => choose(event.target.files?.[0])} />
            </Box>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3,1fr)' } }}>
              <TextField select label="Scope" value={scope} onChange={(event) => setScope(event.target.value as OmAssetScope)}>{ASSET_SCOPES.filter((item) => item.value !== 'internal').map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}</TextField>
              {scope === 'church' ? <AssetChurchSelect value={churchId} onChange={setChurchId} /> : <TextField label="Category" value={category || 'Auto-detect from ZIP name'} disabled />}
              <FormControl><InputLabel>Naming</InputLabel><Select label="Naming" value={strategy} onChange={(event) => setStrategy(event.target.value as ZipNamingStrategy)}><MenuItem value="smart">Smart archive naming</MenuItem><MenuItem value="sequential">Archive + sequence</MenuItem><MenuItem value="preserve">Preserve sanitized names</MenuItem></Select></FormControl>
              {scope === 'church' && <TextField label="Category" value={category || 'Auto-detect from ZIP name'} disabled />}
              <TextField label="Folder override (optional)" value={folder} onChange={(event) => setFolder(event.target.value)} />
            </Box>
            {busy && <LinearProgress variant="determinate" value={progress} />}
          </Box>
        )}

        {analysis && !result && (
          <Box>
            <Alert severity="success" sx={{ mb: 2 }}>
              <b>{analysis.archive_filename}</b>: {entries.length} images · category <b>{category}</b> · folder <b>{folder}</b>. Review every generated filename before importing.
            </Alert>
            <Box sx={{ display: 'grid', gap: 2, mb: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3,1fr)' } }}>
              <TextField select label="Category" value={category} onChange={(event) => setCategory(event.target.value)}>{ASSET_CATEGORIES.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}</TextField>
              <TextField label="Asset folder" value={folder} onChange={(event) => setFolder(event.target.value)} />
              <FormControlLabel control={<Switch checked={skipDuplicates} onChange={(event) => setSkipDuplicates(event.target.checked)} />} label="Skip duplicate images" />
            </Box>
            <Scrollbar sx={{ maxHeight: 520 }}>
              <Table size="small" stickyHeader>
                <TableHead><TableRow><TableCell>#</TableCell><TableCell>Original</TableCell><TableCell>Imported filename</TableCell><TableCell>Title</TableCell><TableCell>Alt text</TableCell><TableCell align="right">Size</TableCell></TableRow></TableHead>
                <TableBody>{entries.map((entry, index) => <TableRow key={entry.entry_name}><TableCell>{index + 1}</TableCell><TableCell sx={{ maxWidth: 190 }}><Typography variant="caption" noWrap>{entry.original_name}</Typography></TableCell><TableCell><TextField size="small" value={entry.stored_filename} onChange={(event) => patchEntry(index, { stored_filename: event.target.value })} /></TableCell><TableCell><TextField size="small" value={entry.title} onChange={(event) => patchEntry(index, { title: event.target.value })} /></TableCell><TableCell><TextField size="small" value={entry.alt_text} onChange={(event) => patchEntry(index, { alt_text: event.target.value })} /></TableCell><TableCell align="right">{fData(entry.size || 0)}</TableCell></TableRow>)}</TableBody>
              </Table>
            </Scrollbar>
          </Box>
        )}

        {result && (
          <Box>
            <Alert severity={result.failed_count ? 'warning' : 'success'} sx={{ mb: 2 }}>
              Import {result.status}: {result.imported_count} imported, {result.skipped_count} skipped, {result.failed_count} failed.
            </Alert>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {result.report.map((entry) => <Chip key={entry.entry_name || entry.original_name} size="small" label={`${entry.stored_filename || entry.original_name}: ${entry.status}`} color={entry.status === 'imported' ? 'success' : entry.status === 'failed' ? 'error' : 'default'} variant="soft" />)}
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy}>{result ? 'Close' : 'Cancel'}</Button>
        {!analysis && !result && <Button variant="contained" disabled={!file || busy} loading={busy} onClick={analyze}>Analyze ZIP</Button>}
        {analysis && !result && <><Button onClick={chooseAnother}>Choose another</Button><Button variant="contained" disabled={busy || !entries.length} loading={busy} onClick={commit}>Import {entries.length} images</Button></>}
      </DialogActions>
    </Dialog>
  );
}
