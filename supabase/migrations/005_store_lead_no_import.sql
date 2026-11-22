-- =====================================================================
-- Pläne erstellt ausschließlich die Personalleitung (PEPZeit-Wochen-PDF).
-- Die Filialleitung legt keine Tagespläne mehr an, sie exportiert Berichte
-- (Lesezugriff auf alle Pläne besteht weiterhin über plans_read).
-- =====================================================================
drop policy if exists plans_insert on public.daily_plans;
