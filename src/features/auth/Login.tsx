import { useState } from 'react';
import { Briefcase, Store, UserCog } from 'lucide-react';
import { isCloudMode } from '../../lib/supabase';
import { setLocalRole, signIn, useAuth } from '../../store/auth';
import { Button, Field, inputCls } from '../../components/ui';
import type { Role } from '../../lib/types';

export function Login() {
  const authError = useAuth((s) => s.error);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roles: { role: Role; label: string; desc: string; icon: typeof Store }[] = [
    { role: 'filiale', label: 'Filiale / Theke', desc: 'Tagesplan, Pausen-Timer, Status & Notizen', icon: Store },
    { role: 'filialleitung', label: 'Filialleitung / Planer', desc: 'Zusätzlich PDF-Import, Stammdaten, Einstellungen', icon: UserCog },
    { role: 'personalleitung', label: 'Personalleitung', desc: 'Archiv, Soll/Ist-Abgleich, Export für PEPZeit', icon: Briefcase },
  ];

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <img src="/icon.svg" className="h-12 w-12" alt="" />
          <div>
            <h1 className="text-2xl font-bold">Pausenplaner</h1>
            <p className="text-sm text-stone-500">Digitale Pausenplanung für die Filiale</p>
          </div>
        </div>
        {isCloudMode ? (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(await signIn(email, password));
              setBusy(false);
            }}
          >
            <Field label="E-Mail">
              <input className={inputCls} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Passwort">
              <input className={inputCls} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            {(error || authError) && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error ?? authError}</p>}
            <button type="submit" disabled={busy} className="min-h-14 w-full rounded-xl bg-brand-700 text-lg font-semibold text-white disabled:opacity-50">
              {busy ? 'Anmelden …' : 'Anmelden'}
            </button>
            <p className="text-xs text-stone-500">Die Anmeldung bleibt auf diesem Gerät dauerhaft bestehen.</p>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Lokaler Modus: Supabase ist nicht konfiguriert. Daten bleiben auf diesem Gerät (offline-fähig, ohne Echtzeit-Sync).
            </p>
            {roles.map((r) => (
              <Button key={r.role} className="w-full justify-start py-3 text-left" size="lg" onClick={() => setLocalRole(r.role)} icon={<r.icon className="shrink-0" />}>
                <span>
                  <span className="block">{r.label}</span>
                  <span className="block text-sm font-normal text-stone-500">{r.desc}</span>
                </span>
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
