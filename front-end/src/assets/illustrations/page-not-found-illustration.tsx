import type { BoxProps } from '@mui/material/Box';

import { memo } from 'react';

import Box from '@mui/material/Box';

import { CONFIG } from 'src/global-config';

// ----------------------------------------------------------------------

function PageNotFoundIllustration({ sx, ...other }: BoxProps) {
  return (
    <Box
      component="img"
      alt="Page not found"
      src={`${CONFIG.assetsDir}/assets/illustrations/illustration-404.png`}
      sx={[
        { width: 1, maxWidth: 400, mx: 'auto', display: 'block' },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    />
  );
}

export default memo(PageNotFoundIllustration);
