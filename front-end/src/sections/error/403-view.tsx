import { m } from 'framer-motion';

import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { SimpleLayout } from 'src/layouts/simple';
import { ForbiddenIllustration } from 'src/assets/illustrations';

import { varBounce, MotionContainer } from 'src/components/animate';

import { PublicPageBuilderOverride } from 'src/sections/latest-news/public-page-builder-override';

import { useAuthContext } from 'src/auth/hooks';

// ----------------------------------------------------------------------

export function View403() {
  const { authenticated } = useAuthContext();
  const homeHref = authenticated ? paths.portal.root : paths.signIn;

  return (
    <SimpleLayout
      slotProps={{
        content: { compact: true },
      }}
    >
      <PublicPageBuilderOverride
        pageType="error_403"
        fallback={<Container component={MotionContainer}>
        <m.div variants={varBounce('in')}>
          <Typography variant="h3" sx={{ mb: 2 }}>
            No permission
          </Typography>
        </m.div>

        <m.div variants={varBounce('in')}>
          <Typography sx={{ color: 'text.secondary' }}>
            The page you’re trying to access has restricted access. Please refer to your system
            administrator.
          </Typography>
        </m.div>

        <m.div variants={varBounce('in')}>
          <ForbiddenIllustration sx={{ my: { xs: 5, sm: 10 } }} />
        </m.div>

        <Button component={RouterLink} href={homeHref} size="large" variant="contained">
          Go to home
        </Button>
        </Container>}
      />
    </SimpleLayout>
  );
}
