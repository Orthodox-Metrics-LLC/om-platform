import type { ReactNode } from 'react';
import type { PageItem, PageEffectsConfig } from 'src/sections/admin/page-builder/om-pages-api';

import { useMemo, useState } from 'react';
import Autoplay from 'embla-carousel-autoplay';
import { m, useScroll, useSpring } from 'framer-motion';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Step from '@mui/material/Step';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Rating from '@mui/material/Rating';
import Stepper from '@mui/material/Stepper';
import Tooltip from '@mui/material/Tooltip';
import StepLabel from '@mui/material/StepLabel';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';

import { Image } from 'src/components/image';
import { Scrollbar } from 'src/components/scrollbar';
import { Lightbox, useLightbox } from 'src/components/lightbox';
import { Carousel, useCarousel, CarouselDotButtons, CarouselArrowFloatButtons } from 'src/components/carousel';

// ----------------------------------------------------------------------

type Props = { item: PageItem };

export function PageBuilderPublicItem({ item }: Props) {
  const effects = item.effects_config || {};
  const content = <ItemContent item={item} />;
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

// ----------------------------------------------------------------------

function ItemContent({ item }: Props) {
  const media = item.media || [];
  const primary = media.find((entry) => entry.is_primary) || media[0];
  const config = item.component_config || {};

  if (item.layout_type === 'carousel') return <CarouselItem item={item} />;
  if (item.layout_type === 'lightbox' || item.layout_type === 'image_grid') return <GalleryItem item={item} lightbox={item.layout_type === 'lightbox'} />;
  if (item.layout_type === 'form_wizard') return <WizardItem item={item} />;
  if (item.layout_type === 'timeline') return <TimelineItem item={item} />;
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
      {item.cta_label && item.cta_url && <Button href={item.cta_url} variant="contained" sx={{ mt: 2 }}>{item.cta_label}</Button>}
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
