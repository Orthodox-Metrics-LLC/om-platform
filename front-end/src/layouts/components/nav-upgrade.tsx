import type { BoxProps } from '@mui/material/Box';

import { m } from 'framer-motion';
import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Avatar from '@mui/material/Avatar';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { CONFIG } from 'src/global-config';

import { useAuthContext } from 'src/auth/hooks';
import { isChurchRole } from 'src/auth/context/om-auth';

import { useParishAppearance } from './use-parish-appearance';

// ----------------------------------------------------------------------

/**
 * Bottom of the sidebar. Church roles see their parish card (church image +
 * name banner) above the signed-in user; platform roles see just the user.
 */
export function NavUpgrade({ sx, ...other }: BoxProps) {
  const { user, authenticated } = useAuthContext();
  const church = isChurchRole(user?.role);
  const { appearance } = useParishAppearance(authenticated && church);

  const renderParish = () =>
    appearance && (
      <Box component={RouterLink} href={`${paths.dashboard.user.account}/appearance`} sx={{ display: 'block', width: 1, mb: 3, textDecoration: 'none', color: 'inherit' }}>
        {appearance.image_url && (
          <Box
            component="img"
            alt={appearance.display_name}
            src={appearance.image_url}
            sx={{ width: 1, aspectRatio: '3 / 4', objectFit: 'cover', borderRadius: 3, display: 'block', mb: 1.5 }}
          />
        )}
        <Box
          sx={{
            px: 1.5,
            py: 1.5,
            borderRadius: 0.5,
            color: 'common.white',
            bgcolor: appearance.primary_color || '#2c5aa0',
            fontFamily: '"Georgia", "Times New Roman", serif',
            textTransform: 'uppercase',
            textAlign: 'center',
            lineHeight: 1.15,
          }}
        >
          <Typography component="div" sx={{ fontFamily: 'inherit', fontWeight: 700, fontSize: 17, letterSpacing: 0.3 }}>
            {appearance.display_name}
          </Typography>
          {(appearance.city || appearance.state) && (
            <>
              <Box sx={{ my: 0.75, mx: 'auto', width: '80%', borderTop: '1px solid', borderColor: 'rgba(255,255,255,0.6)' }} />
              <Typography component="div" sx={{ fontFamily: 'inherit', fontSize: 14, letterSpacing: 0.3 }}>
                {[appearance.city, appearance.state].filter(Boolean).join(', ')}
              </Typography>
            </>
          )}
        </Box>
      </Box>
    );

  return (
    <Box sx={[{ px: 2, py: 4, textAlign: 'center' }, ...(Array.isArray(sx) ? sx : [sx])]} {...other}>
      {church && renderParish()}

      <Box sx={{ display: 'flex', alignItems: 'center', flexDirection: 'column' }}>
        <Avatar src={user?.photoURL} alt={user?.displayName} sx={{ width: 48, height: 48 }}>
          {user?.displayName?.charAt(0).toUpperCase()}
        </Avatar>
        <Box sx={{ mt: 1.5, width: 1 }}>
          <Typography variant="subtitle2" noWrap>{user?.displayName}</Typography>
          <Typography variant="body2" noWrap sx={{ color: 'text.disabled', mt: 0.25 }}>{user?.email}</Typography>
        </Box>
      </Box>
    </Box>
  );
}

// ----------------------------------------------------------------------

export function UpgradeBlock({ sx, ...other }: BoxProps) {
  return (
    <Box
      sx={[
        (theme) => ({
          ...theme.mixins.bgGradient({
            images: [
              `linear-gradient(135deg, ${varAlpha(theme.vars.palette.error.lightChannel, 0.92)}, ${varAlpha(theme.vars.palette.secondary.darkChannel, 0.92)})`,
              `url(${CONFIG.assetsDir}/assets/background/background-7.webp)`,
            ],
          }),
          px: 3,
          py: 4,
          borderRadius: 2,
          position: 'relative',
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      <Box
        sx={(theme) => ({
          top: 0,
          left: 0,
          width: 1,
          height: 1,
          borderRadius: 2,
          position: 'absolute',
          border: `solid 3px ${varAlpha(theme.vars.palette.common.whiteChannel, 0.16)}`,
        })}
      />

      <Box
        component={m.img}
        animate={{ y: [12, -12, 12] }}
        transition={{
          duration: 8,
          ease: 'linear',
          repeat: Infinity,
          repeatDelay: 0,
        }}
        alt="Orthodox Metrics"
        src={`${CONFIG.assetsDir}/logo/om-mark-light.png`}
        sx={{
          right: 12,
          top: 28,
          width: 104,
          height: 'auto',
          opacity: 0.95,
          position: 'absolute',
          objectFit: 'contain',
          filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.24))',
        }}
      />

      <Box
        sx={{
          display: 'flex',
          position: 'relative',
          flexDirection: 'column',
          alignItems: 'flex-start',
        }}
      >
        <Box component="span" sx={{ typography: 'h5', color: 'common.white' }}>
          Orthodox Metrics
        </Box>

        <Box
          component="span"
          sx={{
            mb: 2,
            mt: 0.5,
            pr: 12,
            color: 'common.white',
            typography: 'subtitle2',
          }}
        >
          Preserve your parish&apos;s sacred records
        </Box>

        <Button
          component={RouterLink}
          href={paths.capabilities}
          variant="contained"
          size="small"
          color="warning"
        >
          Explore capabilities
        </Button>
      </Box>
    </Box>
  );
}
