import type { Theme, SxProps } from '@mui/material/styles';
import type { ButtonBaseProps } from '@mui/material/ButtonBase';

import { usePopover } from 'minimal-shared/hooks';

import Box from '@mui/material/Box';
import Avatar from '@mui/material/Avatar';
import Divider from '@mui/material/Divider';
import MenuList from '@mui/material/MenuList';
import MenuItem from '@mui/material/MenuItem';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import Button, { buttonClasses } from '@mui/material/Button';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { CONFIG } from 'src/global-config';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { CustomPopover } from 'src/components/custom-popover';

import { useAuthContext } from 'src/auth/hooks';
import { isPlatformRole } from 'src/auth/context/om-auth';

import { useWorkspaces } from './use-active-church';

// ----------------------------------------------------------------------

export type WorkspacesPopoverProps = ButtonBaseProps;

/**
 * Parish switcher (Minimal's workspace switcher repurposed).
 * Church users see their parish and plan; platform admins switch the parish they
 * are acting in — every church-scoped page follows the selection.
 */
export function WorkspacesPopover({ sx, ...other }: WorkspacesPopoverProps) {
  const mediaQuery = 'sm';
  const { user, authenticated } = useAuthContext();
  const platform = isPlatformRole(user?.role);
  const { open, anchorEl, onClose, onOpen } = usePopover();
  const { workspaces, active, select } = useWorkspaces(authenticated);

  const planColor = (plan: string) => (plan === 'Free' ? 'default' : 'info');
  const fallbackLogo = `${CONFIG.assetsDir}/logo/om-mark-light.png`;

  const handleSelect = (id: number) => {
    select(id);
    onClose();
    const ws = workspaces.find((w) => w.id === id);
    if (platform && ws) toast.success(`Acting in ${ws.name}`);
  };

  const buttonBg: SxProps<Theme> = {
    height: 1,
    zIndex: -1,
    opacity: 0,
    content: "''",
    borderRadius: 1,
    position: 'absolute',
    visibility: 'hidden',
    bgcolor: 'action.hover',
    width: 'calc(100% + 8px)',
    transition: (theme) => theme.transitions.create(['opacity', 'visibility'], { easing: theme.transitions.easing.sharp, duration: theme.transitions.duration.shorter }),
    ...(open && { opacity: 1, visibility: 'visible' }),
  };

  if (!workspaces.length) return null;

  const renderButton = () => (
    <ButtonBase disableRipple onClick={onOpen} sx={[{ py: 0.5, gap: { xs: 0.5, [mediaQuery]: 1 }, '&::before': buttonBg }, ...(Array.isArray(sx) ? sx : [sx])]} {...other}>
      <Avatar alt={active?.name} src={active?.icon_url || active?.image_url || fallbackLogo} sx={{ width: 24, height: 24, bgcolor: 'background.neutral', '& img': { objectFit: (active?.icon_url || active?.image_url) ? 'cover' : 'contain', p: (active?.icon_url || active?.image_url) ? 0 : 0.25 } }} />
      <Box component="span" sx={{ typography: 'subtitle2', display: { xs: 'none', [mediaQuery]: 'inline-block' }, maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {active?.name ?? 'Choose a parish'}
      </Box>
      {active && (
        <Label color={planColor(active.plan)} sx={{ height: 22, cursor: 'inherit', display: { xs: 'none', [mediaQuery]: 'inline-flex' } }}>
          {active.plan}
        </Label>
      )}
      {(platform || workspaces.length > 1) && <Iconify width={16} icon="carbon:chevron-sort" sx={{ color: 'text.disabled' }} />}
    </ButtonBase>
  );

  const renderMenuList = () => (
    <CustomPopover open={open} anchorEl={anchorEl} onClose={onClose} slotProps={{ arrow: { placement: 'top-left' }, paper: { sx: { mt: 0.5, ml: -1.55, width: 300 } } }}>
      {platform && (
        <Typography variant="overline" sx={{ px: 2, pt: 1.5, pb: 0.5, display: 'block', color: 'text.disabled' }}>
          Acting in parish
        </Typography>
      )}
      <Scrollbar sx={{ maxHeight: 280 }}>
        <MenuList>
          {workspaces.map((w) => (
            <MenuItem key={w.id} selected={w.id === active?.id} onClick={() => handleSelect(w.id)} sx={{ height: 52 }}>
              <Avatar alt={w.name} src={w.icon_url || w.image_url || fallbackLogo} sx={{ width: 28, height: 28, bgcolor: 'background.neutral', '& img': { objectFit: (w.icon_url || w.image_url) ? 'cover' : 'contain', p: (w.icon_url || w.image_url) ? 0 : 0.25 } }} />
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Typography noWrap component="span" variant="body2" sx={{ display: 'block', fontWeight: 'fontWeightMedium' }}>{w.name}</Typography>
                <Typography noWrap component="span" variant="caption" sx={{ display: 'block', color: 'text.disabled' }}>
                  {[w.city && w.state ? `${w.city}, ${w.state}` : w.city || w.state, w.jurisdiction].filter(Boolean).join(' · ') || `#${w.id}`}
                </Typography>
              </Box>
              <Label color={planColor(w.plan)}>{w.plan}</Label>
            </MenuItem>
          ))}
        </MenuList>
      </Scrollbar>

      <Divider sx={{ my: 0.5, borderStyle: 'dashed' }} />
      {platform ? (
        <Button
          fullWidth
          component={RouterLink}
          href={paths.dashboard.user.new}
          onClick={onClose}
          startIcon={<Iconify width={18} icon="solar:user-plus-bold" />}
          sx={{ gap: 2, justifyContent: 'flex-start', fontWeight: 'fontWeightMedium', [`& .${buttonClasses.startIcon}`]: { m: 0, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' } }}
        >
          Add a parish user
        </Button>
      ) : (
        <Button
          fullWidth
          component={RouterLink}
          href={`${paths.dashboard.user.account}/billing`}
          onClick={onClose}
          startIcon={<Iconify width={18} icon="solar:bill-list-bold" />}
          sx={{ gap: 2, justifyContent: 'flex-start', fontWeight: 'fontWeightMedium', [`& .${buttonClasses.startIcon}`]: { m: 0, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' } }}
        >
          Plan &amp; subscription
        </Button>
      )}
    </CustomPopover>
  );

  return (
    <>
      {renderButton()}
      {renderMenuList()}
    </>
  );
}
