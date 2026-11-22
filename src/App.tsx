import { useEffect, useState } from 'react';
import { Archive, CalendarClock, FileUp, LogOut, Settings as SettingsIcon, Users } from 'lucide-react';
import { hydrate, useDB } from './store/db';
import { initAuth, signOut, useAuth } from './store/auth';
import { startSync } from './store/sync';
import { autoCloseDuePlans } from './store/actions';
import { isCloudMode } from './lib/supabase';
import type { Role } from './lib/types';
import { Toasts, confirmDialog } from './components/ui';
import { SyncIndicator } from './components/SyncIndicator';
import { Login } from './features/auth/Login';
import { TodayView } from './features/today/TodayView';
import { ImportView } from './features/import/ImportView';
import { EmployeesView } from './features/employees/EmployeesView';
import { ArchiveView } from './features/archive/ArchiveView';
import { SettingsView } from './features/settings/SettingsView';
import { useUnreadCount } from './features/archive/useArchive';

type View = 'today' | 'import' | 'employees' | 'archive' | 'settings';

const NAV: { id: View; label: string; icon: typeof Users; roles: Role[] }[] = [
  { id: 'today', label: 'Tagesplan', icon: CalendarClock, roles: ['filiale', 'filialleitung'] },
  { id: 'import', label: 'PDF-Import', icon: FileUp, roles: ['filialleitung'] },
  { id: 'employees', label: 'Mitarbeiter', icon: Users, roles: ['filialleitung'] },
  { id: 'archive', label: 'Archiv', icon: Archive, roles: ['personalleitung'] },
  { id: 'settings', label: 'Einstellungen', icon: SettingsIcon, roles: ['filialleitung'] },
];

export const ROLE_LABEL: Record<Role, string> = { filiale: 'Filiale / Theke', filialleitung: 'Filialleitung', personalleitung: 'Personalleitung' };

export default function App() {
  const hydrated = useDB((s) => s.hydrated);
  const { ready, role, displayName } = useAuth();
  const [view, setView] = useState<View>('today');
  const unread = useUnreadCount();

  useEffect(() => {
    void hydrate().then(() => initAuth()).then(() => startSync());
  }, []);

  // Auto-Abschluss-Fallback im Client (primär: pg_cron auf dem Server)
  useEffect(() => {
    if (!hydrated || !role || role === 'personalleitung') return;
    const tick = () => autoCloseDuePlans();
    tick();
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, [hydrated, role]);

  useEffect(() => {
    if (role) setView(role === 'personalleitung' ? 'archive' : 'today');
  }, [role]);

  if (!hydrated || !ready) {
    return <div className="flex h-full items-center justify-center text-lg text-stone-500">Lade Pausenplaner …</div>;
  }
  if (!role) return <Login />;

  const nav = NAV.filter((n) => n.roles.includes(role));

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="flex items-center gap-3 px-3 py-2 sm:px-5">
          <img src="/icon.svg" alt="" className="h-9 w-9" />
          <div className="mr-auto leading-tight">
            <div className="font-bold">Pausenplaner</div>
            <div className="text-xs text-stone-500">{ROLE_LABEL[role]}{displayName ? ` · ${displayName}` : ''}</div>
          </div>
          <SyncIndicator />
          <button
            className="flex h-12 w-12 items-center justify-center rounded-xl text-stone-600 hover:bg-stone-100"
            aria-label="Abmelden"
            title={isCloudMode ? 'Abmelden' : 'Rolle wechseln'}
            onClick={() => confirmDialog(isCloudMode ? 'Wirklich abmelden? Auf dem Filial-Tablet bleibt die Anmeldung sonst dauerhaft bestehen.' : 'Rolle wechseln?') && signOut()}
          >
            <LogOut size={20} />
          </button>
        </div>
        {nav.length > 1 && (
          <nav className="no-scrollbar flex gap-1 overflow-x-auto px-2 sm:px-4">
            {nav.map((n) => (
              <button
                key={n.id}
                onClick={() => setView(n.id)}
                className={`relative flex min-h-12 shrink-0 items-center gap-2 border-b-[3px] px-4 font-semibold ${view === n.id ? 'border-brand-700 text-brand-700' : 'border-transparent text-stone-500 hover:text-stone-800'}`}
              >
                <n.icon size={18} />
                {n.label}
                {n.id === 'archive' && unread > 0 && <span className="rounded-full bg-red-600 px-2 text-xs text-white">{unread}</span>}
              </button>
            ))}
          </nav>
        )}
      </header>
      <main className="flex-1">
        {view === 'today' && <TodayView onGoImport={role === 'filialleitung' ? () => setView('import') : undefined} />}
        {view === 'import' && <ImportView onDone={() => setView('today')} />}
        {view === 'employees' && <EmployeesView />}
        {view === 'archive' && <ArchiveView />}
        {view === 'settings' && <SettingsView />}
      </main>
      <Toasts />
    </div>
  );
}
