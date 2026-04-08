# Dockerfile

FROM node:20-alpine

RUN apk add --no-cache curl bash

WORKDIR /usr/src/app

# install dotenv BEFORE everything
COPY package*.json ./
RUN npm install dotenv --save && npm ci --omit=dev --no-audit --no-fund

COPY . .

COPY .env .env

RUN chmod -R 755 ./assets

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD [ "node", "index.js" ]
