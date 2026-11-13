-- Suggestions des photographes (feedback.js) : une idée, une amélioration,
-- un souci, envoyés depuis l'onglet « Suggestions » de l'espace
-- photographe ; le propriétaire de la plateforme les lit, change leur statut
-- et répond depuis l'onglet Admin. Le photographe suit ses demandes.
--   kind   : idea | improvement | problem | other
--   status : new | considering | planned | done | declined
CREATE TABLE IF NOT EXISTS feedback (
  id              TEXT PRIMARY KEY,
  photographer_id TEXT NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL DEFAULT 'idea',
  title           TEXT NOT NULL,
  body            TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'new',
  reply           TEXT NOT NULL DEFAULT '',
  replied_at      INTEGER,
  reply_seen      INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_photographer ON feedback(photographer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at);
