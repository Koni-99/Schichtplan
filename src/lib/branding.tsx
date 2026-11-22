import { useEffect, useState } from 'react';
import { useDB } from '../store/db';

export const BRAND_PRESETS = [
  { name: 'Braun', color: '#6b4226' },
  { name: 'Kruste', color: '#8a3b12' },
  { name: 'Roggen', color: '#5b3a29' },
  { name: 'Weizengold', color: '#a16207' },
  { name: 'Bordeaux', color: '#881337' },
  { name: 'Waldgrün', color: '#166534' },
  { name: 'Marine', color: '#1e3a8a' },
];

export const ACCENT_PRESETS = [
  { name: 'Goldgelb', color: '#e8a90c' },
  { name: 'Honig', color: '#d97706' },
  { name: 'Weizen', color: '#d4b26a' },
  { name: 'Creme', color: '#e9d8b4' },
];

export const appName = (name: string | null | undefined) => name?.trim() || 'Pausenplaner';

/** Firmenfarbe, Titel und Browser-Farbe aus den Einstellungen anwenden. */
export function useApplyBranding() {
  const color = useDB((s) => s.settings.brand_color);
  const accent = useDB((s) => s.settings.brand_accent);
  const name = useDB((s) => s.settings.brand_name);
  useEffect(() => {
    const hex = (v: string | null | undefined, d: string) => (/^#[0-9a-f]{6}$/i.test(v ?? '') ? v! : d);
    const c = hex(color, '#6b4226');
    document.documentElement.style.setProperty('--brand', c);
    document.documentElement.style.setProperty('--accent', hex(accent, '#e8a90c'));
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', c);
    document.title = name?.trim() ? `Pausenplan · ${name.trim()}` : 'Pausenplaner';
  }, [color, accent, name]);
}

export function BrandLogo({ className = 'h-9 w-9' }: { className?: string }) {
  const logo = useDB((s) => s.settings.brand_logo);
  return logo ? (
    <img src={logo} alt="" className={`${className} rounded-lg object-contain`} />
  ) : (
    <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className={className} />
  );
}

/** Logo verkleinern (max. 256 px) und als Data-URL speichern – bleibt klein genug für den Sync. */
export async function logoToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Bild konnte nicht gelesen werden'));
      i.src = url;
    });
    const scale = Math.min(1, 256 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ------------------------------------------------------------------ Schriftgröße pro Gerät
export type SizeMode = 'normal' | 'gross' | 'sehr-gross';
const SIZE_KEY = 'pausenplaner-size';
export const SIZE_LABEL: Record<SizeMode, string> = { normal: 'Normal', gross: 'Groß', 'sehr-gross': 'Sehr groß' };

function readSize(): SizeMode {
  try {
    const v = localStorage.getItem(SIZE_KEY);
    return v === 'gross' || v === 'sehr-gross' ? v : 'normal';
  } catch {
    return 'normal';
  }
}

export function useSizeMode(): [SizeMode, () => void] {
  const [mode, setMode] = useState<SizeMode>(readSize);
  useEffect(() => {
    document.documentElement.dataset.size = mode;
    try { localStorage.setItem(SIZE_KEY, mode); } catch { /* egal */ }
  }, [mode]);
  const cycle = () => setMode((m) => (m === 'normal' ? 'gross' : m === 'gross' ? 'sehr-gross' : 'normal'));
  return [mode, cycle];
}
