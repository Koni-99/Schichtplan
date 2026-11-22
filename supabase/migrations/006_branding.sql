-- =====================================================================
-- Darstellung: Name, Logo und Firmenfarbe der Bäckerei (Einstellungen)
-- =====================================================================
alter table public.settings
  add column if not exists brand_name  text not null default '',
  add column if not exists brand_logo  text,                      -- PNG als Data-URL, max. 256 px
  add column if not exists brand_color text not null default '#8a3b12';

alter table public.settings drop constraint if exists settings_brand_color_hex;
alter table public.settings add constraint settings_brand_color_hex check (brand_color ~* '^#[0-9a-f]{6}$');
alter table public.settings drop constraint if exists settings_brand_logo_size;
alter table public.settings add constraint settings_brand_logo_size check (brand_logo is null or length(brand_logo) < 400000);
