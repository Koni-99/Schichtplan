import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { create } from 'zustand';
import { fmtMin, parseTime } from '../lib/time';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success' | 'warning';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-800 disabled:bg-stone-300',
  secondary: 'bg-white text-stone-800 border border-stone-300 hover:bg-stone-100 active:bg-stone-200 disabled:text-stone-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300',
  warning: 'bg-amber-500 text-stone-900 hover:bg-amber-400 disabled:bg-amber-200',
  ghost: 'bg-transparent text-stone-700 hover:bg-stone-200/70 active:bg-stone-200',
};

export function Button({ variant = 'secondary', size = 'md', className = '', icon, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode }) {
  const sz = size === 'lg' ? 'min-h-14 px-5 text-lg' : size === 'sm' ? 'min-h-10 px-3 text-sm' : 'min-h-12 px-4 text-base';
  return (
    <button type="button" className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed ${sz} ${VARIANTS[variant]} ${className}`} {...rest}>
      {icon}
      {children}
    </button>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl ${wide ? 'sm:max-w-4xl' : 'sm:max-w-lg'}`}>
        <div className="flex items-center justify-between gap-2 border-b border-stone-200 px-5 py-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="flex h-12 w-12 items-center justify-center rounded-xl hover:bg-stone-100" onClick={onClose} aria-label="Schließen">
            <X />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-stone-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Uhrzeit-Eingabe mit Klartext (HH:MM), große Touch-Fläche. */
export function TimeInput({ value, onChange, className = '', ...rest }: { value: number | null; onChange: (m: number | null) => void; className?: string; 'aria-label'?: string; placeholder?: string }) {
  const [text, setText] = useState(value == null ? '' : fmtMin(value));
  useEffect(() => setText(value == null ? '' : fmtMin(value)), [value]);
  const invalid = text.trim() !== '' && parseTime(text) === null;
  return (
    <input
      type="text"
      inputMode="numeric"
      className={`min-h-12 w-24 rounded-xl border px-3 text-center text-lg tabular-nums ${invalid ? 'border-red-500 bg-red-50' : 'border-stone-300'} ${className}`}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const m = text.trim() === '' ? null : parseTime(text);
        if (text.trim() === '' || m !== null) onChange(m);
        if (m !== null) setText(fmtMin(m));
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      placeholder={rest.placeholder ?? 'hh:mm'}
      aria-label={rest['aria-label']}
    />
  );
}

export function Badge({ children, tone = 'stone', className = '' }: { children: ReactNode; tone?: 'stone' | 'red' | 'amber' | 'green' | 'blue' | 'brand' | 'violet'; className?: string }) {
  const tones = {
    stone: 'bg-stone-100 text-stone-700',
    red: 'bg-red-100 text-red-800',
    amber: 'bg-amber-100 text-amber-900',
    green: 'bg-emerald-100 text-emerald-800',
    blue: 'bg-sky-100 text-sky-800',
    brand: 'bg-brand-100 text-brand-700',
    violet: 'bg-violet-100 text-violet-800',
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]} ${className}`}>{children}</span>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-stone-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

export const inputCls = 'min-h-12 w-full rounded-xl border border-stone-300 px-3 text-base focus:border-brand-500 focus:outline-none';

// ------------------------------------------------------------------ Toasts
interface Toast { id: number; text: string; tone: 'info' | 'error' | 'success'; action?: { label: string; run: () => void } }
export const useToasts = create<{ list: Toast[] }>(() => ({ list: [] }));
let tid = 0;
export function toast(text: string, tone: Toast['tone'] = 'info', action?: Toast['action']) {
  const id = ++tid;
  useToasts.setState((s) => ({ list: [...s.list.slice(-2), { id, text, tone, action }] }));
  setTimeout(() => useToasts.setState((s) => ({ list: s.list.filter((t) => t.id !== id) })), action ? 6000 : 3500);
}
export function Toasts() {
  const list = useToasts((s) => s.list);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4">
      {list.map((t) => (
        <div key={t.id} className={`pointer-events-auto flex items-center gap-3 rounded-xl px-4 py-3 text-white shadow-lg ${t.tone === 'error' ? 'bg-red-700' : t.tone === 'success' ? 'bg-emerald-700' : 'bg-stone-800'}`}>
          <span>{t.text}</span>
          {t.action && (
            <button className="min-h-10 rounded-lg bg-white/20 px-3 font-semibold" onClick={() => { t.action!.run(); useToasts.setState((s) => ({ list: s.list.filter((x) => x.id !== t.id) })); }}>
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function confirmDialog(text: string): boolean {
  return window.confirm(text);
}
