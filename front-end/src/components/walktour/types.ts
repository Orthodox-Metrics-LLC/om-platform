import type { BoxProps } from '@mui/material/Box';
import type { ButtonProps } from '@mui/material/Button';
import type { TypographyProps } from '@mui/material/Typography';
import type { IconButtonProps } from '@mui/material/IconButton';
import type { LinearProgressProps } from '@mui/material/LinearProgress';
import type {
  Step,
  UseJoyrideReturn,
  TooltipRenderProps,
  Props as JoyrideProps,
} from 'react-joyride';

// ----------------------------------------------------------------------

export type WalktourCustomStep = Step & {
  slotProps?: {
    root?: BoxProps;
    title?: TypographyProps;
    content?: BoxProps;
    progress?: LinearProgressProps;
    closeBtn?: IconButtonProps;
    skipBtn?: ButtonProps;
    backBtn?: ButtonProps;
    nextBtn?: ButtonProps;
  };
};

export type WalktourTooltipProps = TooltipRenderProps & {
  step: WalktourCustomStep;
};

export type UseWalktourProps = Omit<JoyrideProps, 'steps'> & {
  steps: WalktourCustomStep[];
};

export type UseWalktourReturn = UseJoyrideReturn;
