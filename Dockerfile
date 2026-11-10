FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY public ./public
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "server.js"]
