FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "src/server.mjs"]
