# Spelserver voor wie hem zelf wil draaien (eigen server, NAS, ...).
# Bouwen vanuit de hoofdmap van de repo:
#   docker build -f server/Dockerfile -t muziek-tijdlijn-server .
# Starten:
#   docker run -d --restart unless-stopped -p 8787:8787 -v muziek-tijdlijn:/data muziek-tijdlijn-server
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server/src ./server/src
COPY server/node ./server/node
ENV PORT=8787 \
    TRACKS_URL=https://baaswietse.github.io/muziek-tijdlijn/tracks.json \
    ALLOWED_ORIGINS=https://baaswietse.github.io \
    DATA_FILE=/data/spellen.json
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8787
CMD ["node", "server/node/server.js"]
