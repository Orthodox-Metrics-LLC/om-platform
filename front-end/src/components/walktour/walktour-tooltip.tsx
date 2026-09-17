import type { WalktourTooltipProps } from './types';

import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import LinearProgress, { linearProgressClasses } from '@mui/material/LinearProgress';

import { Iconify } from 'src/components/iconify';

// ----------------------------------------------------------------------

export function WalktourTooltip({
  size,
  step,
  index,
  backProps,
  skipProps,
  continuous,
  closeProps,
  isLastStep,
  primaryProps,
  tooltipProps,
}: WalktourTooltipProps) {
  const { title, content, slotProps, showProgress, buttons } = step;

  const progressValue = ((index + 1) / size) * 100;

  const showFooter =
    buttons.includes('skip') || buttons.includes('back') || buttons.includes('primary');
  const showCloseBtn = buttons.includes('close') && !isLastStep;
  const showBackBtn = buttons.includes('back') && index > 0;
  const showNextBtn = buttons.includes('primary') && continuous;
  const showSkipBtn = buttons.includes('skip') && index > 0 && !isLastStep;

  const renderTitle = () =>
    title && (
      <Typography variant="h6" {...slotProps?.title}>
        {title}
      </Typography>
    );

  const renderContent = () => (
    <Box
      {...slotProps?.content}
      sx={[
        { px: 3, pt: 2, pb: 4 },
        ...(Array.isArray(slotProps?.content?.sx)
          ? (slotProps?.content?.sx ?? [])
          : [slotProps?.content?.sx]),
      ]}
    >
      {content}
    </Box>
  );

  const renderProgress = () => (
    <LinearProgress
      variant="determinate"
      value={progressValue}
      {...slotProps?.progress}
      sx={[
        (theme) => ({
          height: 2,
          borderRadius: 0,
          '&::before': { opacity: 0.08 },
          [`& .${linearProgressClasses.bar}`]: {
            background: `linear-gradient(135deg, ${theme.vars.palette.primary.light} 0%, ${theme.vars.palette.primary.main} 100%)`,
          },
        }),
        ...(Array.isArray(slotProps?.progress?.sx)
          ? (slotProps?.progress?.sx ?? [])
          : [slotProps?.progress?.sx]),
      ]}
    />
  );

  const renderCloseBtn = () =>
    showCloseBtn && (
      <IconButton
        {...closeProps}
        {...slotProps?.closeBtn}
        sx={[
          (theme) => ({
            p: 0.5,
            top: 10,
            right: 10,
            position: 'absolute',
            border: `solid 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.12)}`,
          }),
          ...(Array.isArray(slotProps?.closeBtn?.sx)
            ? (slotProps?.closeBtn?.sx ?? [])
            : [slotProps?.closeBtn?.sx]),
        ]}
      >
        <Iconify icon="mingcute:close-line" width={16} />
      </IconButton>
    );

  const renderSkipBtn = () =>
    showSkipBtn && (
      <Button {...skipProps} disableRipple {...slotProps?.skipBtn}>
        {skipProps.title}
      </Button>
    );

  const renderBackBtn = () =>
    showBackBtn && (
      <Button {...backProps} disableRipple variant="outlined" {...slotProps?.backBtn}>
        {backProps.title}
      </Button>
    );

  const renderNextBtn = () =>
    showNextBtn && (
      <Button
        {...primaryProps}
        disableRipple
        role="button"
        variant="contained"
        color={isLastStep ? 'primary' : 'inherit'}
        {...slotProps?.nextBtn}
      >
        {primaryProps.title}
      </Button>
    );

  const renderFooter = () => (
    <Box
      sx={[
        (theme) => ({
          gap: 1.5,
          display: 'flex',
          justifyContent: 'flex-end',
          p: theme.spacing(2.5, 2.5, 2.5, 1),
          borderTop: `solid 1px ${theme.vars.palette.divider}`,
        }),
      ]}
    >
      {renderSkipBtn()}
      <Box sx={{ flexGrow: 1 }} />
      {renderBackBtn()}
      {renderNextBtn()}
    </Box>
  );

  return (
    <Box
      {...tooltipProps}
      {...slotProps?.root}
      sx={[
        (theme) => ({
          width: 360,
          borderRadius: 2,
          bgcolor: 'background.paper',
          boxShadow: theme.vars.customShadows.dialog,
        }),
        ...(Array.isArray(slotProps?.root?.sx) ? slotProps.root.sx : [slotProps?.root?.sx]),
      ]}
    >
      <Box sx={{ px: 3, pt: 3, position: 'relative' }}>
        {renderTitle()}
        {renderCloseBtn()}
      </Box>

      {content && renderContent()}

      {showFooter && (
        <>
          {showProgress && renderProgress()}
          {renderFooter()}
        </>
      )}
    </Box>
  );
}
