import type { BoxProps } from '@mui/material/Box';

import { z } from 'zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';

import { Form } from 'src/components/hook-form/form-provider';
import { RHFSelect } from 'src/components/hook-form/rhf-select';
import { RHFTextField } from 'src/components/hook-form/rhf-text-field';

// ----------------------------------------------------------------------

/**
 * Enquiry types accepted by `POST /api/contact`. The labels match the ones the
 * backend uses when it notifies super_admins, so the notification and the form
 * say the same thing.
 */
const ENQUIRY_TYPES = [
  { value: 'general', label: 'General Enquiry' },
  { value: 'parish_registration', label: 'Parish Registration' },
  { value: 'records', label: 'Records & Certificates' },
  { value: 'technical', label: 'Technical Support' },
  { value: 'billing', label: 'Billing & Pricing' },
  { value: 'other', label: 'Other' },
] as const;

/** Mirrors the endpoint's own required set: it 400s without any of these. */
const ContactSchema = z.object({
  firstName: z.string().min(1, { message: 'First name is required.' }),
  lastName: z.string().min(1, { message: 'Last name is required.' }),
  email: z
    .string()
    .min(1, { message: 'Email is required.' })
    .email({ message: 'Enter a valid email address.' }),
  phone: z.string().min(1, { message: 'Phone is required.' }),
  enquiryType: z.string().min(1, { message: 'Choose what your enquiry is about.' }),
  church: z.string(),
  message: z.string().min(1, { message: 'Please tell us how we can help.' }),
});

export function ContactForm({ sx, ...other }: BoxProps) {
  const [sent, setSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const methods = useForm({
    resolver: zodResolver(ContactSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      enquiryType: 'general',
      church: '',
      message: '',
    },
  });

  const {
    handleSubmit,
    formState: { isSubmitting },
  } = methods;

  const onSubmit = handleSubmit(async (data) => {
    setErrorMessage(null);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: data.phone,
          enquiryType: data.enquiryType,
          /**
           * The endpoint has no church field, so it is prefixed onto the message
           * rather than dropped — otherwise the visitor types it and it is lost.
           */
          message: data.church ? `Church / Organization: ${data.church}\n\n${data.message}` : data.message,
        }),
      });

      const body = await res.json().catch(() => null);

      if (!res.ok || !body?.success) {
        throw new Error(body?.message || `Could not send your message (${res.status}).`);
      }

      setSent(true);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Could not send your message. Please try again.'
      );
    }
  });

  if (sent) {
    return (
      <Box sx={sx} {...other}>
        <Alert severity="success" sx={{ mb: 3 }}>
          Your message has been sent successfully.
        </Alert>

        <Typography variant="h4" sx={{ mb: 1 }}>
          Thank you — we have it.
        </Typography>

        <Typography sx={{ color: 'text.secondary' }}>
          A member of the Orthodox Metrics team will be in touch. If it is urgent you can also
          reach us directly at{' '}
          <Box component="a" href="mailto:info@orthodoxmetrics.com" sx={{ color: 'primary.main' }}>
            info@orthodoxmetrics.com
          </Box>
          .
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={sx} {...other}>
      <Typography variant="h3">
        Feel free to contact{' '}
        <Box component="span" sx={{ color: 'primary.main' }}>
          Orthodox Metrics
        </Box>
        .
      </Typography>

      <Typography variant="h6" sx={{ mt: 1 }}>
        We&apos;re glad to help your parish, clergy, or organization get started.
      </Typography>

      {errorMessage && (
        <Alert severity="error" sx={{ mt: 3 }}>
          {errorMessage}
        </Alert>
      )}

      <Form methods={methods} onSubmit={onSubmit}>
        <Stack spacing={3} sx={{ my: 5 }}>
          <Box sx={{ gap: 3, display: 'flex', flexDirection: { xs: 'column', sm: 'row' } }}>
            <RHFTextField fullWidth name="firstName" label="First name" />
            <RHFTextField fullWidth name="lastName" label="Last name" />
          </Box>

          <Box sx={{ gap: 3, display: 'flex', flexDirection: { xs: 'column', sm: 'row' } }}>
            <RHFTextField fullWidth name="email" label="Email" />
            <RHFTextField fullWidth name="phone" label="Phone" />
          </Box>

          <RHFTextField fullWidth name="church" label="Church / Organization (optional)" />

          <RHFSelect name="enquiryType" label="What is your enquiry about?">
            {ENQUIRY_TYPES.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </RHFSelect>

          <RHFTextField
            fullWidth
            name="message"
            label="Your message"
            multiline
            rows={4}
            placeholder="Tell us about your parish and how we can help."
          />
        </Stack>

        <Button
          size="large"
          type="submit"
          variant="contained"
          color="primary"
          loading={isSubmitting}
          loadingIndicator="Sending…"
        >
          Submit
        </Button>
      </Form>
    </Box>
  );
}
