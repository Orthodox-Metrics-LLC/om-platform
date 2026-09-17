import type { BoxProps } from '@mui/material/Box';

import { memo } from 'react';

import Box from '@mui/material/Box';

import { CONFIG } from 'src/global-config';

// ----------------------------------------------------------------------

function ServerErrorIllustration({ sx, ...other }: BoxProps) {
  return (
    <Box
      component="img"
      alt="Server error"
      src={`${CONFIG.assetsDir}/assets/illustrations/illustration-server.png`}
      sx={[
        { width: 1, maxWidth: 400, mx: 'auto', display: 'block' },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    />
  );
}

export default memo(ServerErrorIllustration);
