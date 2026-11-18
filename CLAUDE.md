# Holypixx — consignes pour Claude

Le code du produit est dans `galerie/` (worker Cloudflare, site `web/`, espace photographe `tools/admin/`).

## Nouveautés : à chaque fonctionnalité livrée

Chaque fois qu'une fonctionnalité, une amélioration, un raccourci ou une correction visible
par les photographes est livrée, fournir dans le compte rendu final un bloc
« Texte pour les Nouveautés », prêt à coller dans le formulaire de l'onglet Admin
(Nouveautés de la plateforme) :

- **Type** : Nouveauté, Amélioration, Raccourci ou Correction.
- **Bouton « Essayer »** : l'écran concerné (`#/…`), ou Aucun.
- **Suggestion réalisée** : si la demande vient d'un photographe, le dire, pour utiliser
  « Annoncer dans les nouveautés » sur sa suggestion.
- **Titre et description en français, anglais et néerlandais** : un titre court, puis une
  ou deux phrases qui disent ce que ça change pour le photographe (pas de jargon technique),
  écriture neutre (pas de « il/elle »), néerlandais avec « je/jouw ».

## Façon de travailler

- Répondre en français.
- Ne fusionner (PR vers `main`) qu'après « fusionne » dans la conversation.
- Déploiement, depuis `galerie/worker` : `git pull`, puis les migrations nouvelles
  (`npx wrangler d1 execute galerie-protegee --remote --file=migrations/…`), puis
  `npm run deploy` ; ensuite Pages et Render. Une commande par bloc de code.
- Tout texte visible par les photographes existe en FR, EN et NL.
