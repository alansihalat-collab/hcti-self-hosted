FROM node:18-slim

# Install Chromium and font dependencies
RUN apt-get update && apt-get install -y \
  chromium \
  fonts-freefont-ttf \
  fonts-liberation \
  --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

# Tell puppeteer-core where to find Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
