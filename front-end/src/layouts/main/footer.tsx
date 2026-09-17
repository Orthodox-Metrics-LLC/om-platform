import type { Breakpoint } from '@mui/material/styles';

import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Grid from '@mui/material/Grid';
import Divider from '@mui/material/Divider';
import { styled } from '@mui/material/styles';
import Container from '@mui/material/Container';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { _socials } from 'src/_mock';

import { Logo } from 'src/components/logo';
import { Iconify } from 'src/components/iconify';

// ----------------------------------------------------------------------

const LINKS = [
  {
    headline: 'Product',
    children: [
      { name: 'Record capabilities', href: paths.records },
      { name: 'Paper to digital', href: paths.ocr },
      { name: 'Pricing', href: paths.pricing },
      { name: 'Enroll Your Parish', href: paths.enroll },
    ],
  },
  {
    headline: 'Company',
    children: [
      { name: 'About Us', href: paths.about },
      { name: 'Latest News', href: paths.latestNews },
      { name: 'Contact', href: paths.contact },
      { name: 'FAQ', href: paths.faqs },
    ],
  },
  {
    headline: 'Legal',
    children: [
      { name: 'Terms of Service', href: paths.terms },
      { name: 'Privacy Policy', href: paths.privacy },
      { name: 'Security', href: paths.security },
    ],
  },
  {
    headline: 'Support',
    children: [
      { name: 'info@orthodoxmetrics.com', href: paths.external.supportEmail },
      { name: 'Monday–Friday, 9am–5pm EST', href: '' },
    ],
  },
];

/** mailto:/http(s): links must not go through the router. */
const isExternalHref = (href: string) => /^(mailto:|tel:|https?:)/.test(href);

// ----------------------------------------------------------------------

const FooterRoot = styled('footer')(({ theme }) => ({
  position: 'relative',
  backgroundColor: theme.vars.palette.background.default,
}));

export type FooterProps = React.ComponentProps<typeof FooterRoot>;

export function Footer({
  sx,
  layoutQuery = 'md',
  ...other
}: FooterProps & { layoutQuery?: Breakpoint }) {
  return (
    <FooterRoot sx={sx} {...other}>
      <Divider />

      <Container
        sx={(theme) => ({
          pb: 5,
          pt: 10,
          textAlign: 'center',
          [theme.breakpoints.up(layoutQuery)]: { textAlign: 'unset' },
        })}
      >
        <Logo />

        <Grid
          container
          sx={[
            (theme) => ({
              mt: 3,
              justifyContent: 'center',
              [theme.breakpoints.up(layoutQuery)]: { justifyContent: 'space-between' },
            }),
          ]}
        >
          <Grid size={{ xs: 12, [layoutQuery]: 3 }}>
            <Typography
              variant="body2"
              sx={(theme) => ({
                mx: 'auto',
                maxWidth: 280,
                [theme.breakpoints.up(layoutQuery)]: { mx: 'unset' },
              })}
            >
              Orthodox Metrics is the records platform for Orthodox parishes — secure baptism,
              marriage, and funeral registers, OCR digitization of historic ledgers, and
              multi-tenant parish administration.
            </Typography>

            <Box
              sx={(theme) => ({
                mt: 3,
                mb: 5,
                display: 'flex',
                justifyContent: 'center',
                [theme.breakpoints.up(layoutQuery)]: { mb: 0, justifyContent: 'flex-start' },
              })}
            >
              {_socials.map((social) => (
                <IconButton key={social.label}>
                  {social.value === 'twitter' && <Iconify icon="socials:twitter" />}
                  {social.value === 'facebook' && <Iconify icon="socials:facebook" />}
                  {social.value === 'instagram' && <Iconify icon="socials:instagram" />}
                  {social.value === 'linkedin' && <Iconify icon="socials:linkedin" />}
                </IconButton>
              ))}
            </Box>
          </Grid>

          <Grid size={{ xs: 12, [layoutQuery]: 6 }}>
            <Box
              sx={(theme) => ({
                gap: 5,
                display: 'flex',
                flexDirection: 'column',
                [theme.breakpoints.up(layoutQuery)]: { flexDirection: 'row' },
              })}
            >
              {LINKS.map((list) => (
                <Box
                  key={list.headline}
                  sx={(theme) => ({
                    gap: 2,
                    width: 1,
                    display: 'flex',
                    alignItems: 'center',
                    flexDirection: 'column',
                    [theme.breakpoints.up(layoutQuery)]: { alignItems: 'flex-start' },
                  })}
                >
                  <Typography component="div" variant="overline">
                    {list.headline}
                  </Typography>

                  {list.children.map((link) =>
                    link.href ? (
                      <Link
                        key={link.name}
                        {...(isExternalHref(link.href) ? {} : { component: RouterLink })}
                        href={link.href}
                        color="inherit"
                        variant="body2"
                      >
                        {link.name}
                      </Link>
                    ) : (
                      <Typography key={link.name} variant="body2" sx={{ color: 'text.secondary' }}>
                        {link.name}
                      </Typography>
                    )
                  )}
                </Box>
              ))}
            </Box>
          </Grid>
        </Grid>

        <Typography variant="body2" sx={{ mt: 10 }}>
          © {new Date().getFullYear()} Orthodox Metrics. All rights reserved.
        </Typography>
      </Container>
    </FooterRoot>
  );
}

// ----------------------------------------------------------------------

export function HomeFooter({ sx, ...other }: FooterProps) {
  return (
    <FooterRoot
      sx={[
        {
          py: 5,
          textAlign: 'center',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      <Container>
        <Logo />
        <Box sx={{ mt: 1, typography: 'caption' }}>
          © {new Date().getFullYear()} Orthodox Metrics. All rights reserved.
        </Box>
      </Container>
    </FooterRoot>
  );
}
