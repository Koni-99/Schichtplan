# Pausenplaner – Bäckerei-Filiale

Installierbare Web-App (PWA) zur digitalen Pausenplanung und -dokumentation. Ersetzt die Papierlisten an der Theke und liefert der Personalleitung fertige Soll/Ist-Berichte für die Nachbearbeitung in **PEPZeit**.

**Stack:** React 19 · TypeScript · Vite · Tailwind CSS 4 · Lucide · pdfjs-dist · Supabase (PostgreSQL, Realtime, Auth, pg_cron) · Workbox-Service-Worker · IndexedDB

## Funktionen

| Bereich | Inhalt |
|---|---|
| **PDF-Import** | PEPZeit-Wochen- oder Tagesplan hochladen (Wochentabelle, Abschnitt pro Tag oder Liste) → Vorschau pro Tag; abgeschlossene und laufende Tage bleiben unverändert, nur Tage ohne Plan werden angelegt. Einzel-Tag: PDF hochladen → Datum, Namen, Beginn/Ende werden erkannt → editierbare Vorschau → Plan + automatische Pausenverteilung. Warnt, wenn der Vortag noch offen ist (direkt abschließen möglich). |
| **Pausenregeln** | § 4 ArbZG: nie mehr als 6 Std. am Stück ohne Pause (Auto-Planung hält das ein, Warnung im Tagesplan und im Bericht). Standard 2 × 30 Min., Sondermodell (z. B. 2 × 15 / 1 × 30), feste Uhrzeiten, keine Pause. Kurzschicht < 6 Std. ohne Pause (einstellbar). Max. 4 gleichzeitig (einstellbar). Abstände 1,5 Std. / 1,5 Std. / 1 Std. (einstellbar). |
| **Auto-Planung** | Setzt zuerst feste Zeiten, lässt „Keine Pause“ aus, verteilt dann flexible Blöcke gleichmäßig. Engste Schichten werden zuerst geplant. Kapazität und Abstände werden eingehalten. Geht das nicht, wird schrittweise gelockert und gewarnt. Laufende und erledigte Pausen bleiben unangetastet. |
| **Tagesansicht** | Zeitstrahl mit „Jetzt“-Linie, Drag & Drop (5-Min.-Raster), ±15 Min., Uhrzeit wählen. Dazu eine Kompaktliste fürs Handy, der Kasten „Aktuell in Pause (3 / 4)“ mit Countdown, Soft-Warnings in Rot/Orange und „Rückgängig“ für die letzten 3 Aktionen. |
| **Schnellaktionen** | Anwesend / Krank (streicht offene Pausen) / Früher gegangen / Später gekommen / Nicht erschienen. Außerdem: Ist-Zeiten, Schicht tauschen, Springer hinzufügen („Manuell ergänzt“), Notiz pro Mitarbeiter. Die Filialleitung kann Mitarbeiter mit Pflicht-Grund „Aus Plan entfernen“; der Vermerk (Grund, Uhrzeit, Name) erscheint im Bericht der Personalleitung, Wiederherstellen ist möglich. |
| **Tagesabschluss** | Manuell per Button oder automatisch um 19:30 Uhr (pg_cron, einstellbar). Wird gekennzeichnet als „Automatisch abgeschlossen um 19:30 Uhr“. |
| **Personalleitung** | Banner „X neue Tagesberichte“ mit Hinweis auf Abweichungen. Archiv Jahr → Monat → KW → Tag mit Ungelesen-Badges. Soll/Ist-Diff (Arbeitszeit, Krank, Pause, Springer, Notizen). „Als bearbeitet markieren“. Export pro Tag oder KW als CSV/Excel und PDF. |
| **Offline** | Alle Daten liegen in IndexedDB. Änderungen landen in einer Outbox und werden nachgereicht, sobald wieder Netz da ist. Realtime-Abgleich über Supabase. Konflikte: der zuletzt geschriebene Stand gewinnt (über `updated_at`). |

## Projektstruktur

```
supabase/migrations/001_schema.sql         Tabellen, Enums, RLS, Rollen, Realtime
supabase/migrations/002_auto_close_cron.sql Auto-Abschluss (close_due_plans + pg_cron)
supabase/migrations/003_remove_from_plan.sql „Aus Plan entfernen“ mit Vermerk
supabase/migrations/004_hr_import.sql      Personalleitung lädt Pläne hoch (Rechte)
supabase/migrations/005_store_lead_no_import.sql Filialleitung legt keine Pläne an
src/features/week/WeekView.tsx Wochenplan (Mitarbeiter × Wochentage)
src/lib/branding.tsx      Firmenfarbe, Logo, Name, Schriftgröße pro Gerät
supabase/migrations/006_branding.sql Darstellung (Name, Logo, Farbe) in den Einstellungen
src/lib/scheduler.ts      Pausen-Verteilungsalgorithmus
src/lib/validation.ts     Soft-Warnings (Kapazität, Soll-Pause, Abstände)
src/lib/diff.ts           Soll/Ist-Abgleich
src/lib/pdfParser.ts      PEPZeit-PDF → Zeilen → Schichten
src/lib/export.ts         CSV (Excel-kompatibel) & PDF
src/store/db.ts           lokaler Store, IndexedDB, Outbox, Undo
src/store/sync.ts         Supabase-Sync (Push, Pull, Realtime, Offline-Retry)
src/store/actions.ts      Fachaktionen (Import, Pausen, Status, Tausch, Abschluss …)
src/features/*            Oberflächen (Tagesplan, Import, Mitarbeiter, Archiv, Einstellungen)
samples/                  Beispiel-PDF im PEPZeit-Stil zum Testen
```

## Setup

### 1. Supabase-Projekt & Tabellen
1. Auf [supabase.com](https://supabase.com) ein Projekt anlegen (Region EU, z. B. Frankfurt). Der kostenlose Plan reicht für eine Filiale. Er hat aber keine automatischen Backups, deshalb regelmäßig exportieren.
2. **Database → Extensions:** `pg_cron` aktivieren.
3. **SQL Editor:** nacheinander `supabase/migrations/001_schema.sql`, `002_auto_close_cron.sql`, `003_remove_from_plan.sql`, `004_hr_import.sql`, `005_store_lead_no_import.sql` und `006_branding.sql` ausführen.
   - Damit sind Tabellen, Rechte (RLS), Realtime und der Cron-Job `pausenplaner-auto-close` angelegt. Der Job läuft alle 5 Min. und schließt um die eingestellte Uhrzeit (Europe/Berlin) ab.
   - Prüfen: `select * from cron.job;`, testweise `select public.close_due_plans();`

### 2. Benutzer & Rollen
**Authentication → Users → Add user**: E-Mail und Passwort vergeben, „Auto Confirm“ aktivieren. Empfohlen sind drei Konten:

| Konto | Rolle | Zweck |
|---|---|---|
| `theke@…` | `filiale` | Filial-Tablet (bleibt dauerhaft angemeldet) |
| `leitung@…` | `filialleitung` | Pausenprofile, Einstellungen, „Aus Plan entfernen“, Archiv & Export |
| `personal@…` | `personalleitung` | Wochenplan hochladen, Archiv & PEPZeit-Abgleich (Tagespläne nur ansehen) |

Neue Konten bekommen automatisch die Rolle `filiale`. Danach die Rollen im SQL Editor setzen:
```sql
update public.profiles set role = 'filialleitung',   display_name = 'Filialleitung'   where id = (select id from auth.users where email = 'leitung@…');
update public.profiles set role = 'personalleitung', display_name = 'Personalleitung' where id = (select id from auth.users where email = 'personal@…');
```

### 3. `.env`
```bash
cp .env.example .env
# Werte aus Supabase → Project Settings → API eintragen:
VITE_SUPABASE_URL=https://<projekt>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```
Mit `VITE_BRAND_NAME` steht der Name der Bäckerei von Anfang an in der App. Später lässt er sich unter Einstellungen → Darstellung ändern, dort auch Logo, Hauptfarbe (Standard Braun) und Akzentfarbe (Standard Goldgelb).

Ohne `.env` startet die App im **lokalen Modus**: Die Rolle wählt man beim Start, alle Daten bleiben auf dem Gerät. Echtzeit-Sync gibt es dann nicht. Gut zum Ausprobieren.

### 4. Lokal starten & testen
```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Algorithmus- & Parser-Tests
npm run build      # Produktionsbuild nach dist/
```
Zum Ausprobieren `samples/pepzeit-beispiel-2026-11-23.pdf` im PDF-Import hochladen.

### 5. Deployen & als PWA installieren
- `dist/` auf einen HTTPS-Host legen. Kostenlos und für gewerbliche Nutzung erlaubt: **Cloudflare Pages** oder **Netlify**. Vercel ist im Gratis-Plan nur für nicht-kommerzielle Nutzung zugelassen. Build-Befehl `npm run build`, Ausgabeordner `dist`. Die Env-Variablen dort ebenfalls setzen.
- Ohne HTTPS gibt es keinen Service Worker. `localhost` ist die Ausnahme.
- **Tablet (Android/Chrome):** Seite öffnen → Menü → „App installieren“.
- **iPad/iPhone (Safari):** Teilen → „Zum Home-Bildschirm“.
- Filial-Tablet einmal mit dem `filiale`-Konto anmelden. Die Session bleibt danach dauerhaft bestehen.

## Hinweise zum PEPZeit-Parser
Der Parser liest den PDF-Text Zeile für Zeile. Er erkennt Zeilen wie `1012 Müller, Anna 05:30 - 14:00` und auch Varianten mit `–`, `bis`, `.` als Trenner, zwei einzelne Uhrzeiten oder den Namen in der Zeile davor. Personalnummern sowie Kopf- und Fußzeilen werden herausgefiltert. Wenn Ihr PEPZeit-Layout abweicht: In der Vorschau zeigt **„Erkannten PDF-Text anzeigen“** den Rohtext. Damit lässt sich `parseShiftText()` in `src/lib/pdfParser.ts` gezielt anpassen (Tests in `src/lib/__tests__/pdfParser.test.ts`).

## Datenmodell (Kurzfassung)
- Uhrzeiten innerhalb eines Tages werden als **Minuten seit Mitternacht** gespeichert (`510` = 08:30). Echte Zeitpunkte, z. B. Pausenstart per Timer, sind `timestamptz`.
- `employees`: Pausenprofil (`standard | flexible_custom | fixed | none`)
- `daily_plans`: `status`, `closed_type (manual|auto)`, `closed_label`, `is_read_by_hr`, `hr_processed`, `has_deviations`
- `shift_entries`: Soll-Zeiten (PEPZeit), Ist-Zeiten, Status, `planned_pause_min`, `actual_pause_min` (wird beim Abschluss festgeschrieben), `is_manual`, `note`
- `pause_blocks`: Block-Nr., geplante Startzeit, Soll-Dauer, Status (`open|running|done|cancelled`), Ist-Start/-Ende/-Dauer
- Gelöscht wird nur weich (`deleted_at`). Das hält die Offline-Synchronisation konsistent.
