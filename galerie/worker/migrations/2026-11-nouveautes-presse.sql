-- Nouveautés : annonce de la salle de presse (onglet « Salle de presse »).
-- Publiée maintenant : la pastille s'affiche chez chaque photographe jusqu'à ce qu'il l'ait vue.
-- Sans effet si elle a déjà été publiée.
INSERT OR IGNORE INTO changelog (id, published_at, kind, title_fr, body_fr, title_en, body_en, title_nl, body_nl, link, feedback_id, credit, created_at, updated_at)
VALUES (
  'chg_salle_de_presse',
  CAST(strftime('%s', 'now') AS INTEGER),
  'feature',
  'Salle de presse pour vos événements',
  'Concert, festival, conférence : partagez les photos avec le commanditaire, l''artiste, les médias et les sponsors, chacun avec son lien et sa licence. Validation photo par photo, embargo à l''heure, et votre crédit inscrit dans chaque fichier téléchargé.',
  'Press room for your events',
  'Concert, festival, conference: share the photos with the client, the artist, the media and sponsors, each with their own link and licence. Photo-by-photo approval, embargo to the minute, and your credit written into every downloaded file.',
  'Perskamer voor je evenementen',
  'Concert, festival, conferentie: deel de foto''s met de opdrachtgever, de artiest, de media en sponsors, elk met een eigen link en licentie. Foto per foto goedkeuren, embargo tot op de minuut, en jouw vermelding in elk gedownload bestand.',
  '#/presse',
  '',
  0,
  CAST(strftime('%s', 'now') AS INTEGER),
  CAST(strftime('%s', 'now') AS INTEGER)
);
