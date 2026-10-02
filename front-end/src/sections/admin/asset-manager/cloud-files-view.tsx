import type { CloudFileEntry } from './om-assets-api';

import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Table from '@mui/material/Table';
import Button from '@mui/material/Button';
import TableRow from '@mui/material/TableRow';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import Typography from '@mui/material/Typography';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import LinearProgress from '@mui/material/LinearProgress';
import TableContainer from '@mui/material/TableContainer';

import { fData } from 'src/utils/format-number';
import { fDateTime } from 'src/utils/format-time';

import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { EmptyContent } from 'src/components/empty-content';
import { FileThumbnail } from 'src/components/file-thumbnail';

import { fetchCloudFilesScreenshots } from './om-assets-api';

// ----------------------------------------------------------------------

/**
 * Cloud Files: real-time, read-only browse of the \\192.168.1.79\screenshots
 * SMB share (mounted at /mnt/storage/screenshots). Lists the live filesystem
 * on every load/navigation — not the om_assets DB, so it always matches
 * exactly what's physically on the share right now.
 */
export function CloudFilesView() {
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<CloudFileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  }, [path, load]);

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
            <Table size="small" sx={{ minWidth: 640 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell align="right">Size</TableCell>
                  <TableCell>Modified</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow
                    key={entry.path}
                    hover
                    sx={{ cursor: entry.type === 'directory' ? 'pointer' : 'default' }}
                    onClick={() => entry.type === 'directory' && setPath(entry.path)}
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
                  </TableRow>
                ))}
                {!entries.length && (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <EmptyContent title="Nothing on the share yet" sx={{ py: 6 }} />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Scrollbar>
        </TableContainer>
      )}
    </>
  );
}
