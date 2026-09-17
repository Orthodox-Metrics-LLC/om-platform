import type { Styles, Locale, Options, ButtonType, PartialDeep } from 'react-joyride';
import type { UseWalktourProps, UseWalktourReturn } from './types';

import { useMemo } from 'react';
import { useJoyride } from 'react-joyride';
import { varAlpha } from 'minimal-shared/utils';

import { useTheme } from '@mui/material/styles';

import { WalktourTooltip } from './walktour-tooltip';

// ----------------------------------------------------------------------

export const WALKTOUR_DEFAULT_BUTTONS: ButtonType[] = ['skip', 'back', 'primary'];

export function useWalktour(props: UseWalktourProps): UseWalktourReturn {
  const theme = useTheme();

  const locale: Locale = useMemo(
    () => ({
      back: 'Back',
      close: 'Close',
      last: 'Done',
      next: 'Next',
      skip: 'Skip',
      nextWithProgress: 'Next ({current}/{total})',
      ...props.locale,
    }),
    [props.locale]
  );

  const options: Partial<Options> = useMemo(
    () => ({
      scrollOffset: 100,
      showProgress: true,
      scrollDuration: 500,
      overlayClickAction: false,
      zIndex: theme.zIndex.modal,
      buttons: WALKTOUR_DEFAULT_BUTTONS,
      // arrow
      arrowBase: 20,
      arrowSize: 10,
      arrowColor: theme.vars.palette.background.paper,
      // spotlight
      spotlightPadding: 12,
      spotlightRadius: Number(theme.shape.borderRadius) * 2,
      ...props.options,
    }),
    [theme, props.options]
  );

  const styles: PartialDeep<Styles> = useMemo(
    () => ({
      overlay: {
        backgroundColor: varAlpha(theme.vars.palette.grey['900Channel'], 0.8),
      },
      beacon: { outline: 0 },
      beaconInner: { backgroundColor: theme.vars.palette.error.main },
      beaconOuter: {
        borderColor: theme.vars.palette.error.main,
        backgroundColor: varAlpha(theme.vars.palette.error.mainChannel, 0.24),
      },
      ...props.styles,
    }),
    [theme, props.styles]
  );

  const walktour = useJoyride({
    run: true,
    continuous: true,
    scrollToFirstStep: true,
    tooltipComponent: WalktourTooltip,
    ...props,
    locale,
    options,
    styles,
  });

  return walktour;
}
