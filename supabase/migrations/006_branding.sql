-- =====================================================================
-- Darstellung: Name, Logo, Haupt- und Akzentfarbe der Bäckerei (Einstellungen)
-- Standard: Braun (Knöpfe, Überschriften) und Goldgelb (Markierungen)
-- =====================================================================
alter table public.settings
  add column if not exists brand_name   text not null default '',
  add column if not exists brand_logo   text,                      -- PNG als Data-URL, max. 256 px
  add column if not exists brand_color  text not null default '#6b4226',
  add column if not exists brand_accent text not null default '#e8a90c';

alter table public.settings drop constraint if exists settings_brand_color_hex;
alter table public.settings add constraint settings_brand_color_hex check (brand_color ~* '^#[0-9a-f]{6}$' and brand_accent ~* '^#[0-9a-f]{6}$');
alter table public.settings drop constraint if exists settings_brand_logo_size;
alter table public.settings add constraint settings_brand_logo_size check (brand_logo is null or length(brand_logo) < 400000);

-- Name der Bäckerei als Startwert (in der App unter Einstellungen → Darstellung änderbar)
update public.settings set brand_name = 'Bäckerei Hinkel' where id = 1 and brand_name = '';
