/**
 * Settings field group card — Minimal-aligned.
 */
import { Box, Select, Slider, Switch, MenuItem, Typography } from '@mui/material';

import { SettingsCardSection } from './settings-card-section';

export type SettingFieldItem<K extends string> =
  | { type: 'toggle'; label: string; description?: string; key: K }
  | { type: 'select'; label: string; key: K; options: { value: string; label: string }[] }
  | {
      type: 'slider';
      label: string;
      key: K;
      min: number;
      max: number;
      step: number;
      formatValue: (value: number) => string;
    };

export interface SettingsFieldGroupDef<K extends string> {
  title: string;
  icon: React.ElementType;
  items: SettingFieldItem<K>[];
}

export interface SettingsFieldGroupCardProps<T extends Record<string, any>> {
  group: SettingsFieldGroupDef<Extract<keyof T, string>>;
  settings: T;
  setField: <K extends keyof T>(key: K, value: T[K]) => void;
}

export function SettingsFieldGroupCard<T extends Record<string, any>>({
  group,
  settings,
  setField,
}: SettingsFieldGroupCardProps<T>) {
  return (
    <SettingsCardSection title={group.title} icon={group.icon}>
      {group.items.map((item, i) => (
        <Box
          key={item.key}
          sx={{
            py: 1.5,
            borderBottom: i < group.items.length - 1 ? '1px solid' : 'none',
            borderColor: 'divider',
          }}
        >
          {item.type === 'toggle' ? (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {item.label}
                </Typography>
                {item.description && (
                  <Typography variant="caption" color="text.secondary">
                    {item.description}
                  </Typography>
                )}
              </Box>
              <Switch
                size="small"
                checked={Boolean(settings[item.key])}
                onChange={(e) => setField(item.key, e.target.checked as T[typeof item.key])}
              />
            </Box>
          ) : item.type === 'select' ? (
            <Box>
              <Typography variant="body2" sx={{ mb: 1, fontWeight: 600 }}>
                {item.label}
              </Typography>
              <Select
                size="small"
                fullWidth
                value={String(settings[item.key] ?? '')}
                onChange={(e) => setField(item.key, e.target.value as T[typeof item.key])}
              >
                {item.options.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </Box>
          ) : (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {item.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {item.formatValue(Number(settings[item.key]))}
                </Typography>
              </Box>
              <Slider
                size="small"
                value={Number(settings[item.key])}
                onChange={(_, val) => setField(item.key, val as T[typeof item.key])}
                min={item.min}
                max={item.max}
                step={item.step}
                color="primary"
              />
            </Box>
          )}
        </Box>
      ))}
    </SettingsCardSection>
  );
}
