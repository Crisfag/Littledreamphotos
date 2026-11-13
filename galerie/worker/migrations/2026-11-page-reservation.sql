-- Page de réservation seule (reserver.html) : un studio peut proposer ses
-- créneaux sans mini-site (lien à partager, bouton ou agenda intégré à son
-- propre site), et choisir de les afficher ou non sur son mini-site.
--   booking_page    : 1 = la page de réservation seule est ouverte
--   booking_on_site : 1 = la réservation s'affiche sur le mini-site publié
-- Un studio sans mini-site reçoit une ligne portfolios non publiée, pour son
-- adresse (handle) : ?s=<handle>.
ALTER TABLE portfolios ADD COLUMN booking_page INTEGER NOT NULL DEFAULT 0;
ALTER TABLE portfolios ADD COLUMN booking_on_site INTEGER NOT NULL DEFAULT 1;
