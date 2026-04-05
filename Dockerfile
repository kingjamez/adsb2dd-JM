FROM node:20-alpine

WORKDIR /app
COPY ./src/package*.json ./
RUN npm install --production
COPY ./src .

ENV PORT=3000
EXPOSE 3000
CMD [ "node", "server.js" ]
