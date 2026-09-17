import type { BoxProps } from '@mui/material/Box';

import { memo } from 'react';

import Box from '@mui/material/Box';

import { CONFIG } from 'src/global-config';

// ----------------------------------------------------------------------

function MaintenanceIllustration({ sx, ...other }: BoxProps) {
  return (
    <Box
      component="img"
      alt="Maintenance"
      src={`${CONFIG.assetsDir}/assets/illustrations/illustration-tools.png`}
      sx={[
        { width: 1, maxWidth: 400, mx: 'auto', display: 'block' },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    />
  );
}

export default memo(MaintenanceIllustration);
