import type { RouteObject } from 'react-router';

import { lazy, Suspense } from 'react';

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
const Page404 = lazy(() => import('src/pages/error/404'));
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

  // No match
  { path: '*', element: <Page404 /> },
];
