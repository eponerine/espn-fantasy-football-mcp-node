FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production MCP_TRANSPORT=streamable-http MCP_HOST=0.0.0.0 MCP_PORT=3001
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node src ./src
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MCP_PORT||3001)+'/healthz').then(response=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]