import type { ParishFeature } from './enroll-parish-map';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { varAlpha } from 'minimal-shared/utils';
import { zodResolver } from '@hookform/resolvers/zod';

import Box from '@mui/material/Box';
import Step from '@mui/material/Step';
import Grid from '@mui/material/Grid';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Stepper from '@mui/material/Stepper';
import MenuItem from '@mui/material/MenuItem';
import StepLabel from '@mui/material/StepLabel';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { Iconify } from 'src/components/iconify';
/**
 * Imported from the individual modules, not the `hook-form` barrel: that barrel
 * re-exports the rich-text editor, upload and date-picker fields, which pulled
 * TipTap, dropzone and MUI X into this route and took the chunk to 1.28 MB.
 */
import { Form } from 'src/components/hook-form/form-provider';
import { RHFSelect } from 'src/components/hook-form/rhf-select';
import { RHFCheckbox } from 'src/components/hook-form/rhf-checkbox';
import { RHFTextField } from 'src/components/hook-form/rhf-text-field';
import { RHFRadioGroup } from 'src/components/hook-form/rhf-radio-group';

import { EnrollParishMap } from './enroll-parish-map';
import { ENROLL_COPY, CHURCH_SIZES, JURISDICTIONS } from './enroll-copy';
import { US_STATES, STEP_FIELDS, EnrollSchema, ENROLL_DEFAULTS } from './enroll-schema';

// ----------------------------------------------------------------------

const LAST_STEP = ENROLL_COPY.steps.length - 1;

export function EnrollView() {
  const [activeStep, setActiveStep] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [selectedParishId, setSelectedParishId] = useState<number | null>(null);

  const methods = useForm({
    resolver: zodResolver(EnrollSchema),
    defaultValues: ENROLL_DEFAULTS,
    mode: 'onSubmit',
  });

  const { watch, trigger, setValue, handleSubmit } = methods;
  const values = watch();

  const handleNext = async () => {
    const fields = STEP_FIELDS[activeStep];
    if (fields.length && !(await trigger(fields))) return;
    setActiveStep((step) => Math.min(step + 1, LAST_STEP));
  };

  const handleBack = () => setActiveStep((step) => Math.max(step - 1, 0));

  const onSubmit = handleSubmit(() => {
    // Presentation only — see the notice rendered on the final step.
    setSubmitted(true);
  });

  /**
   * Picking a parish on the map fills in what the directory already knows, so the
   * later steps are pre-populated rather than retyped.
   */
  const handleSelectParish = (parish: ParishFeature) => {
    setSelectedParishId(parish.id);
    setValue('parishName', parish.name, { shouldValidate: true });
    setValue('churchName', parish.name);
    setValue('notListed', false);
    if (parish.city) setValue('city', parish.city);
    if (parish.state) setValue('locationState', parish.state);
    if (parish.street) setValue('street', parish.street);
    if (parish.zip) setValue('postal', parish.zip);
  };

  const toggleModule = (key: string) => {
    const next = values.modules.includes(key)
      ? values.modules.filter((m) => m !== key)
      : [...values.modules, key];
    setValue('modules', next, { shouldValidate: true });
  };

  if (submitted) {
    return <EnrollConfirmation churchName={values.churchName || values.parishName} />;
  }

  const step = ENROLL_COPY.steps[activeStep];

  return (
    <Container sx={{ pt: { xs: 5, md: 8 }, pb: { xs: 8, md: 12 } }}>
      <Stack spacing={1} sx={{ mb: { xs: 4, md: 6 }, textAlign: 'center' }}>
        <Typography variant="overline" sx={{ color: 'text.disabled' }}>
          {ENROLL_COPY.wizard.title}
        </Typography>
        <Typography variant="h2">Enroll your parish</Typography>
        <Typography sx={{ color: 'text.secondary' }}>
          Step {activeStep + 1} of {ENROLL_COPY.steps.length} · {ENROLL_COPY.wizard.duration}
        </Typography>
      </Stack>

      <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: { xs: 5, md: 7 } }}>
        {ENROLL_COPY.steps.map((item) => (
          <Step key={item.key}>
            <StepLabel>{item.label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      <Box
        sx={[
          (theme) => ({
            p: { xs: 3, md: 5 },
            borderRadius: 2,
            bgcolor: 'background.paper',
            border: `solid 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.12)}`,
          }),
        ]}
      >
        <Stack spacing={1} sx={{ mb: 4 }}>
          <Typography variant="h4">{step.title}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {step.description}
          </Typography>
        </Stack>

        <Form methods={methods} onSubmit={onSubmit}>
          {activeStep === 0 && (
            <Stack spacing={3}>
              <Alert severity="info" icon={<Iconify icon="solar:info-circle-bold" />}>
                {ENROLL_COPY.findParish.crmTip} {ENROLL_COPY.findParish.crmTipAction}
              </Alert>

              {!values.notListed && (
                <EnrollParishMap
                  state={values.state}
                  selectedId={selectedParishId}
                  onSelect={handleSelectParish}
                />
              )}

              <Grid container spacing={3}>
                <Grid size={{ xs: 12, md: 5 }}>
                  <RHFSelect name="state" label={ENROLL_COPY.findParish.state}>
                    <MenuItem value="">{ENROLL_COPY.findParish.statePlaceholder}</MenuItem>
                    {US_STATES.map((s) => (
                      <MenuItem key={s.code} value={s.code}>
                        {s.name}
                      </MenuItem>
                    ))}
                  </RHFSelect>
                </Grid>

                <Grid size={{ xs: 12, md: 7 }}>
                  <RHFTextField
                    name="parishName"
                    label={
                      values.notListed
                        ? ENROLL_COPY.findParish.manualName
                        : ENROLL_COPY.findParish.parishName
                    }
                    placeholder={
                      values.notListed
                        ? ENROLL_COPY.findParish.manualPlaceholder
                        : ENROLL_COPY.findParish.parishNamePlaceholder
                    }
                    helperText={
                      values.notListed
                        ? ENROLL_COPY.findParish.manualHint
                        : ENROLL_COPY.findParish.parishNameHint
                    }
                  />
                </Grid>
              </Grid>

              <RHFCheckbox name="notListed" label={ENROLL_COPY.findParish.notListed} />
            </Stack>
          )}

          {activeStep === 1 && (
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <RHFTextField name="firstName" label={ENROLL_COPY.contact.firstName} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <RHFTextField name="lastName" label={ENROLL_COPY.contact.lastName} />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <RHFTextField
                  name="email"
                  label={ENROLL_COPY.contact.email}
                  helperText={ENROLL_COPY.contact.emailHint}
                />
              </Grid>
            </Grid>
          )}

          {activeStep === 2 && (
            <Grid container spacing={3}>
              <Grid size={{ xs: 12 }}>
                <RHFTextField name="churchName" label={ENROLL_COPY.parish.churchName} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <RHFSelect
                  name="jurisdiction"
                  label={ENROLL_COPY.parish.jurisdiction}
                  helperText={ENROLL_COPY.parish.jurisdictionHint}
                >
                  <MenuItem value="">{ENROLL_COPY.parish.jurisdictionPlaceholder}</MenuItem>
                  {JURISDICTIONS.map((j) => (
                    <MenuItem key={j.value} value={j.value}>
                      {j.label}
                    </MenuItem>
                  ))}
                </RHFSelect>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <RHFSelect name="size" label={ENROLL_COPY.parish.size}>
                  <MenuItem value="">{ENROLL_COPY.parish.sizePlaceholder}</MenuItem>
                  {CHURCH_SIZES.map((s) => (
                    <MenuItem key={s.value} value={s.value}>
                      {s.label}
                    </MenuItem>
                  ))}
                </RHFSelect>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <RHFTextField name="phone" label={ENROLL_COPY.parish.phone} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <RHFTextField name="website" label={ENROLL_COPY.parish.website} />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <RHFTextField name="referral" label={ENROLL_COPY.parish.referral} />
              </Grid>
            </Grid>
          )}

          {activeStep === 3 && (
            <Grid container spacing={3}>
              <Grid size={{ xs: 12 }}>
                <RHFTextField name="street" label={ENROLL_COPY.location.street} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <RHFTextField name="city" label={ENROLL_COPY.location.city} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <RHFTextField name="locationState" label={ENROLL_COPY.location.state} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <RHFTextField name="postal" label={ENROLL_COPY.location.postal} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <RHFTextField name="country" label={ENROLL_COPY.location.country} />
              </Grid>
            </Grid>
          )}

          {activeStep === 4 && (
            <Stack spacing={5}>
              <Stack spacing={2}>
                <Typography variant="subtitle1">{ENROLL_COPY.modules.selectPrompt}</Typography>
                <Grid container spacing={2}>
                  {ENROLL_COPY.modules.cards.map((card) => {
                    const selected = values.modules.includes(card.key);
                    return (
                      <Grid key={card.key} size={{ xs: 12, sm: 6 }}>
                        <Box
                          role="checkbox"
                          tabIndex={0}
                          aria-checked={selected}
                          onClick={() => toggleModule(card.key)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              toggleModule(card.key);
                            }
                          }}
                          sx={[
                            (theme) => ({
                              p: 2.5,
                              height: 1,
                              borderRadius: 2,
                              cursor: 'pointer',
                              transition: theme.transitions.create(['border-color', 'background-color']),
                              border: `solid 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.16)}`,
                              ...(selected && {
                                borderColor: 'primary.main',
                                bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.08),
                              }),
                            }),
                          ]}
                        >
                          <Box sx={{ mb: 1, gap: 1, display: 'flex', alignItems: 'center' }}>
                            <Iconify
                              width={20}
                              icon={selected ? 'eva:checkmark-circle-2-outline' : 'eva:radio-button-off-fill'}
                              sx={{ color: selected ? 'primary.main' : 'text.disabled' }}
                            />
                            <Typography variant="subtitle2">{card.title}</Typography>
                          </Box>
                          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                            {card.desc}
                          </Typography>
                        </Box>
                      </Grid>
                    );
                  })}
                </Grid>
              </Stack>

              <RHFRadioGroup
                name="importMethod"
                label={ENROLL_COPY.modules.importLegend}
                options={ENROLL_COPY.modules.importMethods.map((m) => ({
                  value: m.value,
                  label: `${m.label} — ${m.description}`,
                }))}
              />

              <RHFRadioGroup
                row
                name="startTimeline"
                label={ENROLL_COPY.modules.timelineLegend}
                options={ENROLL_COPY.modules.timelines.map((t) => ({
                  value: t.value,
                  label: t.label,
                }))}
              />

              <Alert severity="warning">
                This page is presentation only — it is not yet wired to the enrollment API, so
                nothing is submitted. Use{' '}
                <a href="https://orthodoxmetrics.com/enroll">the live enrollment wizard</a> to
                enroll a parish.
              </Alert>
            </Stack>
          )}

          <Box
            sx={{
              mt: 5,
              gap: 1.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Button
              size="large"
              color="inherit"
              variant="outlined"
              disabled={activeStep === 0}
              onClick={handleBack}
              startIcon={<Iconify icon="eva:arrow-ios-back-fill" />}
            >
              {ENROLL_COPY.wizard.back}
            </Button>

            {activeStep < LAST_STEP ? (
              <Button
                size="large"
                color="inherit"
                variant="contained"
                onClick={handleNext}
                endIcon={<Iconify icon="eva:arrow-ios-forward-fill" />}
              >
                {ENROLL_COPY.wizard.next}
              </Button>
            ) : (
              <Button size="large" type="submit" color="primary" variant="contained">
                {ENROLL_COPY.wizard.submit}
              </Button>
            )}
          </Box>
        </Form>
      </Box>
    </Container>
  );
}

// ----------------------------------------------------------------------

function EnrollConfirmation({ churchName }: { churchName: string }) {
  return (
    <Container sx={{ pt: { xs: 5, md: 8 }, pb: { xs: 8, md: 12 }, maxWidth: 720 }}>
      <Stack spacing={3} sx={{ textAlign: 'center', mb: 6 }}>
        <Iconify
          width={72}
          icon="solar:check-circle-bold"
          sx={{ mx: 'auto', color: 'primary.main' }}
        />
        <Typography variant="h3">{ENROLL_COPY.confirm.title}</Typography>
        {churchName && (
          <Typography sx={{ color: 'text.secondary' }}>
            Enrollment request for <strong>{churchName}</strong>.
          </Typography>
        )}
      </Stack>

      <Typography variant="h5" sx={{ mb: 3 }}>
        {ENROLL_COPY.confirm.whatNext}
      </Typography>

      <Stack spacing={3} sx={{ mb: 6 }}>
        {ENROLL_COPY.confirm.nextSteps.map((item, index) => (
          <Box key={item.title} sx={{ gap: 2, display: 'flex' }}>
            <Box
              sx={[
                (theme) => ({
                  width: 32,
                  height: 32,
                  flexShrink: 0,
                  display: 'flex',
                  borderRadius: '50%',
                  alignItems: 'center',
                  color: 'primary.main',
                  typography: 'subtitle2',
                  justifyContent: 'center',
                  bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.12),
                }),
              ]}
            >
              {index + 1}
            </Box>
            <Box>
              <Typography variant="subtitle1">{item.title}</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {item.description}
              </Typography>
            </Box>
          </Box>
        ))}
      </Stack>

      <Button component={RouterLink} href={paths.home} size="large" variant="outlined" color="inherit">
        {ENROLL_COPY.confirm.returnHome}
      </Button>
    </Container>
  );
}
