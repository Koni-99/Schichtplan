import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Role } from '../lib/types';

interface AuthState {
  ready: boolean;
  session: Session | null;
  role: Role | null;
  displayName: string;
  error: string | null;
}

const LOCAL_ROLE_KEY = 'pausenplaner-local-role';

export const useAuth = create<AuthState>(() => ({ ready: false, session: null, role: null, displayName: '', error: null }));

async function loadProfile(session: Session | null) {
  if (!session || !supabase) {
    useAuth.setState({ session: null, role: null, displayName: '', ready: true });
    return;
  }
  const { data, error } = await supabase.from('profiles').select('role, display_name').eq('id', session.user.id).maybeSingle();
  if (error || !data) {
    useAuth.setState({ session, role: null, ready: true, error: error?.message ?? 'Für dieses Konto ist keine Rolle hinterlegt (Tabelle profiles).' });
    return;
  }
  useAuth.setState({ session, role: data.role as Role, displayName: data.display_name || session.user.email || '', ready: true, error: null });
}

export async function initAuth() {
  if (!supabase) {
    const role = localStorage.getItem(LOCAL_ROLE_KEY) as Role | null;
    useAuth.setState({ ready: true, role, displayName: role ? 'Lokales Gerät' : '' });
    return;
  }
  const { data } = await supabase.auth.getSession();
  await loadProfile(data.session);
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user.id !== useAuth.getState().session?.user.id) loadProfile(session);
    else useAuth.setState({ session });
  });
}

export async function signIn(email: string, password: string): Promise<string | null> {
  if (!supabase) return 'Supabase ist nicht konfiguriert.';
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? (error.message === 'Invalid login credentials' ? 'E-Mail oder Passwort falsch.' : error.message) : null;
}

export async function signOut() {
  if (supabase) await supabase.auth.signOut();
  localStorage.removeItem(LOCAL_ROLE_KEY);
  useAuth.setState({ session: null, role: null });
}

/** Lokaler Demo-Modus: Rolle wird auf dem Gerät gespeichert. */
export function setLocalRole(role: Role) {
  localStorage.setItem(LOCAL_ROLE_KEY, role);
  useAuth.setState({ role, displayName: 'Lokales Gerät' });
}
