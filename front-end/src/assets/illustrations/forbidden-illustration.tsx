import type { BoxProps } from '@mui/material/Box';

import { memo } from 'react';

import Box from '@mui/material/Box';

import { CONFIG } from 'src/global-config';

// ----------------------------------------------------------------------

function ForbiddenIllustration({ sx, ...other }: BoxProps) {
  return (
    <Box
      component="img"
      alt="No permission"
      src={`${CONFIG.assetsDir}/assets/illustrations/illustration-403.png`}
      sx={[
        { width: 1, maxWidth: 400, mx: 'auto', display: 'block' },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    />
  );
}

export default memo(ForbiddenIllustration);
