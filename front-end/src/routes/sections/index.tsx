import type { RouteObject } from 'react-router';

import { lazy, Suspense } from 'react';
import { Navigate } from 'react-router';

import { paths } from 'src/routes/paths';

import { MainLayout } from 'src/layouts/main';
import { AuthSplitLayout } from 'src/layouts/auth-split';

import { SplashScreen } from 'src/components/loading-screen';

import { LANDING_PATHS } from 'src/sections/home/landing-sections';

import { authRoutes } from './auth';
import { mainRoutes } from './main';
import { authDemoRoutes } from './auth-demo';
import { dashboardRoutes } from './dashboard';
import { componentsRoutes } from './components';

// ----------------------------------------------------------------------

const HomePage = lazy(() => import('src/pages/home'));
const OmSignInPage = lazy(() => import('src/pages/auth/sign-in'));

const homeElement = (
  <Suspense fallback={<SplashScreen />}>
    <MainLayout>
      <HomePage />
    </MainLayout>
  </Suspense>
);

export const routesSection: RouteObject[] = [
  /**
   * `/`, `/product`, `/products`, `/records`, `/ocr`, `/capabilities` and `/analytics`
   * all render the home page — matching OM, where these are not separate pages but deep
   * links to named sections. The scroll is handled in `HomeView` via `sectionIdForPath`.
   *
   * NOTE: this claims `/product`, which the template also uses for its e-commerce demo.
   * OM's routing wins; the demo product routes remain reachable at `/product/list` etc.
   */
  ...LANDING_PATHS.map((path) => ({ path, element: homeElement })),

  /** Orthodox Metrics sign-in — authenticates against the real OM backend. */
  {
    path: '/auth/login',
    element: (
      <Suspense fallback={<SplashScreen />}>
        <AuthSplitLayout>
          <OmSignInPage />
        </AuthSplitLayout>
      </Suspense>
    ),
  },

  // Auth
  ...authRoutes,
  ...authDemoRoutes,

  // Dashboard
  ...dashboardRoutes,

  // Main
  ...mainRoutes,

  // Components
  ...componentsRoutes,

  /**
   * Legacy bare `/ocr/upload` URL (pre-dates the `/portal` OCR routes).
   * `/portal/ocr` and `/portal/ocr/upload` are real routes now, not shims.
   */
  { path: 'ocr/upload', element: <Navigate to={paths.portal.ocr.upload} replace /> },

  // Unknown paths → real 404 page
  { path: '*', element: <Navigate to={paths.page404} replace /> },
];
