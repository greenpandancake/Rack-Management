import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard.js';
import { Intake } from './pages/Intake.js';
import { CargoDetail } from './pages/CargoDetail.js';
import { Settings } from './pages/Settings.js';
import { Cleared } from './pages/Cleared.js';
import { Reports } from './pages/Reports.js';
import { VesselIntake } from './pages/VesselIntake.js';
import { useSocketBridge } from './hooks/useSocket.js';
import { useTheme } from './hooks/useTheme.js';
import { usePermission } from './hooks/usePermission.js';
import { ChangePasswordPage, LoginPage, useAuth } from './auth.js';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded-md transition ${
    isActive
      ? 'bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100'
  }`;

function NoAccess() {
  return (
    <main className="min-h-full grid place-items-center text-sm text-slate-600 dark:text-slate-400">
      You don't have access to this page. Contact your administrator.
    </main>
  );
}

export function App() {
  useSocketBridge();
  const auth = useAuth();
  const { theme, toggle } = useTheme();
  const canViewDashboard = usePermission('canViewDashboard');
  const canViewIntake = usePermission('canViewIntake');
  const canViewVesselIntake = usePermission('canViewVesselIntake');
  const canViewCleared = usePermission('canViewCleared');
  const canViewReports = usePermission('canViewReports');
  const canViewSettings = usePermission('canViewSettings');

  if (auth.loading) return <div className="min-h-full grid place-items-center text-sm text-slate-600 dark:text-slate-400">Loading...</div>;
  if (!auth.user) return <LoginPage />;
  if (auth.mustChangePassword) return <ChangePasswordPage />;

  return (
    <div className="min-h-full flex flex-col bg-slate-100 dark:bg-slate-950">
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 shadow-sm dark:bg-slate-900/95 dark:border-slate-700">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
          <Link to="/" className="flex items-center gap-3">
            <span className="grid place-items-center h-9 w-9 rounded-lg bg-slate-900 text-white font-bold dark:bg-slate-100 dark:text-slate-900">M</span>
            <span>
              <span className="block font-bold leading-tight">MPL Smart Rack</span>
              <span className="block text-xs text-slate-500 leading-tight dark:text-slate-400">Warehouse rack control</span>
            </span>
          </Link>
          <nav className="flex gap-1 ml-auto text-sm items-center">
            {canViewDashboard && <NavLink to="/" end className={linkClass}>Dashboard</NavLink>}
            {canViewIntake && <NavLink to="/intake" className={linkClass}>CFS intake</NavLink>}
            {canViewVesselIntake && <NavLink to="/vessel-intake" className={linkClass}>Vessel Intake</NavLink>}
            {canViewCleared && <NavLink to="/cleared" className={linkClass}>Intakes</NavLink>}
            {canViewReports && <NavLink to="/reports" className={linkClass}>Reports</NavLink>}
            {canViewSettings && <NavLink to="/settings" className={linkClass}>Settings</NavLink>}
            <button
              onClick={toggle}
              aria-label="Toggle dark mode"
              className="px-2 py-2 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
            >
              {theme === 'dark' ? '☀' : '🌙'}
            </button>
            <button onClick={auth.logout} className="px-3 py-2 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100">
              Sign out
            </button>
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto w-full px-4 py-6 flex-1">
        <Routes>
          <Route path="/" element={canViewDashboard ? <Dashboard /> : <NoAccess />} />
          <Route path="/intake" element={canViewIntake ? <Intake /> : <NoAccess />} />
          <Route path="/vessel-intake" element={canViewVesselIntake ? <VesselIntake /> : <NoAccess />} />
          <Route path="/cargo/:id" element={<CargoDetail />} />
          <Route path="/cleared" element={canViewCleared ? <Cleared /> : <NoAccess />} />
          <Route path="/reports" element={canViewReports ? <Reports /> : <NoAccess />} />
          <Route path="/settings" element={canViewSettings ? <Settings /> : <Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
