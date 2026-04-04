FROM node:20-alpine

WORKDIR /app
COPY ./src/package*.json ./
RUN npm install --production
COPY ./src .

EXPOSE 80
CMD [ "node", "server.js" ]
