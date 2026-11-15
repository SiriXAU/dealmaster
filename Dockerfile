FROM node:22-alpine

RUN apk add --no-cache python3 py3-pip su-exec && \
    pip3 install --no-cache-dir --break-system-packages apprise

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /data && chown node:node /data && chmod +x /app/docker-entrypoint.sh

VOLUME ["/data"]

EXPOSE 8080

HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/health').then(r=>r.json()).then(j=>{if(!j.healthy)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "index.js"]
