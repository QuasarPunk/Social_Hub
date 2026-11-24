FROM node:22-alpine
WORKDIR /app
COPY server.cjs callbacks.cjs editorial.cjs intake.cjs capture.cjs ./
RUN mkdir -p /data/records /data/incoming /data/sessions && chown node:node /data/records /data/incoming /data/sessions
USER node
CMD ["node", "server.cjs"]
