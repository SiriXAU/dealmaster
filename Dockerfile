FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

VOLUME ["/data"]

HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "try{const s=require('fs').statSync('/tmp/health');if(Date.now()-s.mtimeMs>600000)process.exit(1);}catch(e){process.exit(1);}"

CMD ["node", "index.js"]
