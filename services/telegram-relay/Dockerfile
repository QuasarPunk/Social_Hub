FROM node:22-alpine
WORKDIR /app
COPY server.cjs callbacks.cjs editorial.cjs intake.cjs capture.cjs editorial-drafts.cjs editorial-provider.cjs editorial-preview.cjs ./
COPY editorial-prompts ./editorial-prompts
RUN mkdir -p /data/records /data/incoming /data/sessions /data/drafts && chown node:node /data/records /data/incoming /data/sessions /data/drafts
USER node
CMD ["node", "server.cjs"]
