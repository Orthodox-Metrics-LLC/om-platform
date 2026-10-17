import { useMemo, useState, useEffect } from 'react';

import Box from '@mui/material/Box';
import List from '@mui/material/List';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import ListItemText from '@mui/material/ListItemText';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import ListItemButton from '@mui/material/ListItemButton';
import InputAdornment from '@mui/material/InputAdornment';
import CircularProgress from '@mui/material/CircularProgress';

import { Iconify } from 'src/components/iconify';

import { fetchParishes, type ParishSummary } from 'src/sections/admin/parish-settings/parish-settings-api';

// ----------------------------------------------------------------------

export type OmAppKind = 'books' | 'importer';

const openers = new Set<(app: OmAppKind) => void>();

export function openOmAppChurchPicker(app: OmAppKind) {
  openers.forEach((open) => open(app));
}

function appPath(app: OmAppKind): string {
  switch (app) {
    case 'books':
      return '/apps/books/';
    case 'importer':
      return '/apps/importer/';
    default: {
      const unexpected: never = app;
      return unexpected;
    }
  }
}

function appLabel(app: OmAppKind): string {
  switch (app) {
    case 'books':
      return 'OM Book App';
    case 'importer':
      return 'OM Importer App';
    default: {
      const unexpected: never = app;
      return unexpected;
    }
  }
}

function matchesChurch(church: ParishSummary, query: string) {
  if (!query) return true;
  const needle = query.toLowerCase();
  return church.name.toLowerCase().includes(needle) || String(church.id).includes(needle);
}

// ----------------------------------------------------------------------

export function OmAppsChurchDialog() {
  const [app, setApp] = useState<OmAppKind | null>(null);
  const [churches, setChurches] = useState<ParishSummary[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const open = (next: OmAppKind) => {
      setQuery('');
      setApp(next);
    };
    openers.add(open);
    return () => {
      openers.delete(open);
    };
  }, []);

  useEffect(() => {
    if (!app) return undefined;
    let live = true;
    setLoading(true);
    setError(null);
    fetchParishes()
      .then((rows) => {
        if (live) setChurches(rows);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : 'Could not load churches');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [app]);

  const visible = useMemo(
    () => churches.filter((church) => matchesChurch(church, query.trim())),
    [churches, query]
  );

  const close = () => setApp(null);

  const choose = (church: ParishSummary) => {
    if (!app) return;
    window.location.assign(`${appPath(app)}?churchId=${church.id}`);
  };

  return (
    <Dialog open={!!app} onClose={close} fullWidth maxWidth="xs" aria-labelledby="om-apps-church-title">
      <DialogTitle id="om-apps-church-title">{app ? appLabel(app) : 'Choose a church'}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          Choose the church by name or ID.
        </Typography>
        <TextField
          autoFocus
          fullWidth
          size="small"
          label="Search by name or ID"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Iconify icon="eva:search-fill" width={18} sx={{ color: 'text.disabled' }} />
                </InputAdornment>
              ),
            },
          }}
        />
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        )}
        {error && (
          <Typography variant="body2" sx={{ color: 'error.main', mt: 2 }}>
            {error}
          </Typography>
        )}
        {!loading && !error && (
          <List sx={{ maxHeight: 360, overflow: 'auto', mx: -1 }}>
            {visible.map((church) => (
              <ListItemButton key={church.id} onClick={() => choose(church)}>
                <ListItemText
                  primary={church.name}
                  secondary={`ID ${church.id}`}
                />
              </ListItemButton>
            ))}
            {!visible.length && (
              <Typography variant="body2" sx={{ color: 'text.secondary', px: 2, py: 3 }}>
                No churches match that name or ID.
              </Typography>
            )}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={close}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}
