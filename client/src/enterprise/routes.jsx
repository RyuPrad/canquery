/* eslint-disable react-refresh/only-export-components -- extension part: core slots read its components from one object */
import { lazy } from 'react';

// Hosted-only pages, fetched only when the visitor opens one.
const PricingPage = lazy(() => import('./pages/PricingPage.jsx'));
const AccountPage = lazy(() => import('./pages/AccountPage.jsx'));
const AuthPage = lazy(() => import('./pages/AuthPage.jsx'));
const TermsPage = lazy(() => import('./pages/TermsPage.jsx'));

export default [
  { path: '/pricing', element: <PricingPage /> },
  { path: '/account', element: <AccountPage /> },
  ...['login', 'signup', 'forgot-password', 'reset-password'].map(path => ({ path: '/' + path, element: <AuthPage key={path} /> })),
  { path: '/terms', element: <TermsPage /> },
];
