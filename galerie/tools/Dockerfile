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

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY admin-server.mjs prepare.mjs detect.mjs signup.mjs ./
COPY lib ./lib
COPY admin ./admin

# Sans hôte à l'écoute au-delà de la boucle locale, le service serait
# injoignable une fois dans un conteneur : la protection vient alors des
# comptes/sessions, plus de 127.0.0.1.
ENV GALERIE_ADMIN_HOST=0.0.0.0
ENV GALERIE_ADMIN_PORT=4000
EXPOSE 4000

CMD ["node", "admin-server.mjs"]
