import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { Layout } from './components/Layout'
import { PageLoader } from './components/ui'
import { LoginPage, SetupPage } from './pages/Auth'
import { DashboardPage } from './pages/Dashboard'
import { FilesPage } from './pages/Files'

const UploadsPage = lazy(() => import('./pages/Uploads'))
const SyncPage = lazy(() => import('./pages/Sync'))
const DevicesPage = lazy(() => import('./pages/Devices'))
const AutomationsPage = lazy(() => import('./pages/Automations'))
const AutomationEditorPage = lazy(() => import('./automation/EditorPage'))
const ActivityPage = lazy(() => import('./pages/Activity'))
const TrashPage = lazy(() => import('./pages/Trash'))
const AccountPage = lazy(() => import('./pages/Account'))
const AdminPage = lazy(() => import('./pages/admin/Admin'))

export function App() {
  const { state } = useAuth()
  if (state.status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <PageLoader label="Connecting to VaultDock" />
      </div>
    )
  }
  if (state.status === 'anonymous') {
    return state.needsSetup ? <SetupPage tokenRequired={state.tokenRequired} /> : <LoginPage registration={state.registration} siteName={state.siteName} />
  }
  const isAdmin = state.user.role === 'admin'
  return (
    <Layout>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/files" element={<FilesPage />} />
          <Route path="/files/:folderId" element={<FilesPage />} />
          <Route path="/uploads" element={<UploadsPage />} />
          <Route path="/sync" element={<SyncPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/automations" element={<AutomationsPage />} />
          <Route path="/automations/new" element={<AutomationEditorPage />} />
          <Route path="/automations/:id" element={<AutomationEditorPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/trash" element={<TrashPage />} />
          <Route path="/account" element={<AccountPage />} />
          {isAdmin && <Route path="/admin/*" element={<AdminPage />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  )
}
