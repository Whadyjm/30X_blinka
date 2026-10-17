import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { PageLoading } from '@/components/ui/Card';
import { env } from '@/config/env';
import { AppLayout } from './AppLayout';
import { RequireAuth, RequireMandate } from './guards';
import { Providers } from './Providers';
import { Landing } from '@/pages/Landing';
import { Login } from '@/pages/Login';
import { NotFound } from '@/pages/NotFound';

const Onboarding = lazy(() => import('@/pages/Onboarding').then((m) => ({ default: m.Onboarding })));
const AskOli = lazy(() => import('@/pages/AskOli').then((m) => ({ default: m.AskOli })));
const Dashboard = lazy(() => import('@/pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Bills = lazy(() => import('@/pages/Bills').then((m) => ({ default: m.Bills })));
const BillDetail = lazy(() => import('@/pages/BillDetail').then((m) => ({ default: m.BillDetail })));
const Approvals = lazy(() => import('@/pages/Approvals').then((m) => ({ default: m.Approvals })));
const Rules = lazy(() => import('@/pages/Rules').then((m) => ({ default: m.Rules })));
const Settings = lazy(() => import('@/pages/Settings').then((m) => ({ default: m.Settings })));
const Integrations = lazy(() => import('@/pages/Integrations').then((m) => ({ default: m.Integrations })));
const Inbox = lazy(() => import('@/pages/Inbox').then((m) => ({ default: m.Inbox })));
const Evaluation = lazy(() => import('@/pages/Evaluation').then((m) => ({ default: m.Evaluation })));
const ComingSoon = lazy(() => import('@/pages/ComingSoon').then((m) => ({ default: m.ComingSoon })));

export function App() {
  return (
    <Providers>
      <BrowserRouter>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />

            <Route element={<RequireAuth />}>
              <Route path="/onboarding" element={<Onboarding />} />
              <Route element={<RequireMandate />}>
                <Route path="/app" element={<AppLayout />}>
                  <Route index element={<AskOli />} />
                  <Route path="dashboard" element={<Dashboard />} />
                  <Route path="bills" element={<Bills />} />
                  <Route path="bills/:id" element={<BillDetail />} />
                  <Route path="approvals" element={<Approvals />} />
                  <Route path="rules" element={<Rules />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="integrations" element={<Integrations />} />
                  <Route path="inbox" element={<Inbox />} />
                  <Route path="evaluation" element={<Evaluation />} />
                  {env.features.agentAccess && <Route path="agent-access" element={<ComingSoon title="Agent access" />} />}
                  <Route path="chat" element={<Navigate to="/app" replace />} />
                </Route>
              </Route>
            </Route>

            <Route path="/home" element={<Navigate to="/app" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </Providers>
  );
}
