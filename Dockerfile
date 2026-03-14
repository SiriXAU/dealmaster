FROM node:22-alpine

RUN apk add --no-cache python3 py3-pip && \
    pip3 install --no-cache-dir --break-system-packages apprise

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

VOLUME ["/data"]

CMD ["node", "index.js"]
