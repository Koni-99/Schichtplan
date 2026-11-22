import { useState } from 'react';
import { Briefcase, Store, UserCog } from 'lucide-react';
import { isCloudMode } from '../../lib/supabase';
import { setLocalRole, signIn, useAuth } from '../../store/auth';
import { Button, Field, inputCls } from '../../components/ui';
import type { Role } from '../../lib/types';
import { appName, BrandLogo, useApplyBranding } from '../../lib/branding';
import { useDB } from '../../store/db';

export function Login() {
  const authError = useAuth((s) => s.error);
  const brandName = useDB((s) => s.settings.brand_name);
  useApplyBranding();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roles: { role: Role; label: string; desc: string; icon: typeof Store }[] = [
    { role: 'filiale', label: 'Filiale / Theke', desc: 'Tagesplan, Pausen-Timer, Status & Notizen', icon: Store },
    { role: 'filialleitung', label: 'Filialleitung', desc: 'Zusätzlich Pausenprofile, Einstellungen, Aus Plan entfernen, Export', icon: UserCog },
    { role: 'personalleitung', label: 'Personalleitung', desc: 'Wochenplan hochladen, Archiv, Soll/Ist-Abgleich, Export für PEPZeit', icon: Briefcase },
  ];

  return (
    <div className="flex min-h-full items-center justify-center bg-stone-50 p-4 text-stone-900">
      <div className="w-full max-w-md rounded-2xl border-t-8 border-accent-500 bg-white p-6 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <BrandLogo className="h-14 w-14" />
          <div>
            <h1 className="text-2xl font-bold">{appName(brandName)}</h1>
            <p className="text-sm text-stone-500">Pausenplanung für die Filiale</p>
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
