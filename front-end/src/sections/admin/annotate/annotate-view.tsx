import type { IconifyName } from 'src/components/iconify';

import { useRef, useState, useEffect } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

import { paths } from 'src/routes/paths';

import { DashboardContent } from 'src/layouts/dashboard';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { EmptyContent } from 'src/components/empty-content';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { useAuthContext } from 'src/auth/hooks';

// ----------------------------------------------------------------------

const COLORS = ['#111827', '#16a34a', '#dc2626', '#d97706', '#2563eb'] as const;

type Tool = 'callout' | 'arrow' | 'box' | 'highlight';

type Point = { x: number; y: number };

type Mark =
  | { id: string; kind: 'callout'; x: number; y: number; text: string; color: string }
  | { id: string; kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; color: string }
  | { id: string; kind: 'box'; x: number; y: number; w: number; h: number; color: string }
  | { id: string; kind: 'highlight'; x: number; y: number; w: number; h: number; color: string };

type Bounds = { x: number; y: number; w: number; h: number; pinX: number; pinY: number };

const TOOLS: { value: Tool; label: string; icon: IconifyName }[] = [
  { value: 'callout', label: 'Note', icon: 'solar:chat-round-dots-bold' },
  { value: 'arrow', label: 'Arrow', icon: 'eva:arrow-forward-fill' },
  { value: 'box', label: 'Box', icon: 'solar:gallery-wide-bold' },
  { value: 'highlight', label: 'Highlight', icon: 'solar:flag-bold' },
];

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function rectFrom(x1: number, y1: number, x2: number, y2: number) {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

function textOn(color: string) {
  const hex = color.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#111827' : '#ffffff';
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = 18;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

function drawCallout(
  ctx: CanvasRenderingContext2D,
  mark: Extract<Mark, { kind: 'callout' }>,
  imageW: number,
  imageH: number,
  selected: boolean
): Bounds {
  const pinR = 8;
  ctx.fillStyle = mark.color;
  ctx.beginPath();
  ctx.arc(mark.x, mark.y, pinR, 0, Math.PI * 2);
  ctx.fill();
  if (selected) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  const label = mark.text.trim();
  if (!label) return { x: mark.x - pinR, y: mark.y - pinR, w: pinR * 2, h: pinR * 2, pinX: mark.x, pinY: mark.y };

  const fontSize = Math.round(Math.max(20, Math.min(34, imageW / 48)));
  ctx.font = `600 ${fontSize}px "Public Sans Variable", "Public Sans", sans-serif`;
  const maxText = Math.min(460, imageW * 0.46);
  const lines = wrapLines(ctx, label, maxText);
  const lineH = Math.round(fontSize * 1.3);
  const padX = 16;
  const padY = 12;
  const textW = Math.max(...lines.map((line) => ctx.measureText(line).width));
  const bw = textW + padX * 2;
  const bh = lines.length * lineH + padY * 2;
  const gap = 14;

  let bx = mark.x - bw / 2;
  let by = mark.y - bh - gap - pinR;
  let tailFrom: 'bottom' | 'top' = 'bottom';
  if (by < 8) {
    by = mark.y + gap + pinR;
    tailFrom = 'top';
  }
  bx = Math.max(8, Math.min(bx, imageW - bw - 8));
  by = Math.max(8, Math.min(by, imageH - bh - 8));

  const anchorX = Math.max(bx + 18, Math.min(mark.x, bx + bw - 18));
  const anchorY = tailFrom === 'bottom' ? by + bh : by;

  ctx.strokeStyle = mark.color;
  ctx.fillStyle = mark.color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(anchorX, anchorY);
  ctx.lineTo(mark.x, mark.y);
  ctx.stroke();

  roundRect(ctx, bx, by, bw, bh, 12);
  ctx.fill();
  if (selected) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.fillStyle = textOn(mark.color);
  ctx.textBaseline = 'top';
  lines.forEach((line, index) => {
    ctx.fillText(line, bx + padX, by + padY + index * lineH);
  });

  return { x: bx, y: by, w: bw, h: bh, pinX: mark.x, pinY: mark.y };
}

function paint(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  marks: Mark[],
  draft: Mark | null,
  selectedId: string | null,
  bounds: Map<string, Bounds>
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  if (canvas.width !== image.naturalWidth || canvas.height !== image.naturalHeight) {
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  bounds.clear();

  [...marks, ...(draft ? [draft] : [])].forEach((mark) => {
    switch (mark.kind) {
      case 'arrow':
        drawArrow(ctx, mark.x1, mark.y1, mark.x2, mark.y2, mark.color);
        break;
      case 'box':
        ctx.strokeStyle = mark.color;
        ctx.lineWidth = 4;
        roundRect(ctx, mark.x, mark.y, mark.w, mark.h, 8);
        ctx.stroke();
        break;
      case 'highlight':
        ctx.fillStyle = `${mark.color}55`;
        ctx.fillRect(mark.x, mark.y, mark.w, mark.h);
        break;
      case 'callout':
        bounds.set(mark.id, drawCallout(ctx, mark, canvas.width, canvas.height, mark.id === selectedId));
        break;
      default: {
        const unreachable: never = mark;
        void unreachable;
      }
    }
  });
}

function hitCallout(bounds: Map<string, Bounds>, point: Point) {
  const entries = [...bounds.entries()].reverse();
  const found = entries.find(([, box]) => {
    const inside = point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
    const dx = point.x - box.pinX;
    const dy = point.y - box.pinY;
    return inside || dx * dx + dy * dy < 20 * 20;
  });
  return found?.[0] ?? null;
}

// ----------------------------------------------------------------------

/**
 * Paste a screenshot, drop notes and arrows on it, then download the marked-up image.
 * The picture is the handoff.
 */
export function AnnotateView() {
  const { user } = useAuthContext();
  const allowed = user?.role === 'super_admin' || user?.role === 'admin';

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const marksRef = useRef<Mark[]>([]);
  const boundsRef = useRef<Map<string, Bounds>>(new Map());
  const urlRef = useRef<string | null>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ kind: Exclude<Tool, 'callout'>; x1: number; y1: number; x2: number; y2: number } | null>(null);

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [tool, setTool] = useState<Tool>('callout');
  const [color, setColor] = useState<string>(COLORS[0]);
  const [note, setNote] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragTick, setDragTick] = useState(0);

  marksRef.current = marks;
  imageRef.current = image;

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const current = imageRef.current;
    if (!canvas || !current) return;
    const draft = dragRef.current ? draftMark(dragRef.current, color) : null;
    paint(canvas, current, marks, draft, selectedId, boundsRef.current);
  }, [marks, image, selectedId, color, dragTick]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files ?? []).find((item) => item.type.startsWith('image/'));
      if (!file) return;
      event.preventDefault();
      loadFile(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const loadFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Choose an image');
      return;
    }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(file);
    urlRef.current = url;
    const img = new Image();
    img.onload = () => {
      setImage(img);
      setMarks([]);
      setSelectedId(null);
      setNote('');
    };
    img.src = url;
  };

  const selectCallout = (id: string) => {
    const mark = marksRef.current.find((item) => item.id === id && item.kind === 'callout');
    if (!mark || mark.kind !== 'callout') return;
    setSelectedId(id);
    setNote(mark.text);
    setColor(mark.color);
    noteRef.current?.focus();
  };

  const placeCallout = (point: Point) => {
    const id = newId();
    const text = selectedId ? '' : note.trim();
    setMarks((prev) => [...prev, { id, kind: 'callout', x: point.x, y: point.y, text, color }]);
    setSelectedId(id);
    setNote(text);
    noteRef.current?.focus();
  };

  const updateNote = (value: string) => {
    setNote(value);
    if (!selectedId) return;
    setMarks((prev) => prev.map((mark) => (mark.id === selectedId && mark.kind === 'callout' ? { ...mark, text: value } : mark)));
  };

  const pickColor = (next: string) => {
    setColor(next);
    if (!selectedId) return;
    setMarks((prev) => prev.map((mark) => (mark.id === selectedId ? { ...mark, color: next } : mark)));
  };

  const undo = () => {
    setMarks((prev) => prev.slice(0, -1));
    setSelectedId(null);
    setNote('');
  };

  const removeSelected = () => {
    if (!selectedId) return;
    setMarks((prev) => prev.filter((mark) => mark.id !== selectedId));
    setSelectedId(null);
    setNote('');
  };

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * event.currentTarget.width,
      y: ((event.clientY - rect.top) / rect.height) * event.currentTarget.height,
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointFromEvent(event);
    if (tool === 'callout') {
      const hit = hitCallout(boundsRef.current, point);
      if (hit) selectCallout(hit);
      else placeCallout(point);
      return;
    }
    dragRef.current = { kind: tool, x1: point.x, y1: point.y, x2: point.x, y2: point.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    const point = pointFromEvent(event);
    dragRef.current = { ...dragRef.current, x2: point.x, y2: point.y };
    setDragTick((tick) => tick + 1);
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    const box = rectFrom(drag.x1, drag.y1, drag.x2, drag.y2);
    if (box.w >= 6 || box.h >= 6 || drag.kind === 'arrow') {
      const mark = draftMark(drag, color);
      if (mark) setMarks((prev) => [...prev, mark]);
    }
    setDragTick((tick) => tick + 1);
  };

  const capture = async () => {
    const canvas = canvasRef.current;
    const current = imageRef.current;
    if (!canvas || !current) return null;
    paint(canvas, current, marksRef.current, null, null, boundsRef.current);
    const blob = await new Promise<Blob | null>((resolve) => { canvas.toBlob(resolve, 'image/png'); });
    paint(canvas, current, marksRef.current, null, selectedId, boundsRef.current);
    return blob;
  };

  const download = async () => {
    const blob = await capture();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `annotate-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const copyImage = async () => {
    try {
      const blob = await capture();
      if (!blob) return;
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast.success('Copied the annotated image');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not copy the image');
    }
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) loadFile(file);
  };

  if (!allowed) {
    return (
      <DashboardContent maxWidth="xl">
        <EmptyContent filled title="Administrators only" description="Annotate is available to platform administrators." sx={{ py: 10 }} />
      </DashboardContent>
    );
  }

  return (
    <DashboardContent maxWidth="xl">
      <CustomBreadcrumbs
        heading="Annotate"
        links={[{ name: 'Dashboard', href: paths.dashboard.root }, { name: 'Annotate' }]}
        sx={{ mb: 2 }}
      />

      <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
        Paste a screenshot, click to drop a note, and download the marked-up image. That picture is the handoff.
      </Typography>

      <Box sx={{ mb: 2, gap: 1.5, display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
        <Button variant="outlined" component="label" color="inherit" startIcon={<Iconify icon="eva:cloud-upload-fill" />}>
          Open screenshot
          <input hidden type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) loadFile(file); event.target.value = ''; }} />
        </Button>
        <ToggleButtonGroup size="small" exclusive value={tool} onChange={(_, value: Tool | null) => { if (value) setTool(value); }}>
          {TOOLS.map((item) => (
            <ToggleButton key={item.value} value={item.value}>
              <Iconify icon={item.icon} width={18} sx={{ mr: 0.75 }} />
              {item.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Box sx={{ display: 'flex', gap: 0.75 }}>
          {COLORS.map((swatch) => (
            <Box
              key={swatch}
              component="button"
              type="button"
              aria-label={swatch}
              onClick={() => pickColor(swatch)}
              sx={{
                width: 22,
                height: 22,
                p: 0,
                borderRadius: '50%',
                bgcolor: swatch,
                cursor: 'pointer',
                border: '2px solid',
                borderColor: color === swatch ? 'text.primary' : 'transparent',
              }}
            />
          ))}
        </Box>
        <TextField
          inputRef={noteRef}
          size="small"
          placeholder="Note, for example: change the name to Submit batch"
          value={note}
          onChange={(event) => updateNote(event.target.value)}
          sx={{ minWidth: 280, flexGrow: 1 }}
        />
        <Button color="inherit" disabled={!marks.length} onClick={undo}>Undo</Button>
        <Button color="inherit" disabled={!selectedId} onClick={removeSelected}>Remove</Button>
        <Button variant="outlined" color="inherit" disabled={!image} onClick={copyImage}>Copy</Button>
        <Button variant="contained" disabled={!image} onClick={download}>Download</Button>
      </Box>

      <Box
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        sx={{
          minHeight: 480,
          borderRadius: 2,
          border: (theme) => `1px dashed ${theme.vars.palette.divider}`,
          bgcolor: 'background.neutral',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'auto',
        }}
      >
        {image ? (
          <Box
            component="canvas"
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            sx={{ width: '100%', height: 'auto', cursor: 'crosshair', touchAction: 'none', display: 'block' }}
          />
        ) : (
          <Box sx={{ py: 10, px: 3, textAlign: 'center' }}>
            <Typography variant="h6">Paste a screenshot</Typography>
            <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
              Ctrl+V, or drop an image here. Then click the page where the change belongs and type the note.
            </Typography>
          </Box>
        )}
      </Box>
    </DashboardContent>
  );
}

function draftMark(
  drag: { kind: Exclude<Tool, 'callout'>; x1: number; y1: number; x2: number; y2: number },
  color: string
): Mark | null {
  if (drag.kind === 'arrow') {
    return { id: 'draft', kind: 'arrow', x1: drag.x1, y1: drag.y1, x2: drag.x2, y2: drag.y2, color };
  }
  const box = rectFrom(drag.x1, drag.y1, drag.x2, drag.y2);
  if (drag.kind === 'box') return { id: 'draft', kind: 'box', ...box, color };
  if (drag.kind === 'highlight') return { id: 'draft', kind: 'highlight', ...box, color };
  const unreachable: never = drag.kind;
  return unreachable;
}
