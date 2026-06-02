FROM node:20-alpine

RUN apk add --no-cache curl bash

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

RUN chmod -R 755 ./assets

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD [ "node", "index.js" ]
