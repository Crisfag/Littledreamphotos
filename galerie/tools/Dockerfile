# Image de l'interface d'administration (admin-server.mjs), pour l'héberger
# ailleurs que sur l'ordinateur du photographe.
#
#   docker build -t holypixx-admin .
#   docker run -p 4000:4000 \
#     -e GALERIE_API=https://galerie-protegee.votre-sous-domaine.workers.dev \
#     -e GALERIE_FORENSIC_KEY=... \
#     holypixx-admin
#
# node:22-slim (Debian, glibc) plutôt qu'Alpine : sharp fournit des binaires
# précompilés pour cette plateforme, pas besoin d'outils de compilation.
FROM node:22-slim

WORKDIR /app

# Polices pour le texte dessiné par sharp (filigrane, fiches parents du
# module scolaire) : l'image slim n'en contient aucune.
#
# jemalloc remplace l'allocateur de la glibc : avec sharp (libvips), ce
# dernier fragmente la mémoire envoi après envoi, jusqu'à frôler les 512 Mo
# d'une petite instance (constaté : 518 Mo sur 537 lors d'un long envoi,
# fichiers d'impression compris) ; c'est la recommandation de sharp sous
# Linux. Lien stable quelle que soit l'architecture.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-dejavu-core fontconfig libjemalloc2 \
 && ln -s "$(find /usr/lib -name libjemalloc.so.2 | head -n 1)" /usr/local/lib/libjemalloc.so.2 \
 && rm -rf /var/lib/apt/lists/*
ENV LD_PRELOAD=/usr/local/lib/libjemalloc.so.2

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY admin-server.mjs prepare.mjs detect.mjs signup.mjs ./
COPY lib ./lib
# Photos libres de droits de la galerie de démonstration (voir lib/demo.mjs).
COPY demo ./demo
COPY admin ./admin

# Sans hôte à l'écoute au-delà de la boucle locale, le service serait
# injoignable une fois dans un conteneur : la protection vient alors des
# comptes/sessions, plus de 127.0.0.1.
ENV GALERIE_ADMIN_HOST=0.0.0.0
ENV GALERIE_ADMIN_PORT=4000
EXPOSE 4000

CMD ["node", "admin-server.mjs"]
