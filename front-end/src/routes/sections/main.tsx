import type { RouteObject } from 'react-router';

import { lazy, Suspense } from 'react';
import { Outlet, Navigate } from 'react-router';

import { MainLayout } from 'src/layouts/main';
import { SimpleLayout } from 'src/layouts/simple';

import { SplashScreen } from 'src/components/loading-screen';

// ----------------------------------------------------------------------

const FaqsPage = lazy(() => import('src/pages/faqs'));
const AboutPage = lazy(() => import('src/pages/about-us'));
const ContactPage = lazy(() => import('src/pages/contact-us'));
const PricingPage = lazy(() => import('src/pages/pricing'));
const PaymentPage = lazy(() => import('src/pages/payment'));
const ComingSoonPage = lazy(() => import('src/pages/coming-soon'));
const MaintenancePage = lazy(() => import('src/pages/maintenance'));
// Product
const ProductListPage = lazy(() => import('src/pages/product/list'));
const ProductDetailsPage = lazy(() => import('src/pages/product/details'));
const ProductCheckoutPage = lazy(() => import('src/pages/product/checkout'));
// Blog
const PostListPage = lazy(() => import('src/pages/post/list'));
const PostDetailsPage = lazy(() => import('src/pages/post/details'));
// Error
const Page500 = lazy(() => import('src/pages/error/500'));
const Page403 = lazy(() => import('src/pages/error/403'));
const Page404 = lazy(() => import('src/pages/error/404'));
// Blank
const BlankPage = lazy(() => import('src/pages/blank'));

// ----- Orthodox Metrics public site -----
const EnrollPage = lazy(() => import('src/pages/enroll'));
const LatestNewsPage = lazy(() => import('src/pages/latest-news'));
const TermsPage = lazy(() => import('src/pages/terms'));
const PrivacyPage = lazy(() => import('src/pages/privacy'));
const SecurityPage = lazy(() => import('src/pages/security'));

// ----------------------------------------------------------------------

export const mainRoutes: RouteObject[] = [
  {
    element: (
      <Suspense fallback={<SplashScreen />}>
        <Outlet />
      </Suspense>
    ),
    children: [
      {
        element: (
          <MainLayout>
            <Outlet />
          </MainLayout>
        ),
        children: [
          // Orthodox Metrics canonical public routes (PUBLIC_ROUTES).
          { path: 'about', element: <AboutPage /> },
          { path: 'contact', element: <ContactPage /> },
          { path: 'faq', element: <FaqsPage /> },
          { path: 'enroll', element: <EnrollPage /> },
          { path: 'latest-news', element: <LatestNewsPage /> },
          { path: 'terms', element: <TermsPage /> },
          { path: 'privacy', element: <PrivacyPage /> },
          { path: 'security', element: <SecurityPage /> },
          // Minimal template paths, kept so older links keep working.
          { path: 'about-us', element: <Navigate to="/about" replace /> },
          { path: 'contact-us', element: <Navigate to="/contact" replace /> },
          { path: 'faqs', element: <Navigate to="/faq" replace /> },
          { path: 'blank', element: <BlankPage /> },
          {
            path: 'product',
            children: [
              { index: true, element: <ProductListPage /> },
              { path: 'list', element: <ProductListPage /> },
              { path: ':id', element: <ProductDetailsPage /> },
              { path: 'checkout', element: <ProductCheckoutPage /> },
            ],
          },
          {
            path: 'post',
            children: [
              { index: true, element: <PostListPage /> },
              { path: 'list', element: <PostListPage /> },
              { path: ':title', element: <PostDetailsPage /> },
            ],
          },
        ],
      },
      {
        path: 'pricing',
        element: (
          <SimpleLayout>
            <PricingPage />
          </SimpleLayout>
        ),
      },
      {
        path: 'payment',
        element: (
          <SimpleLayout>
            <PaymentPage />
          </SimpleLayout>
        ),
      },
      {
        path: 'coming-soon',
        element: (
          <SimpleLayout slotProps={{ content: { compact: true } }}>
            <ComingSoonPage />
          </SimpleLayout>
        ),
      },
      {
        path: 'maintenance',
        element: (
          <SimpleLayout slotProps={{ content: { compact: true } }}>
            <MaintenancePage />
          </SimpleLayout>
        ),
      },
      {
        path: 'error',
        children: [
          { path: '500', element: <Page500 /> },
          { path: '404', element: <Page404 /> },
          { path: '403', element: <Page403 /> },
        ],
      },
    ],
  },
];
