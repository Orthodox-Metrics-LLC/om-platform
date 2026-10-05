import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ListItemText from '@mui/material/ListItemText';
import ListItemButton from '@mui/material/ListItemButton';
import CircularProgress from '@mui/material/CircularProgress';

import { toast } from 'src/components/snackbar';
import { Markdown } from 'src/components/markdown';

import {
  sendHandoffNote,
  fetchHandoffNote,
  type HandoffNote,
  fetchHandoffNotes,
  type HandoffNoteSummary,
} from './om-assets-api';

// ----------------------------------------------------------------------

const INBOX = 'FROM-NICK.md';

function when(iso: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function titleFor(item: HandoffNoteSummary) {
  return item.name.replace(/\.md$/i, '').replace(/[-_]/g, ' ');
}

export function HandoffNotesView() {
  const [items, setItems] = useState<HandoffNoteSummary[]>([]);
  const [selectedPath, setSelectedPath] = useState(INBOX);
  const [note, setNote] = useState<HandoffNote | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingNote, setLoadingNote] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const loadList = useCallback(async () => {
    setLoadingList(true);
    setError('');
    try {
      const res = await fetchHandoffNotes();
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load updates');
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadNote = useCallback(async (filePath: string) => {
    setLoadingNote(true);
    setError('');
    try {
      setNote(await fetchHandoffNote(filePath));
    } catch (e) {
      setNote(null);
      setError(e instanceof Error ? e.message : 'Could not open that update');
    } finally {
      setLoadingNote(false);
    }
  }, []);

  useEffect(() => {
    loadList().catch(() => {});
  }, [loadList]);

  useEffect(() => {
    loadNote(selectedPath).catch(() => {});
  }, [loadNote, selectedPath]);

  const send = async () => {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    try {
      const res = await sendHandoffNote(selectedPath, message);
      setNote(res.note);
      setDraft('');
      toast.success(selectedPath === INBOX ? 'Note saved for Cursor' : 'Reply saved on this update');
      await loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save that note');
    } finally {
      setSending(false);
    }
  };

  const inboxSelected = selectedPath === INBOX;

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Updates Cursor leaves after a change, and a place to write back. Super admins only.
      </Typography>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Card sx={{ width: { md: 340 }, flexShrink: 0, maxHeight: { md: 760 }, overflow: 'auto' }}>
          <List disablePadding>
            <ListItemButton selected={inboxSelected} onClick={() => setSelectedPath(INBOX)}>
              <ListItemText
                primary="Notes to Cursor"
                secondary="Write something that isn’t tied to one update"
                slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
              />
            </ListItemButton>
            {loadingList && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                <CircularProgress size={22} />
              </Box>
            )}
            {items.map((item) => (
              <ListItemButton key={item.path} selected={item.path === selectedPath} onClick={() => setSelectedPath(item.path)}>
                <ListItemText
                  primary={titleFor(item)}
                  secondary={item.folder ? `${item.folder} · ${when(item.modified_at)}` : when(item.modified_at)}
                  slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
                />
                {item.has_reply && <Chip size="small" label="Reply" sx={{ ml: 1 }} />}
              </ListItemButton>
            ))}
          </List>
        </Card>

        <Card sx={{ flex: 1, p: 2.5, minWidth: 0 }}>
          {loadingNote && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress size={24} />
            </Box>
          )}
          {!loadingNote && error && (
            <Typography color="error" variant="body2">{error}</Typography>
          )}
          {!loadingNote && note && (
            <Stack spacing={2}>
              <Box>
                <Typography variant="h6">{inboxSelected ? 'Notes to Cursor' : note.name.replace(/\.md$/i, '').replace(/[-_]/g, ' ')}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {note.folder ? `${note.folder} · ` : ''}
                  {when(note.modified_at) || 'No notes yet'}
                </Typography>
              </Box>

              {note.content ? (
                <Markdown>{note.content}</Markdown>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {inboxSelected ? 'Nothing sent yet. Write a note below and it is saved for the next session.' : 'This update has no text.'}
                </Typography>
              )}

              {!inboxSelected && note.reply && (
                <Box sx={{ p: 2, borderRadius: 1, bgcolor: 'background.neutral' }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Your replies</Typography>
                  <Markdown>{note.reply}</Markdown>
                </Box>
              )}

              <TextField
                multiline
                minRows={3}
                fullWidth
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={inboxSelected ? 'Write a note for Cursor' : 'Reply on this update'}
              />
              <Box>
                <Button variant="contained" onClick={send} disabled={!draft.trim() || sending}>
                  {sending ? 'Saving…' : 'Send'}
                </Button>
              </Box>
            </Stack>
          )}
        </Card>
      </Stack>
    </Stack>
  );
}
