FROM node:22-alpine
WORKDIR /app
COPY server.cjs callbacks.cjs editorial.cjs intake.cjs ./
RUN mkdir -p /data/records /data/incoming && chown node:node /data/records /data/incoming
USER node
CMD ["node", "server.cjs"]
