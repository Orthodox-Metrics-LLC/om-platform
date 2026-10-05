import { useRef, useState, useEffect, useCallback } from 'react';

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
import { Iconify } from 'src/components/iconify';
import { Markdown } from 'src/components/markdown';

import {
  sendHandoffNote,
  fetchHandoffNote,
  type HandoffNote,
  fetchHandoffNotes,
  handoffAttachmentUrl,
  type HandoffAttachment,
  sendHandoffAttachments,
  type HandoffNoteSummary,
} from './om-assets-api';

// ----------------------------------------------------------------------

const INBOX = 'FROM-NICK.md';
const MAX_FILES = 8;
const MAX_FILE_BYTES = 200 * 1024 * 1024;
const ACCEPT = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.heic',
  '.mp4', '.webm', '.mov', '.m4v',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.odt', '.ods', '.odp', '.rtf', '.txt', '.csv', '.md', '.zip',
].join(',');

function when(iso: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function titleFor(item: HandoffNoteSummary) {
  return item.name.replace(/\.md$/i, '').replace(/[-_]/g, ' ');
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function AttachmentBlock({ notePath, item }: { notePath: string; item: HandoffAttachment }) {
  const href = handoffAttachmentUrl(notePath, item.id);
  const caption = `${item.name} · ${formatBytes(item.size)}`;

  switch (item.kind) {
    case 'image':
      return (
        <Box>
          <Box
            component="img"
            src={href}
            alt={item.name}
            loading="lazy"
            sx={{ display: 'block', maxWidth: '100%', maxHeight: 420, objectFit: 'contain', borderRadius: 1, bgcolor: 'background.neutral' }}
          />
          <Typography variant="caption" color="text.secondary">{caption}</Typography>
        </Box>
      );
    case 'video':
      return (
        <Box>
          <Box
            component="video"
            controls
            preload="metadata"
            src={href}
            sx={{ display: 'block', width: '100%', maxHeight: 420, borderRadius: 1, bgcolor: 'background.neutral' }}
          />
          <Typography variant="caption" color="text.secondary">{caption}</Typography>
        </Box>
      );
    case 'file':
      return (
        <Button component="a" href={href} download={item.name} variant="outlined" size="small">
          {caption}
        </Button>
      );
    default: {
      const unreachable: never = item.kind;
      return unreachable;
    }
  }
}

export function HandoffNotesView() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<HandoffNoteSummary[]>([]);
  const [selectedPath, setSelectedPath] = useState(INBOX);
  const [note, setNote] = useState<HandoffNote | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingNote, setLoadingNote] = useState(false);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<File[]>([]);
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

  const clearPending = () => {
    setPending([]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const addFiles = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    if (!picked.length) return;
    const tooBig = picked.filter((file) => file.size > MAX_FILE_BYTES);
    if (tooBig.length) toast.error('Each file must be 200 MB or smaller');
    const next = [...pending, ...picked.filter((file) => file.size > 0 && file.size <= MAX_FILE_BYTES)];
    if (next.length > MAX_FILES) toast.error('You can attach up to 8 files at a time');
    setPending(next.slice(0, MAX_FILES));
    if (fileRef.current) fileRef.current.value = '';
  };

  const send = async () => {
    const message = draft.trim();
    if (sending || (!message && pending.length === 0)) return;
    setSending(true);
    try {
      const res = pending.length
        ? await sendHandoffAttachments(selectedPath, message, pending)
        : await sendHandoffNote(selectedPath, message);
      setNote(res.note);
      setDraft('');
      clearPending();
      toast.success(selectedPath === INBOX ? 'Note saved for Cursor' : 'Reply saved on this update');
      await loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save that note');
    } finally {
      setSending(false);
    }
  };

  const inboxSelected = selectedPath === INBOX;
  const attachments = note?.attachments ?? [];

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Updates Cursor leaves after a change, and a place to write back. You can attach images, video, PDF, and Word, Excel, or PowerPoint files. Super admins only.
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
                <Stack direction="row" spacing={0.5} sx={{ ml: 1 }}>
                  {item.has_reply && <Chip size="small" label="Reply" />}
                  {item.attachment_count > 0 && <Chip size="small" label="Files" />}
                </Stack>
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
            <Stack spacing={2} component="form" onSubmit={(event) => { event.preventDefault(); send().catch(() => {}); }}>
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

              {attachments.length > 0 && (
                <Stack spacing={1.5}>
                  <Typography variant="subtitle2">Files</Typography>
                  {attachments.map((item) => (
                    <AttachmentBlock key={item.id} notePath={note.path} item={item} />
                  ))}
                </Stack>
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
                name="message"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={inboxSelected ? 'Write a note for Cursor' : 'Reply on this update'}
                label={inboxSelected ? 'Note' : 'Reply'}
              />

              <Box>
                <Typography variant="subtitle2" component="label" htmlFor="handoff-attachments" sx={{ display: 'block', mb: 1 }}>
                  Attach files
                </Typography>
                <Button component="label" variant="outlined" startIcon={<Iconify icon="eva:attach-2-fill" />}>
                  Choose files
                  <input
                    ref={fileRef}
                    id="handoff-attachments"
                    name="files"
                    type="file"
                    multiple
                    accept={ACCEPT}
                    hidden
                    onChange={(event) => addFiles(event.target.files)}
                  />
                </Button>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                  Images, video, PDF, Word, Excel, PowerPoint, or zip. Up to 8 files, 200 MB each.
                </Typography>
              </Box>

              {pending.length > 0 && (
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                  {pending.map((file, index) => (
                    <Chip
                      key={`${file.name}-${file.size}-${index}`}
                      label={`${file.name} · ${formatBytes(file.size)}`}
                      onDelete={() => setPending((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    />
                  ))}
                </Stack>
              )}

              <Box>
                <Button type="submit" variant="contained" disabled={sending || (!draft.trim() && pending.length === 0)}>
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
