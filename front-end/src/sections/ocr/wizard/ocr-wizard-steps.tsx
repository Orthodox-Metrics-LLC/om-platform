import type { StepperProps } from '@mui/material/Stepper';

import Box from '@mui/material/Box';
import Step from '@mui/material/Step';
import Stepper from '@mui/material/Stepper';
import { styled } from '@mui/material/styles';
import StepLabel, { stepLabelClasses } from '@mui/material/StepLabel';
import MuiStepConnector, { stepConnectorClasses } from '@mui/material/StepConnector';

import { Iconify } from 'src/components/iconify';

// ----------------------------------------------------------------------
// Mirrors src/sections/checkout/checkout-steps.tsx — same stepper used by
// the real /product/checkout page, reused here instead of a bespoke one.

export const OCR_WIZARD_STEPS = ['Configure', 'Upload', 'Review Pages', 'Processing', 'Results'];

type Props = StepperProps & {
  activeStep: number;
};

export function OcrWizardSteps({ activeStep, sx, ...other }: Props) {
  return (
    <Stepper
      alternativeLabel
      activeStep={activeStep}
      connector={<StepConnector />}
      sx={[{ mb: { xs: 3, md: 5 } }, ...(Array.isArray(sx) ? sx : [sx])]}
      {...other}
    >
      {OCR_WIZARD_STEPS.map((label) => (
        <Step key={label}>
          <StepLabel
            slots={{ stepIcon: StepIcon }}
            sx={{ [`& .${stepLabelClasses.label}`]: { fontWeight: 'fontWeightSemiBold' } }}
          >
            {label}
          </StepLabel>
        </Step>
      ))}
    </Stepper>
  );
}

// ----------------------------------------------------------------------

const StepConnector = styled(MuiStepConnector)(({ theme }) => ({
  top: 10,
  left: 'calc(-50% + 20px)',
  right: 'calc(50% + 20px)',
  [`& .${stepConnectorClasses.line}`]: {
    borderTopWidth: 2,
    borderColor: theme.vars.palette.divider,
  },
  [`&.${stepConnectorClasses.active}, &.${stepConnectorClasses.completed}`]: {
    [`& .${stepConnectorClasses.line}`]: { borderColor: theme.vars.palette.primary.main },
  },
}));

type StepIconProps = {
  active?: boolean;
  completed?: boolean;
};

function StepIcon({ active, completed }: StepIconProps) {
  return (
    <Box
      sx={{
        width: 24,
        height: 24,
        display: 'flex',
        alignItems: 'center',
        color: 'text.disabled',
        justifyContent: 'center',
        ...(active && { color: 'primary.main' }),
      }}
    >
      {completed ? (
        <Iconify icon="eva:checkmark-fill" sx={{ color: 'primary.main' }} />
      ) : (
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'currentColor' }} />
      )}
    </Box>
  );
}
