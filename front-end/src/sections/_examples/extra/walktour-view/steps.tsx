import type { Theme } from '@mui/material/styles';
import type { WalktourCustomStep } from 'src/components/walktour';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { _mock } from 'src/_mock';

import { Iconify } from 'src/components/iconify';
import { WALKTOUR_DEFAULT_BUTTONS } from 'src/components/walktour';

// ----------------------------------------------------------------------

export const TOUR_IDS = {
  welcome: 'tour-welcome-banner',
  newProducts: 'tour-new-products',
  totalBalance: 'tour-total-balance',
  yearlySales: 'tour-yearly-sales',
  latestProducts: 'tour-latest-products',
};

const dataStep = (id: string) => `[data-step="${id}"]`;

export const getTourSteps = (theme: Theme): WalktourCustomStep[] => [
  {
    skipBeacon: true,
    target: dataStep(TOUR_IDS.welcome),
    title: `Let's begin our journey!`,
    placement: 'left-start',
    buttons: [...WALKTOUR_DEFAULT_BUTTONS, 'close'],
    content: (
      <Typography sx={{ color: 'text.secondary' }}>
        Aenean posuere, tortor sed cursus feugiat, nunc augue blandit nunc, eu sollicitudin urna
        dolor sagittis lacus.
      </Typography>
    ),
  },
  {
    target: dataStep(TOUR_IDS.newProducts),
    title: 'Step 2',
    placement: 'left-start',
    content: (
      <>
        <Typography sx={{ mb: 2, color: 'text.secondary' }}>
          Aenean posuere, tortor sed cursus feugiat, nunc augue blandit nunc, eu sollicitudin urna
          dolor sagittis lacus.
        </Typography>
        <Box
          component="img"
          alt="Cover"
          src={_mock.image.cover(3)}
          sx={{
            width: 400,
            borderRadius: 2,
            aspectRatio: '5/3',
            objectFit: 'cover',
          }}
        />
      </>
    ),
  },
  {
    target: dataStep(TOUR_IDS.totalBalance),
    title: 'Step 3',
    placement: 'bottom',
    content: (
      <>
        <Typography sx={{ mb: 2, color: 'text.secondary' }}>Weekly magic on your inbox</Typography>
        <TextField
          variant="filled"
          fullWidth
          label="Email"
          placeholder="example@gmail.com"
          slotProps={{
            inputLabel: { shrink: true },
            input: {
              endAdornment: (
                <Button color="inherit" variant="soft" sx={{ mr: -0.5 }}>
                  Send
                </Button>
              ),
            },
          }}
        />
      </>
    ),
  },
  {
    target: dataStep(TOUR_IDS.yearlySales),
    title: 'Step 4',
    placement: 'left',
    content: (
      <Stack spacing={3}>
        <Typography sx={{ color: 'text.secondary' }}>
          Aenean posuere, tortor sed cursus feugiat, nunc augue blandit nunc, eu sollicitudin urna
          dolor sagittis lacus.
        </Typography>
        <Paper component="ul" variant="outlined">
          {(
            [
              { label: 'Wi-Fi', icon: 'solar:atom-bold-duotone', defaultChecked: true },
              {
                label: 'Bluetooth',
                icon: 'solar:atom-bold-duotone',
                defaultChecked: true,
              },
              { label: 'Airbuds', icon: 'solar:atom-bold-duotone', defaultChecked: false },
              { label: 'Alarm', icon: 'solar:atom-bold-duotone', defaultChecked: false },
            ] as const
          ).map((option) => (
            <Box
              component="li"
              key={option.label}
              sx={{
                py: 1,
                px: 2,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Iconify width={26} icon={option.icon} sx={{ color: 'text.secondary', mr: 2 }} />
              <Box component="span" sx={{ typography: 'subtitle2', flexGrow: 1 }}>
                {option.label}
              </Box>

              <Switch
                edge="end"
                color="default"
                defaultChecked={option.defaultChecked}
                slotProps={{
                  input: {
                    id: `${option.label}-switch`,
                    'aria-label': `${option.label} switch`,
                  },
                }}
              />
            </Box>
          ))}
        </Paper>
      </Stack>
    ),
  },
  {
    target: dataStep(TOUR_IDS.latestProducts),
    title: 'Step 5',
    placement: 'left',
    arrowColor: theme.vars.palette.grey[800],
    slotProps: {
      root: {
        sx: {
          width: 480,
          bgcolor: theme.vars.palette.grey[800],
          color: theme.vars.palette.common.white,
        },
      },
    },
    content: (
      <Stack spacing={3}>
        <Typography sx={{ color: 'text.disabled' }}>
          Aenean posuere, tortor sed cursus feugiat, nunc augue blandit nunc, eu sollicitudin urna
          dolor sagittis lacus.
        </Typography>
        <Box
          sx={{
            gap: 1,
            width: 1,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
          }}
        >
          {Array.from({ length: 6 }, (_, index) => (
            <Box
              key={index}
              component="img"
              alt="Cover"
              src={_mock.image.cover(index)}
              sx={{ borderRadius: 1 }}
            />
          ))}
        </Box>
      </Stack>
    ),
  },
];
