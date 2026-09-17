import type { BoxProps } from '@mui/material/Box';

import { m } from 'framer-motion';
import { useTabs } from 'minimal-shared/hooks';
import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { Iconify } from 'src/components/iconify';
import { varFade, varScale, MotionViewport } from 'src/components/animate';

import { SectionTitle } from './components/section-title';
import { FloatLine, FloatXIcon } from './components/svg-elements';

// ----------------------------------------------------------------------

export function HomePricing({ sx, ...other }: BoxProps) {
  const tabs = useTabs('Parish Essentials');

  const renderDescription = () => (
    <SectionTitle
      caption="plans"
      title="Flexible plans designed to"
      txtGradient="scale"
      description="From small rural parishes to cathedral archives — one-time digitization for your historic books, plus affordable monthly hosting for a living sacramental registry."
      sx={{ mb: 8, textAlign: 'center' }}
    />
  );

  const renderContentDesktop = () => (
    <Box
      sx={{
        gridTemplateColumns: 'repeat(3, 1fr)',
        display: { xs: 'none', md: 'grid' },
      }}
    >
      {PLANS.map((plan) => (
        <PlanCard
          key={plan.license}
          plan={plan}
          sx={(theme) => ({
            ...(plan.license === 'Plus' && {
              [theme.breakpoints.down(1440)]: {
                borderLeft: `dashed 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.2)}`,
                borderRight: `dashed 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.2)}`,
              },
            }),
          })}
        />
      ))}
    </Box>
  );

  const renderContentMobile = () => (
    <Stack
      spacing={5}
      sx={{
        alignItems: 'center',
        display: { md: 'none' },
      }}
    >
      <Tabs
        value={tabs.value}
        onChange={tabs.onChange}
        sx={[
          (theme) => ({
            boxShadow: `0px -2px 0px 0px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.08)} inset`,
          }),
        ]}
      >
        {PLANS.map((tab) => (
          <Tab key={tab.license} value={tab.license} label={tab.license} />
        ))}
      </Tabs>

      <Box
        sx={[
          (theme) => ({
            width: 1,
            borderRadius: 2,
            border: `dashed 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.2)}`,
          }),
        ]}
      >
        {PLANS.map(
          (tab) => tab.license === tabs.value && <PlanCard key={tab.license} plan={tab} />
        )}
      </Box>
    </Stack>
  );

  return (
    <Box
      component="section"
      sx={[{ py: 10, position: 'relative' }, ...(Array.isArray(sx) ? sx : [sx])]}
      {...other}
    >
      <MotionViewport>
        <FloatLine vertical sx={{ top: 0, left: 80 }} />

        <Container>{renderDescription()}</Container>

        <Box
          sx={(theme) => ({
            position: 'relative',
            '&::before, &::after': {
              width: 64,
              height: 64,
              content: "''",
              [theme.breakpoints.up(1440)]: { display: 'block' },
            },
          })}
        >
          <Container>{renderContentDesktop()}</Container>

          <FloatLine sx={{ top: 64, left: 0 }} />
          <FloatLine sx={{ bottom: 64, left: 0 }} />
        </Box>

        <Container>{renderContentMobile()}</Container>
      </MotionViewport>
    </Box>
  );
}

// ----------------------------------------------------------------------

type PlanCardProps = BoxProps & {
  plan: {
    license: string;
    /** Display text, e.g. `$4.99`, or wording such as `Contact Us`. */
    price: string;
    /** Suffix shown after a quoted figure; omitted when there is no figure. */
    period?: string;
    caption: string;
    features: string[];
    cta: string;
    href: string;
    /** Renders the emphasised middle card treatment. */
    highlight?: boolean;
  };
};

const renderLines = () => (
  <>
    <FloatLine vertical sx={{ top: -64, left: 0, height: 'calc(100% + (64px * 2))' }} />
    <FloatLine vertical sx={{ top: -64, right: 0, height: 'calc(100% + (64px * 2))' }} />
    <FloatXIcon sx={{ top: -8, left: -8 }} />
    <FloatXIcon sx={{ top: -8, right: -8 }} />
    <FloatXIcon sx={{ bottom: -8, left: -8 }} />
    <FloatXIcon sx={{ bottom: -8, right: -8 }} />
  </>
);

function PlanCard({ plan, sx, ...other }: PlanCardProps) {
  const plusLicense = !!plan.highlight;

  return (
    <MotionViewport>
      <Box
        sx={[
          () => ({
            px: 6,
            py: 8,
            gap: 5,
            display: 'flex',
            position: 'relative',
            flexDirection: 'column',
          }),
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
        {...other}
      >
        {plusLicense && renderLines()}

        {/* `gap` matters when the plan name fits on one line — without it the
            name and the price run together. */}
        <Box sx={{ gap: 2, display: 'flex', alignItems: 'center' }}>
          <Box sx={{ flex: '1 1 auto' }}>
            <m.div variants={varFade('inLeft', { distance: 24 })}>
              <Typography variant="h4" component="h6">
                {plan.license}
              </Typography>
            </m.div>

            <m.div variants={varScale('inX')}>
              <Box
                sx={{
                  width: 32,
                  height: 6,
                  opacity: 0.24,
                  borderRadius: 1,
                  bgcolor: 'primary.main',
                  ...(plusLicense && { bgcolor: 'secondary.main' }),
                }}
              />
            </m.div>
          </Box>

          <m.div variants={varFade('inLeft', { distance: 24 })}>
            <Box
              component="span"
              sx={{ whiteSpace: 'nowrap', typography: plan.period ? 'h3' : 'h4' }}
            >
              {plan.price}
              {plan.period && (
                <Box component="span" sx={{ typography: 'body2', color: 'text.disabled' }}>
                  {plan.period}
                </Box>
              )}
            </Box>
          </m.div>
        </Box>

        <m.div variants={varFade('in')}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {plan.caption}
          </Typography>
        </m.div>

        <Stack spacing={2.5}>
          <m.div variants={varFade('inLeft', { distance: 24 })}>
            <Divider sx={{ borderStyle: 'dashed' }} />
          </m.div>

          {plan.features.map((option) => (
            <Box
              key={option}
              component={m.div}
              variants={varFade('in')}
              sx={{
                gap: 1.5,
                display: 'flex',
                typography: 'body2',
                alignItems: 'center',
              }}
            >
              <Iconify width={16} icon="eva:checkmark-fill" />
              {option}
            </Box>
          ))}
        </Stack>

        <m.div variants={varFade('inUp', { distance: 24 })}>
          <Button
            fullWidth
            component={RouterLink}
            variant={plusLicense ? 'contained' : 'outlined'}
            color="inherit"
            size="large"
            href={plan.href}
          >
            {plan.cta}
          </Button>
        </m.div>
      </Box>
    </MotionViewport>
  );
}

// ----------------------------------------------------------------------

const PLANS = [
  {
    license: 'Parish Essentials',
    price: '$4.99',
    period: '/mo',
    caption: 'For small, historical parishes with limited modern intake.',
    features: [
      'Up to 1,000 historical pages',
      'Standard search & metrics dashboard',
      'Secure cloud hosting & backup',
      'Email support',
    ],
    cta: 'Get Started',
    href: paths.enroll,
  },
  {
    license: 'Diocesan Standard',
    price: '$19.99',
    period: '/mo',
    caption: 'For active, mid-sized communities with deep historical archives.',
    features: [
      'Up to 5,000 historical pages',
      'Multi-user parish staff access',
      'Certificate generation',
      'Data export & import tools',
    ],
    cta: 'Choose Standard',
    href: paths.enroll,
    highlight: true,
  },
  {
    license: 'Cathedral Pro',
    price: 'Contact Us',
    caption: 'For large cathedrals, monastic libraries, or central diocesan archives.',
    features: [
      'Unlimited historical processing',
      '~50+ new pages/month',
      'Dedicated onboarding & training',
      'Multi-parish diocesan rollup',
    ],
    cta: 'Contact Us',
    href: paths.contact,
  },
];
