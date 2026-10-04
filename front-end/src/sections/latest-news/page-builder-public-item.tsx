import type { ReactNode } from 'react';
import type { PageItem, PageEffectsConfig } from 'src/sections/admin/page-builder/om-pages-api';

import Autoplay from 'embla-carousel-autoplay';
import { useMemo, useState, useEffect, useCallback } from 'react';
import { m, useScroll, useSpring, useTransform } from 'framer-motion';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Step from '@mui/material/Step';
import Grid from '@mui/material/Grid';
import Table from '@mui/material/Table';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Rating from '@mui/material/Rating';
import Stepper from '@mui/material/Stepper';
import Tooltip from '@mui/material/Tooltip';
import TableRow from '@mui/material/TableRow';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import StepLabel from '@mui/material/StepLabel';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import TableContainer from '@mui/material/TableContainer';
import CircularProgress from '@mui/material/CircularProgress';

import { Image } from 'src/components/image';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { Lightbox, useLightbox } from 'src/components/lightbox';
import { Carousel, useCarousel, CarouselDotButtons, CarouselArrowFloatButtons } from 'src/components/carousel';

// ----------------------------------------------------------------------

type Props = { item: PageItem };

export function PageBuilderPublicItem({ item }: Props) {
  const effects = { ...(item.effects_config || {}) };
  if (item.layout_type === 'animate' && (!effects.animation || effects.animation === 'none')) {
    const variant = String(item.component_config?.variant || 'fadeInUp');
    effects.animation = variant.includes('Left') ? 'slide_left' : variant.includes('zoom') ? 'zoom' : variant.includes('scale') ? 'scale' : variant.includes('rotate') ? 'rotate' : variant.includes('Up') ? 'slide_up' : 'fade';
  }
  const content = effects.parallax ? <ParallaxContent><ItemContent item={item} /></ParallaxContent> : <ItemContent item={item} />;
  const motion = motionProps(effects);

  return (
    <Box sx={{ position: effects.sticky ? 'sticky' : 'relative', top: effects.sticky ? 88 : undefined }}>
      {effects.show_scroll_progress && <ItemScrollProgress />}
      <Box
        component={m.div}
        {...motion}
        sx={{
          opacity: effects.opacity ?? 1,
          filter: effects.blur ? `blur(${effects.blur}px)` : undefined,
          transform: `scale(${effects.scale ?? 1}) rotate(${effects.rotate ?? 0}deg)`,
          transition: 'transform 220ms ease, filter 220ms ease',
          '&:hover': effects.trigger === 'hover' ? { transform: `translateY(-${effects.hover_lift ?? 6}px) scale(${effects.scale ?? 1})` } : undefined,
        }}
      >
        {content}
      </Box>
    </Box>
  );
}

function motionProps(effects: PageEffectsConfig) {
  const transition = { duration: effects.duration ?? 0.5, delay: effects.delay ?? 0 };
  const variants: Record<string, { initial: Record<string, number>; animate: Record<string, number> }> = {
    fade: { initial: { opacity: 0 }, animate: { opacity: 1 } },
    slide_up: { initial: { opacity: 0, y: 40 }, animate: { opacity: 1, y: 0 } },
    slide_left: { initial: { opacity: 0, x: 50 }, animate: { opacity: 1, x: 0 } },
    zoom: { initial: { opacity: 0, scale: 0.8 }, animate: { opacity: 1, scale: 1 } },
    scale: { initial: { scale: 0.75 }, animate: { scale: 1 } },
    rotate: { initial: { opacity: 0, rotate: -8 }, animate: { opacity: 1, rotate: 0 } },
  };
  const selected = variants[effects.animation || 'none'];
  if (!selected || effects.trigger === 'hover') return {};
  return effects.trigger === 'on_load'
    ? { initial: selected.initial, animate: selected.animate, transition }
    : { initial: selected.initial, whileInView: selected.animate, viewport: { once: true, amount: 0.2 }, transition };
}

function ItemScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 24 });
  return <Box component={m.div} style={{ scaleX }} sx={{ height: 3, bgcolor: 'primary.main', transformOrigin: 'left', mb: 1 }} />;
}

function ParallaxContent({ children }: { children: ReactNode }) {
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 1], [40, -40]);
  return <Box component={m.div} style={{ y }}>{children}</Box>;
}

// ----------------------------------------------------------------------

function ItemContent({ item }: Props) {
  const media = item.media || [];
  const primary = media.find((entry) => entry.is_primary) || media[0];
  const config = item.component_config || {};

  if (item.layout_type === 'carousel') return <CarouselItem item={item} />;
  if (item.layout_type === 'lightbox' || item.layout_type === 'image_grid') return <GalleryItem item={item} lightbox={item.layout_type === 'lightbox'} />;
  if (item.layout_type === 'form_wizard') return <WizardItem item={item} />;
  if (item.layout_type === 'timeline') return <TimelineItem item={item} />;
  if (item.layout_type === 'file_upload') return <FileUploadItem item={item} />;
  if (item.layout_type === 'data_table') return <DataTableItem item={item} />;
  if (item.layout_type === 'rating') {
    return (
      <ContentShell item={item}>
        <Rating value={Number(config.rating || 0)} precision={Number(config.precision || 1)} max={Number(config.max || 5)} readOnly={config.readOnly !== false} size="large" />
      </ContentShell>
    );
  }
  if (item.layout_type === 'tooltip') {
    return (
      <ContentShell item={item}>
        <Tooltip title={String(config.tooltip || item.subtitle || '')} placement={(config.placement as any) || 'top'} arrow>
          <Button variant="outlined">{item.cta_label || 'Hover for details'}</Button>
        </Tooltip>
      </ContentShell>
    );
  }
  if (item.layout_type === 'scrollbar') {
    return (
      <ContentShell item={item} hideBody>
        <Scrollbar sx={{ maxHeight: Number(config.maxHeight || 320), pr: 2 }}>
          <Typography sx={{ whiteSpace: 'pre-line' }}>{item.body}</Typography>
        </Scrollbar>
      </ContentShell>
    );
  }
  if (item.layout_type === 'scroll_progress') {
    return <ContentShell item={item}><LinearProgress variant="determinate" value={Number(config.progress || 65)} sx={{ height: 8, borderRadius: 1 }} /></ContentShell>;
  }
  if (item.layout_type === 'utilities') {
    return (
      <Box sx={{ minHeight: Number(config.minHeight || 240), aspectRatio: String(config.ratio || 'auto'), p: 3, borderRadius: 2, display: 'grid', placeItems: 'center', background: config.variant === 'gradient' ? 'linear-gradient(135deg, var(--palette-primary-main), var(--palette-secondary-main))' : 'var(--palette-background-neutral)' }}>
        <ContentText item={item} />
      </Box>
    );
  }
  if (item.layout_type === 'video' && primary) {
    return (
      <ContentShell item={item}>
        <Box component="video" src={primary.file_url} controls poster={media.find((entry) => entry.file_type === 'image')?.file_url} sx={{ width: 1, maxHeight: 640, borderRadius: 2 }} />
      </ContentShell>
    );
  }
  if (item.layout_type === 'split') {
    return (
      <Grid container spacing={4} sx={{ alignItems: 'center' }}>
        <Grid size={{ xs: 12, md: 6 }}><ContentText item={item} /></Grid>
        <Grid size={{ xs: 12, md: 6 }}>{primary && <Image alt={primary.alt_text || item.title} src={primary.file_url} ratio="4/3" sx={{ borderRadius: 2 }} />}</Grid>
      </Grid>
    );
  }
  if (item.layout_type === 'hero') {
    return (
      <Box sx={{ p: { xs: 4, md: 8 }, minHeight: 400, display: 'grid', placeItems: 'center', textAlign: 'center', borderRadius: 3, color: primary ? 'common.white' : 'text.primary', bgcolor: 'background.neutral', backgroundImage: primary ? `linear-gradient(rgba(0,0,0,.46),rgba(0,0,0,.46)),url(${primary.file_url})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <ContentText item={item} />
      </Box>
    );
  }
  if (item.layout_type === 'banner') return <Box sx={{ p: 3, borderRadius: 2, bgcolor: 'primary.main', color: 'primary.contrastText' }}><ContentText item={item} /></Box>;
  if (item.layout_type === 'quote') return <Box component="blockquote" sx={{ m: 0, py: 2, px: 4, borderLeft: 4, borderColor: 'primary.main' }}><Typography variant="h5">“{item.body || item.title}”</Typography>{item.subtitle && <Typography sx={{ mt: 1, color: 'text.secondary' }}>— {item.subtitle}</Typography>}</Box>;

  return <Card sx={{ p: 3 }}><ContentText item={item} />{primary?.file_type === 'image' && <Image alt={primary.alt_text || item.title} src={primary.file_url} ratio="16/9" sx={{ mt: 2, borderRadius: 2 }} />}</Card>;
}

function ContentShell({ item, children, hideBody = false }: { item: PageItem; children?: ReactNode; hideBody?: boolean }) {
  return <Card sx={{ p: 3 }}><ContentText item={item} hideBody={hideBody} />{children && <Box sx={{ mt: 2 }}>{children}</Box>}</Card>;
}

function ContentText({ item, hideBody = false }: { item: PageItem; hideBody?: boolean }) {
  return (
    <Box>
      <Typography variant="h4">{item.title}</Typography>
      {item.subtitle && <Typography variant="subtitle1" sx={{ mt: 0.5, color: 'text.secondary' }}>{item.subtitle}</Typography>}
      {!hideBody && item.body && <Typography sx={{ mt: 2, whiteSpace: 'pre-line' }}>{item.body}</Typography>}
      <OnboardingFee item={item} />
      {item.cta_label && item.cta_url && <Button href={item.cta_url} variant="contained" sx={{ mt: 2 }}>{item.cta_label}</Button>}
    </Box>
  );
}

function formatUsd(value: number) {
  return `$${value.toLocaleString('en-US')}`;
}

/** Pricing cards — a one-time onboarding fee, shown separately from the monthly price/features. */
function OnboardingFee({ item }: { item: PageItem }) {
  const onboarding = item.component_config?.onboarding;
  if (!onboarding || (!onboarding.self_service_fee && !onboarding.om_service_fee)) return null;

  return (
    <Box sx={{ mt: 2.5, p: 2, borderRadius: 1.5, bgcolor: 'background.neutral' }}>
      <Typography variant="subtitle2">Onboarding Fee</Typography>
      <Stack spacing={1} sx={{ mt: 1 }}>
        {!!onboarding.self_service_fee && (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Self Service — {formatUsd(onboarding.self_service_fee)}
            </Typography>
            {!!onboarding.self_service_cap && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Up to {onboarding.self_service_cap.toLocaleString('en-US')} records
                {!!onboarding.self_service_additional_fee && !!onboarding.self_service_additional_block && (
                  <>, then {formatUsd(onboarding.self_service_additional_fee)} per additional {onboarding.self_service_additional_block.toLocaleString('en-US')} records</>
                )}
              </Typography>
            )}
          </Box>
        )}
        {!!onboarding.om_service_fee && (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              OM Service — {formatUsd(onboarding.om_service_fee)}
            </Typography>
            {!!onboarding.om_service_cap && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Up to {onboarding.om_service_cap.toLocaleString('en-US')} records
              </Typography>
            )}
          </Box>
        )}
      </Stack>
    </Box>
  );
}

// ----------------------------------------------------------------------

function GalleryItem({ item, lightbox: enabled }: Props & { lightbox: boolean }) {
  const images = (item.media || []).filter((entry) => entry.file_type === 'image');
  const slides = useMemo(() => images.map((image) => ({ src: image.file_url, alt: image.alt_text || item.title })), [images, item.title]);
  const lightbox = useLightbox(slides);
  const columns = Math.min(6, Math.max(1, Number(item.component_config?.columns || 3)));
  return (
    <ContentShell item={item}>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: `repeat(${Math.min(2, columns)},1fr)`, md: `repeat(${columns},1fr)` } }}>
        {images.map((image) => <Image key={image.id} alt={image.alt_text || item.title} src={image.file_url} ratio="1/1" onClick={() => enabled && lightbox.onOpen(image.file_url)} sx={{ borderRadius: 2, cursor: enabled ? 'zoom-in' : 'default' }} />)}
      </Box>
      {enabled && <Lightbox index={lightbox.selected} slides={slides} open={lightbox.open} close={lightbox.onClose} />}
    </ContentShell>
  );
}

function CarouselItem({ item }: Props) {
  const config = item.component_config || {};
  const images = (item.media || []).filter((entry) => entry.file_type === 'image');
  const plugins = config.autoplay === false ? [] : [Autoplay({ delay: Number(config.autoplayDelay || 5000) })];
  const carousel = useCarousel({ loop: config.loop !== false, slidesToShow: Number(config.slidesToShow || 1), slideSpacing: '16px' }, plugins);
  return (
    <ContentShell item={item}>
      <Box sx={{ position: 'relative' }}>
        <Carousel carousel={carousel}>
          {images.map((image) => <Image key={image.id} alt={image.alt_text || item.title} src={image.file_url} ratio="16/9" sx={{ borderRadius: 2 }} />)}
        </Carousel>
        <CarouselArrowFloatButtons {...carousel.arrows} options={carousel.options} />
        <CarouselDotButtons {...carousel.dots} sx={{ mt: 2 }} />
      </Box>
    </ContentShell>
  );
}

function WizardItem({ item }: Props) {
  const steps = item.component_config?.steps || [];
  const [active, setActive] = useState(0);
  const current = steps[active];
  return (
    <ContentShell item={item}>
      <Stepper activeStep={active} alternativeLabel>{steps.map((step) => <Step key={step.title}><StepLabel>{step.title}</StepLabel></Step>)}</Stepper>
      {current && <Box sx={{ py: 4, textAlign: 'center' }}><Typography variant="h6">{current.title}</Typography><Typography sx={{ color: 'text.secondary' }}>{current.body}</Typography></Box>}
      <Stack direction="row" sx={{ justifyContent: 'space-between' }}><Button disabled={active === 0} onClick={() => setActive((value) => value - 1)}>Back</Button><Button variant="contained" disabled={active >= steps.length - 1} onClick={() => setActive((value) => value + 1)}>Next</Button></Stack>
    </ContentShell>
  );
}

function TimelineItem({ item }: Props) {
  const events = item.component_config?.timeline || [];
  return (
    <ContentShell item={item}>
      <Stack>
        {events.map((event, index) => (
          <Box key={`${event.title}-${index}`} sx={{ position: 'relative', pl: 4, pb: index === events.length - 1 ? 0 : 4, '&:before': { content: '""', position: 'absolute', left: 7, top: 18, bottom: 0, width: 2, bgcolor: 'divider' }, '&:after': { content: '""', position: 'absolute', left: 0, top: 6, width: 16, height: 16, borderRadius: '50%', bgcolor: 'primary.main' } }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{event.date}</Typography><Typography variant="subtitle1">{event.title}</Typography>{event.body && <Typography variant="body2">{event.body}</Typography>}
          </Box>
        ))}
      </Stack>
    </ContentShell>
  );
}

// ----------------------------------------------------------------------
// Live components — unlike everything above, these actually call the
// backend at render time instead of rendering stored copy/media.
// ----------------------------------------------------------------------

function FileUploadItem({ item }: Props) {
  const config = item.component_config || {};
  const endpoint = String(config.uploadEndpoint || '');
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleBrowse = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files ? Array.from(event.target.files) : [];
    if (picked.length) setFiles((prev) => [...prev, ...picked]);
    event.target.value = '';
  };

  const handleUpload = async () => {
    if (!endpoint || files.length === 0) return;
    setUploading(true);
    setResult(null);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append('files', file));
      if (config.uploadChurchId) formData.append('churchId', String(config.uploadChurchId));
      if (config.uploadRecordType) formData.append('recordType', String(config.uploadRecordType));
      if (config.uploadLanguage) formData.append('language', String(config.uploadLanguage));
      if (config.uploadLayoutMode) formData.append('recordLayoutMode', String(config.uploadLayoutMode));

      const response = await fetch(endpoint, { method: 'POST', body: formData, credentials: 'include' });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success === false) {
        throw new Error(body?.error || body?.message || `Upload failed (${response.status})`);
      }
      setFiles([]);
      setResult({ ok: true, message: body?.message || 'Upload successful.' });
    } catch (err: any) {
      setResult({ ok: false, message: err?.message || 'Upload failed.' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <ContentShell item={item} hideBody={!item.body}>
      <Stack spacing={2}>
        <Box
          sx={{
            p: 4,
            gap: 1.5,
            display: 'flex',
            textAlign: 'center',
            alignItems: 'center',
            borderRadius: 1.5,
            borderStyle: 'dashed',
            borderWidth: 1,
            flexDirection: 'column',
            borderColor: 'divider',
          }}
        >
          <Iconify icon={'solar:cloud-upload-bold' as any} width={44} sx={{ color: 'text.disabled' }} />
          <Button component="label" variant="contained">
            {String(config.uploadButtonLabel || 'Choose files')}
            <Box
              component="input"
              type="file"
              multiple
              onChange={handleBrowse}
              sx={{ display: 'none' }}
            />
          </Button>
          {config.uploadHelperText ? (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {String(config.uploadHelperText)}
            </Typography>
          ) : null}
          {files.length > 0 && (
            <Typography variant="body2">{files.length} file{files.length === 1 ? '' : 's'} selected</Typography>
          )}
        </Box>

        <Stack direction="row" spacing={2} sx={{ justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            disabled={!endpoint || files.length === 0 || uploading}
            onClick={handleUpload}
            startIcon={uploading ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </Button>
        </Stack>

        {result && (
          <Typography variant="body2" sx={{ color: result.ok ? 'success.main' : 'error.main' }}>
            {result.message}
          </Typography>
        )}
      </Stack>
    </ContentShell>
  );
}

function DataTableItem({ item }: Props) {
  const config = item.component_config || {};
  const endpoint = String(config.tableEndpoint || '');
  const rowsPath = String(config.tableRowsPath || '');
  const columns = Array.isArray(config.tableColumns) && config.tableColumns.length > 0
    ? config.tableColumns
    : [{ key: 'id', label: 'ID' }];

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!endpoint) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(endpoint, { credentials: 'include' });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || body?.message || `Request failed (${response.status})`);

      let data: unknown = body;
      if (rowsPath) {
        for (const segment of rowsPath.split('.').filter(Boolean)) {
          data = (data as any)?.[segment];
        }
      } else if (!Array.isArray(data)) {
        const guess = ['items', 'rows', 'data', 'jobs', 'campaigns', 'results'].find((key) => Array.isArray((data as any)?.[key]));
        if (guess) data = (data as any)[guess];
      }
      setRows(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load data');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [endpoint, rowsPath]);

  useEffect(() => { load(); }, [load]);

  return (
    <ContentShell item={item} hideBody={!item.body}>
      {error && <Typography color="error" variant="body2" sx={{ mb: 2 }}>{error}</Typography>}
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              {columns.map((col) => <TableCell key={col.key}>{col.label}</TableCell>)}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  No data to display.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, index) => (
                 
                <TableRow key={index}>
                  {columns.map((col) => {
                    const value = row?.[col.key];
                    return (
                      <TableCell key={col.key}>
                        {value === null || value === undefined
                          ? '—'
                          : typeof value === 'object'
                            ? JSON.stringify(value)
                            : String(value)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </ContentShell>
  );
}
