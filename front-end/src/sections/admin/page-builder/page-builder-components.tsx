import type { PageType, PageItem, LayoutType, PageItemConfig, PageEffectsConfig } from './om-pages-api';

import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import InputLabel from '@mui/material/InputLabel';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';

// ----------------------------------------------------------------------

export type BuilderComponent = {
  type: LayoutType;
  label: string;
  description: string;
  icon: string;
  defaults?: PageItemConfig;
  /**
   * Restricts this component to specific page types (the type-specific
   * component palette). Omitted = available on every page type, which is
   * the case for all the decorative/static components below. The two live,
   * data-bound components are scoped to the "flexible content" page types
   * (latest_news, checkout, payment, pricing) and excluded from the
   * placeholder surfaces (coming_soon, maintenance, error_*) where a live
   * widget calling the backend wouldn't make sense.
   */
  pageTypes?: PageType[];
};

const LIVE_COMPONENT_PAGE_TYPES: PageType[] = ['latest_news', 'checkout', 'payment', 'pricing'];

export const BUILDER_COMPONENTS: BuilderComponent[] = [
  { type: 'hero', label: 'Hero', description: 'Headline, copy, CTA and background media', icon: 'solar:star-bold-duotone' },
  { type: 'split', label: 'Split content', description: 'Text and media in two columns', icon: 'solar:columns-bold-duotone' },
  { type: 'card', label: 'Content card', description: 'Contained announcement or feature card', icon: 'solar:card-bold-duotone' },
  { type: 'banner', label: 'Banner', description: 'Full-width callout strip', icon: 'solar:flag-bold-duotone' },
  { type: 'quote', label: 'Quote', description: 'Highlighted quotation or testimonial', icon: 'solar:chat-square-quote-bold-duotone' },
  { type: 'image_grid', label: 'Image grid', description: 'Responsive Asset Manager gallery', icon: 'solar:gallery-wide-bold-duotone', defaults: { columns: 3 } },
  { type: 'video', label: 'Video', description: 'Asset Manager video with controls', icon: 'solar:videocamera-record-bold-duotone' },
  { type: 'animate', label: 'Animate', description: 'Animated content using Minimal motion variants', icon: 'solar:magic-stick-3-bold-duotone', defaults: { variant: 'fadeInUp' } },
  { type: 'utilities', label: 'Utilities', description: 'Responsive box, ratio, spacing and visibility helpers', icon: 'solar:widget-5-bold-duotone', defaults: { variant: 'aspect_ratio', ratio: '16/9', minHeight: 240 } },
  { type: 'scrollbar', label: 'Scrollbar', description: 'Styled scrollable content area', icon: 'solar:sort-vertical-bold-duotone', defaults: { maxHeight: 320 } },
  { type: 'scroll_progress', label: 'Scroll progress', description: 'Reading progress indicator', icon: 'solar:chart-square-bold-duotone', defaults: { variant: 'linear', position: 'top' } },
  { type: 'lightbox', label: 'Lightbox', description: 'Click-to-expand Asset Manager image gallery', icon: 'solar:gallery-round-bold-duotone', defaults: { columns: 3 } },
  { type: 'form_wizard', label: 'Form wizard', description: 'Multi-step guided content or form', icon: 'solar:list-check-bold-duotone', defaults: { steps: [{ title: 'Step 1', body: 'First step' }, { title: 'Step 2', body: 'Second step' }] } },
  { type: 'carousel', label: 'Carousel', description: 'Responsive media/content carousel', icon: 'solar:slider-horizontal-bold-duotone', defaults: { slidesToShow: 1, autoplay: true, loop: true, variant: 'dots' } },
  { type: 'timeline', label: 'Timeline', description: 'Chronological events and milestones', icon: 'solar:history-bold-duotone', defaults: { timeline: [{ title: 'Milestone', body: 'Describe this event', date: 'Today' }] } },
  { type: 'tooltip', label: 'Tooltip', description: 'Contextual hover or focus help', icon: 'solar:info-circle-bold-duotone', defaults: { tooltip: 'Helpful information', placement: 'top' } },
  { type: 'rating', label: 'Rating', description: 'Interactive or read-only rating display', icon: 'solar:star-bold-duotone', defaults: { rating: 4.5, precision: 0.5, max: 5, readOnly: true } },
  {
    type: 'file_upload',
    label: 'File upload',
    description: 'Live upload widget that posts files to a backend endpoint (e.g. OCR intake)',
    icon: 'solar:upload-square-bold-duotone',
    defaults: { uploadEndpoint: '/api/ocr/jobs/upload', uploadRecordType: 'custom', uploadLanguage: 'en', uploadLayoutMode: 'auto', uploadButtonLabel: 'Upload' },
    pageTypes: LIVE_COMPONENT_PAGE_TYPES,
  },
  {
    type: 'data_table',
    label: 'Data table',
    description: 'Live table bound to a GET API endpoint',
    icon: 'solar:table-bold-duotone',
    defaults: { tableEndpoint: '', tableColumns: [{ key: 'id', label: 'ID' }], tableRowsPath: '' },
    pageTypes: LIVE_COMPONENT_PAGE_TYPES,
  },
];

export function componentDefinition(type: LayoutType) {
  return BUILDER_COMPONENTS.find((component) => component.type === type);
}

/** The type-specific component palette: everything unscoped, plus whatever is scoped to this page type. */
export function componentsForPageType(pageType: PageType): BuilderComponent[] {
  return BUILDER_COMPONENTS.filter((component) => !component.pageTypes || component.pageTypes.includes(pageType));
}

// ----------------------------------------------------------------------

type ConfigEditorProps = {
  item: PageItem;
  onChange: (config: PageItemConfig) => void;
};

export function PageBuilderComponentConfig({ item, onChange }: ConfigEditorProps) {
  const config = item.component_config || {};
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });

  const jsonList = (key: 'steps' | 'timeline', fallback: unknown[]) => (
    <TextField
      fullWidth multiline minRows={5}
      label={key === 'steps' ? 'Wizard steps (JSON)' : 'Timeline events (JSON)'}
      key={`${item.id}-${key}-${JSON.stringify(config[key] || fallback).length}`}
      defaultValue={JSON.stringify(config[key] || fallback, null, 2)}
      onBlur={(event) => {
        try { set(key, JSON.parse(event.target.value)); } catch { /* Keep the previous valid value. */ }
      }}
      helperText="Use an array of objects with title, body, and optional date."
      sx={{ '& textarea': { fontFamily: 'monospace', fontSize: 13 } }}
    />
  );

  const jsonField = (key: string, label: string, fallback: unknown[], helperText: string) => (
    <TextField
      fullWidth multiline minRows={4}
      label={label}
      key={`${item.id}-${key}-${JSON.stringify(config[key] || fallback).length}`}
      defaultValue={JSON.stringify(config[key] || fallback, null, 2)}
      onBlur={(event) => {
        try { set(key, JSON.parse(event.target.value)); } catch { /* Keep the previous valid value. */ }
      }}
      helperText={helperText}
      sx={{ '& textarea': { fontFamily: 'monospace', fontSize: 13 } }}
    />
  );

  switch (item.layout_type) {
    case 'animate':
      return (
        <SelectField label="Animation preset" value={String(config.variant || 'fadeInUp')} onChange={(value) => set('variant', value)} options={['fadeIn', 'fadeInUp', 'fadeInLeft', 'zoomIn', 'scaleIn', 'rotateIn', 'bounceIn']} />
      );
    case 'utilities':
      return (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 4 }}><SelectField label="Utility" value={String(config.variant || 'aspect_ratio')} onChange={(value) => set('variant', value)} options={['aspect_ratio', 'responsive_visibility', 'spacing', 'gradient', 'glass']} /></Grid>
          <Grid size={{ xs: 12, md: 4 }}><TextField fullWidth label="Aspect ratio" value={String(config.ratio || '16/9')} onChange={(e) => set('ratio', e.target.value)} /></Grid>
          <Grid size={{ xs: 12, md: 4 }}><NumberField label="Minimum height" value={Number(config.minHeight || 240)} onChange={(value) => set('minHeight', value)} /></Grid>
        </Grid>
      );
    case 'scrollbar':
      return <NumberField label="Maximum height (px)" value={Number(config.maxHeight || 320)} onChange={(value) => set('maxHeight', value)} />;
    case 'scroll_progress':
      return (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6 }}><SelectField label="Indicator" value={String(config.variant || 'linear')} onChange={(value) => set('variant', value)} options={['linear', 'circular']} /></Grid>
          <Grid size={{ xs: 12, md: 6 }}><SelectField label="Position" value={String(config.position || 'top')} onChange={(value) => set('position', value)} options={['top', 'bottom', 'inside']} /></Grid>
        </Grid>
      );
    case 'image_grid':
    case 'lightbox':
      return <NumberField label="Columns" value={Number(config.columns || 3)} onChange={(value) => set('columns', Math.min(6, Math.max(1, value)))} />;
    case 'form_wizard':
      return jsonList('steps', [{ title: 'Step 1', body: 'First step' }]);
    case 'carousel':
      return (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 4 }}><NumberField label="Slides visible" value={Number(config.slidesToShow || 1)} onChange={(value) => set('slidesToShow', Math.min(4, Math.max(1, value)))} /></Grid>
          <Grid size={{ xs: 12, md: 4 }}><FormControlLabel control={<Switch checked={config.autoplay !== false} onChange={(e) => set('autoplay', e.target.checked)} />} label="Autoplay" /></Grid>
          <Grid size={{ xs: 12, md: 4 }}><FormControlLabel control={<Switch checked={config.loop !== false} onChange={(e) => set('loop', e.target.checked)} />} label="Loop" /></Grid>
        </Grid>
      );
    case 'timeline':
      return jsonList('timeline', [{ title: 'Milestone', body: 'Describe this event', date: 'Today' }]);
    case 'tooltip':
      return (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 8 }}><TextField fullWidth label="Tooltip text" value={String(config.tooltip || '')} onChange={(e) => set('tooltip', e.target.value)} /></Grid>
          <Grid size={{ xs: 12, md: 4 }}><SelectField label="Placement" value={String(config.placement || 'top')} onChange={(value) => set('placement', value)} options={['top', 'right', 'bottom', 'left']} /></Grid>
        </Grid>
      );
    case 'rating':
      return (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 4 }}><NumberField label="Value" value={Number(config.rating || 0)} step={0.5} onChange={(value) => set('rating', value)} /></Grid>
          <Grid size={{ xs: 12, md: 4 }}><SelectField label="Precision" value={String(config.precision || 1)} onChange={(value) => set('precision', Number(value))} options={['1', '0.5']} /></Grid>
          <Grid size={{ xs: 12, md: 4 }}><FormControlLabel control={<Switch checked={config.readOnly !== false} onChange={(e) => set('readOnly', e.target.checked)} />} label="Read only" /></Grid>
        </Grid>
      );
    case 'file_upload':
      return (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12 }}>
            <TextField
              fullWidth
              label="Upload endpoint"
              value={String(config.uploadEndpoint || '')}
              onChange={(e) => set('uploadEndpoint', e.target.value)}
              helperText="Backend API path the uploaded files are POSTed to (multipart/form-data, field name 'files')."
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <NumberField label="Church ID" value={Number(config.uploadChurchId || 0)} onChange={(value) => set('uploadChurchId', value)} />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField fullWidth label="Record type" value={String(config.uploadRecordType || 'custom')} onChange={(e) => set('uploadRecordType', e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField fullWidth label="Language" value={String(config.uploadLanguage || 'en')} onChange={(e) => set('uploadLanguage', e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField fullWidth label="Button label" value={String(config.uploadButtonLabel || 'Upload')} onChange={(e) => set('uploadButtonLabel', e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField fullWidth label="Helper text" value={String(config.uploadHelperText || '')} onChange={(e) => set('uploadHelperText', e.target.value)} />
          </Grid>
        </Grid>
      );
    case 'data_table':
      return (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 8 }}>
            <TextField
              fullWidth
              label="Data endpoint (GET)"
              value={String(config.tableEndpoint || '')}
              onChange={(e) => set('tableEndpoint', e.target.value)}
              helperText="API path returning JSON. Must be reachable without authentication on a public page."
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              fullWidth
              label="Rows path (optional)"
              value={String(config.tableRowsPath || '')}
              onChange={(e) => set('tableRowsPath', e.target.value)}
              helperText="Dot path to the array in the response, e.g. 'jobs'. Leave blank if the response is itself an array."
            />
          </Grid>
          <Grid size={{ xs: 12 }}>
            {jsonField('tableColumns', 'Columns (JSON)', [{ key: 'id', label: 'ID' }], "Array of { key, label } — key is read from each row, label is the column header.")}
          </Grid>
        </Grid>
      );
    default:
      return (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          This component uses its content and attached Asset Manager media; no additional configuration is required.
        </Typography>
      );
  }
}

// ----------------------------------------------------------------------

type EffectsEditorProps = {
  effects: PageEffectsConfig;
  onChange: (effects: PageEffectsConfig) => void;
};

export function PageBuilderEffectsEditor({ effects, onChange }: EffectsEditorProps) {
  const set = (key: keyof PageEffectsConfig, value: unknown) => onChange({ ...effects, [key]: value });
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 4 }}>
        <SelectField label="Animation" value={effects.animation || 'none'} onChange={(value) => set('animation', value)} options={['none', 'fade', 'slide_up', 'slide_left', 'zoom', 'scale', 'rotate']} />
      </Grid>
      <Grid size={{ xs: 12, md: 4 }}>
        <SelectField label="Trigger" value={effects.trigger || 'in_view'} onChange={(value) => set('trigger', value)} options={['on_load', 'in_view', 'hover']} />
      </Grid>
      <Grid size={{ xs: 6, md: 2 }}><NumberField label="Duration (s)" value={effects.duration ?? 0.5} step={0.1} onChange={(value) => set('duration', value)} /></Grid>
      <Grid size={{ xs: 6, md: 2 }}><NumberField label="Delay (s)" value={effects.delay ?? 0} step={0.1} onChange={(value) => set('delay', value)} /></Grid>
      <Grid size={{ xs: 6, md: 3 }}><NumberField label="Opacity" value={effects.opacity ?? 1} step={0.1} onChange={(value) => set('opacity', Math.min(1, Math.max(0, value)))} /></Grid>
      <Grid size={{ xs: 6, md: 3 }}><NumberField label="Scale" value={effects.scale ?? 1} step={0.05} onChange={(value) => set('scale', value)} /></Grid>
      <Grid size={{ xs: 6, md: 3 }}><NumberField label="Rotation" value={effects.rotate ?? 0} onChange={(value) => set('rotate', value)} /></Grid>
      <Grid size={{ xs: 6, md: 3 }}><NumberField label="Blur" value={effects.blur ?? 0} onChange={(value) => set('blur', value)} /></Grid>
      <Grid size={{ xs: 6, md: 3 }}><NumberField label="Hover lift" value={effects.hover_lift ?? 6} onChange={(value) => set('hover_lift', value)} /></Grid>
      <Grid size={{ xs: 12 }}>
        <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
          <FormControlLabel control={<Switch checked={!!effects.parallax} onChange={(e) => set('parallax', e.target.checked)} />} label="Parallax" />
          <FormControlLabel control={<Switch checked={!!effects.sticky} onChange={(e) => set('sticky', e.target.checked)} />} label="Sticky" />
          <FormControlLabel control={<Switch checked={!!effects.show_scroll_progress} onChange={(e) => set('show_scroll_progress', e.target.checked)} />} label="Scroll progress" />
        </Stack>
      </Grid>
    </Grid>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <FormControl fullWidth>
      <InputLabel>{label}</InputLabel>
      <Select label={label} value={value} onChange={(event) => onChange(String(event.target.value))}>
        {options.map((option) => <MenuItem key={option} value={option}>{option.replaceAll('_', ' ')}</MenuItem>)}
      </Select>
    </FormControl>
  );
}

function NumberField({ label, value, step = 1, onChange }: { label: string; value: number; step?: number; onChange: (value: number) => void }) {
  return <TextField fullWidth type="number" label={label} value={value} onChange={(event) => onChange(Number(event.target.value))} slotProps={{ htmlInput: { step } }} />;
}
