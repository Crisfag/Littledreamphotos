-- Nouveautés : annonce de la section elle-même (onglet « Nouveautés & suggestions »).
-- Publiée maintenant : la pastille s'affiche chez chaque photographe jusqu'à ce qu'il l'ait vue.
-- Sans effet si elle a déjà été publiée.
INSERT OR IGNORE INTO changelog (id, published_at, kind, title_fr, body_fr, title_en, body_en, title_nl, body_nl, link, feedback_id, credit, created_at, updated_at)
VALUES (
  'chg_nouveautes_annonce',
  CAST(strftime('%s', 'now') AS INTEGER),
  'feature',
  'Les nouveautés, en un coup d''œil',
  'L''onglet devient « Nouveautés & suggestions » : en haut, tout ce qui vient d''être ajouté sur Holypixx, daté, avec un bouton pour l''essayer. Une pastille vous prévient quand il y a du neuf, et quand c''est votre idée qui est réalisée, vous le voyez ici.',
  'What''s new, at a glance',
  'The tab is now “News & suggestions”: at the top, everything just added to Holypixx, dated, with a button to try it. A badge lets you know when there''s something new, and when your idea gets built, you''ll see it here.',
  'Nieuwigheden in één oogopslag',
  'Het tabblad heet nu „Nieuw & suggesties”: bovenaan alles wat net aan Holypixx is toegevoegd, met datum en een knop om het uit te proberen. Een badge laat je weten wanneer er iets nieuws is, en wanneer jouw idee gerealiseerd is, zie je het hier.',
  '#/suggestions',
  '',
  0,
  CAST(strftime('%s', 'now') AS INTEGER),
  CAST(strftime('%s', 'now') AS INTEGER)
);
