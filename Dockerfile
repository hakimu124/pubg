FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates \
  && python3 -m pip install --no-cache-dir --break-system-packages yt-dlp \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

ENV NODE_ENV=production
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
EXPOSE 8787
CMD ["node", "server.js"]
