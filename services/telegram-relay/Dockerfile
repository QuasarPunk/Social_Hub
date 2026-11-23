FROM node:22-alpine
WORKDIR /app
COPY server.cjs callbacks.cjs ./
RUN mkdir -p /data/records && chown node:node /data/records
USER node
CMD ["node", "server.cjs"]
