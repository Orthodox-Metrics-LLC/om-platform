import type { BoxProps } from '@mui/material/Box';

import { varAlpha } from 'minimal-shared/utils';
import { Controller, useFormContext } from 'react-hook-form';

import Box from '@mui/material/Box';
import Avatar from '@mui/material/Avatar';
import Tooltip from '@mui/material/Tooltip';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';

import { Iconify } from 'src/components/iconify';

import { HelperText } from './help-text';

// ----------------------------------------------------------------------

export type AvatarPickerOption = { id: string; label: string; src: string };

export type RHFAvatarPickerProps = BoxProps & {
  name: string;
  options: AvatarPickerOption[];
  helperText?: React.ReactNode;
  /** Shown as the large preview when the current value is not one of `options`. */
  fallbackName?: string;
};

/**
 * Pick one avatar from a fixed set of presets. Stores the selected `src` string
 * in the form value (so it maps 1:1 onto `users.avatar_url`).
 */
export function RHFAvatarPicker({
  name,
  options,
  helperText,
  fallbackName,
  sx,
  ...other
}: RHFAvatarPickerProps) {
  const { control } = useFormContext();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => {
        const current = options.find((o) => o.src === field.value);

        return (
          <Box
            sx={[
              { display: 'flex', alignItems: 'center', flexDirection: 'column' },
              ...(Array.isArray(sx) ? sx : [sx]),
            ]}
            {...other}
          >
            <Avatar
              src={current?.src ?? field.value ?? undefined}
              alt={current?.label ?? fallbackName}
              sx={(theme) => ({
                width: 128,
                height: 128,
                mb: 3,
                border: `solid 6px ${theme.vars.palette.background.paper}`,
                boxShadow: theme.vars.customShadows.z8,
              })}
            >
              {fallbackName?.charAt(0).toUpperCase()}
            </Avatar>

            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
              Choose your avatar
            </Typography>

            <Box sx={{ gap: 1.5, display: 'flex', justifyContent: 'center' }}>
              {options.map((option) => {
                const selected = option.src === field.value;
                return (
                  <Tooltip key={option.id} title={option.label}>
                    <ButtonBase
                      onClick={() => field.onChange(option.src)}
                      aria-pressed={selected}
                      aria-label={`Use ${option.label} avatar`}
                      sx={(theme) => ({
                        p: '3px',
                        borderRadius: '50%',
                        position: 'relative',
                        border: `solid 2px ${
                          selected
                            ? theme.vars.palette.primary.main
                            : varAlpha(theme.vars.palette.grey['500Channel'], 0.24)
                        }`,
                        transition: theme.transitions.create(['border-color', 'transform']),
                        '&:hover': { transform: 'scale(1.05)' },
                      })}
                    >
                      <Avatar src={option.src} alt={option.label} sx={{ width: 56, height: 56 }} />
                      {selected && (
                        <Box
                          sx={(theme) => ({
                            right: -2,
                            bottom: -2,
                            width: 20,
                            height: 20,
                            display: 'flex',
                            borderRadius: '50%',
                            position: 'absolute',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: theme.vars.palette.common.white,
                            bgcolor: theme.vars.palette.primary.main,
                          })}
                        >
                          <Iconify icon="eva:checkmark-fill" width={14} />
                        </Box>
                      )}
                    </ButtonBase>
                  </Tooltip>
                );
              })}
            </Box>

            <HelperText errorMessage={error?.message} helperText={helperText} sx={{ mt: 2 }} />
          </Box>
        );
      }}
    />
  );
}
