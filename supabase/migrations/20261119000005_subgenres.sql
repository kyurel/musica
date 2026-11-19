-- Subgenres: a starting list under the 12 top-level genres, mostly following Beatport's
-- names, with typical BPM ranges (used for halve/double hints and genre suggestions).
-- Members can add or rename subgenres in the app later; this only fills in what is
-- missing, so it never overwrites an edit.

insert into public.genres (slug, name, parent_id, bpm_min, bpm_max, sort)
select s.slug, s.name, p.id, s.bpm_min, s.bpm_max, s.sort
from (values
  ('techno',            'techno-peak-time',        'Peak Time / Driving',        128, 140, 1),
  ('techno',            'techno-raw-hypnotic',     'Raw / Deep / Hypnotic',      125, 138, 2),
  ('techno',            'hard-techno',             'Hard Techno',                140, 160, 3),
  ('techno',            'industrial-techno',       'Industrial',                 130, 150, 4),
  ('techno',            'melodic-techno',          'Melodic Techno',             120, 130, 5),
  ('techno',            'minimal-techno',          'Minimal',                    124, 132, 6),
  ('techno',            'schranz',                 'Schranz',                    145, 160, 7),

  ('psytrance',         'full-on',                 'Full-On',                    140, 148, 1),
  ('psytrance',         'progressive-psy',         'Progressive Psy',            134, 142, 2),
  ('psytrance',         'psychedelic',             'Psychedelic',                140, 148, 3),
  ('psytrance',         'dark-forest',             'Dark & Forest',              145, 170, 4),
  ('psytrance',         'goa',                     'Goa',                        135, 148, 5),
  ('psytrance',         'hi-tech',                 'Hi-Tech / Psycore',          170, 200, 6),

  ('tekno',             'hardtek',                 'Hardtek',                    160, 180, 1),
  ('tekno',             'tribe',                   'Tribe',                      170, 185, 2),

  ('house',             'tech-house',              'Tech House',                 124, 130, 1),
  ('house',             'deep-house',              'Deep House',                 118, 125, 2),
  ('house',             'progressive-house',       'Progressive House',          120, 128, 3),
  ('house',             'minimal-deep-tech',       'Minimal / Deep Tech',        122, 128, 4),
  ('house',             'melodic-house',           'Melodic House',              118, 126, 5),
  ('house',             'afro-house',              'Afro House',                 118, 124, 6),

  ('trance',            'trance-main-floor',       'Main Floor',                 134, 140, 1),
  ('trance',            'trance-raw-hypnotic',     'Raw / Deep / Hypnotic',      130, 140, 2),
  ('trance',            'hard-trance',             'Hard Trance',                140, 150, 3),

  ('hard-dance',        'hardstyle',               'Hardstyle',                  150, 160, 1),
  ('hard-dance',        'rawstyle',                'Rawstyle',                   150, 160, 2),
  ('hard-dance',        'hardcore',                'Hardcore',                   160, 200, 3),
  ('hard-dance',        'frenchcore',              'Frenchcore',                 190, 210, 4),
  ('hard-dance',        'uk-hardcore',             'UK Hardcore',                165, 175, 5),

  ('breaks',            'breakbeat',               'Breakbeat',                  125, 140, 1),
  ('breaks',            'uk-bass',                 'UK Bass',                    130, 140, 2),
  ('breaks',            'electro',                 'Electro',                    120, 135, 3),

  ('drum-and-bass',     'liquid',                  'Liquid',                     170, 176, 1),
  ('drum-and-bass',     'neurofunk',               'Neurofunk',                  170, 178, 2),
  ('drum-and-bass',     'jump-up',                 'Jump Up',                    170, 178, 3),
  ('drum-and-bass',     'jungle',                  'Jungle',                     160, 175, 4),

  ('ambient-downtempo', 'ambient',                 'Ambient',                     60, 110, 1),
  ('ambient-downtempo', 'downtempo',               'Downtempo',                   85, 115, 2),
  ('ambient-downtempo', 'experimental',            'Experimental',              null, null, 3)
) as s(parent, slug, name, bpm_min, bpm_max, sort)
join public.genres p on p.slug = s.parent and p.parent_id is null
on conflict (slug) do nothing;
