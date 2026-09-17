import type { LinkProps } from '@mui/material/Link';

import { mergeClasses } from 'minimal-shared/utils';

import Link from '@mui/material/Link';
import { styled } from '@mui/material/styles';

import { RouterLink } from 'src/routes/components';

import { CONFIG } from 'src/global-config';

import { logoClasses } from './classes';

// ----------------------------------------------------------------------

export type LogoProps = LinkProps & {
  isSingle?: boolean;
  disabled?: boolean;
};

export function Logo({
  sx,
  disabled,
  className,
  href = '/',
  isSingle = true,
  ...other
}: LogoProps) {
  /**
   * Orthodox Metrics brand marks.
   * `om-mark` is the standalone OM glyph (green in both colour schemes).
   * `om-full` is the OMetrics lockup — the wordmark is near-black, so the
   * light-on-dark variant is swapped in for the dark colour scheme.
   */
  const markUrl = `${CONFIG.assetsDir}/logo/om-mark.png`;
  const fullUrl = `${CONFIG.assetsDir}/logo/om-full.png`;
  const fullLightUrl = `${CONFIG.assetsDir}/logo/om-full-light.png`;

  return (
    <LogoRoot
      component={RouterLink}
      href={href}
      aria-label="Orthodox Metrics"
      underline="none"
      className={mergeClasses([logoClasses.root, className])}
      sx={[
        (theme) => ({
          width: 40,
          height: 40,
          backgroundSize: 'contain',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'left center',
          backgroundImage: `url(${markUrl})`,
          ...(!isSingle && {
            width: 132,
            height: 40,
            backgroundImage: `url(${fullUrl})`,
            ...theme.applyStyles('dark', {
              backgroundImage: `url(${fullLightUrl})`,
            }),
          }),
          ...(disabled && { pointerEvents: 'none' }),
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    />
  );
}

// ----------------------------------------------------------------------

const LogoRoot = styled(Link)(() => ({
  flexShrink: 0,
  color: 'transparent',
  display: 'inline-flex',
  verticalAlign: 'middle',
}));
