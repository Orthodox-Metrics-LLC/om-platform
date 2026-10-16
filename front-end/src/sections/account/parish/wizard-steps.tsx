import React from 'react';

/**
 * Minimal-aligned horizontal stepper (checkout-steps pattern from minimal-typescript@7.7.0).
 * Uses MUI Stepper and theme tokens.
 */
import Box from '@mui/material/Box';
import Step from '@mui/material/Step';
import Stepper from '@mui/material/Stepper';
import { styled } from '@mui/material/styles';
import StepLabel, { stepLabelClasses } from '@mui/material/StepLabel';
import StepConnector, { stepConnectorClasses } from '@mui/material/StepConnector';

import { CheckIcon } from './parish-icons';

type WizardStepsProps = {
  steps: ReadonlyArray<{ key: string; label: string }>;
  activeStep: number;
  onStepClick?: (index: number) => void;
};

const Connector = styled(StepConnector)(({ theme }) => ({
  top: 10,
  left: 'calc(-50% + 20px)',
  right: 'calc(50% + 20px)',
  [`& .${stepConnectorClasses.line}`]: {
    borderTopWidth: 2,
    borderColor: theme.palette.divider,
  },
  [`&.${stepConnectorClasses.active}, &.${stepConnectorClasses.completed}`]: {
    [`& .${stepConnectorClasses.line}`]: {
      borderColor: theme.palette.primary.main,
    },
  },
}));

function StepIcon({ active, completed }: { active?: boolean; completed?: boolean }) {
  return (
    <Box
      sx={{
        width: 24,
        height: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'text.disabled',
        ...(active && { color: 'primary.main' }),
      }}
    >
      {completed ? (
        <CheckIcon sx={{ fontSize: 18, color: 'primary.main' }} />
      ) : (
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: 'currentColor',
          }}
        />
      )}
    </Box>
  );
}

export function WizardSteps({ steps, activeStep, onStepClick }: WizardStepsProps) {
  return (
    <Stepper
      alternativeLabel
      activeStep={activeStep}
      connector={<Connector />}
      sx={{ mb: { xs: 3, md: 5 } }}
    >
      {steps.map((step, index) => (
        <Step key={step.key} completed={index < activeStep}>
          <StepLabel
            slots={{ stepIcon: StepIcon }}
            onClick={() => onStepClick?.(index)}
            sx={{
              cursor: onStepClick ? 'pointer' : 'default',
              [`& .${stepLabelClasses.label}`]: {
                mt: 1,
                typography: 'caption',
                fontWeight: index === activeStep ? 600 : 500,
              },
            }}
          >
            {step.label}
          </StepLabel>
        </Step>
      ))}
    </Stepper>
  );
}

export default WizardSteps;
