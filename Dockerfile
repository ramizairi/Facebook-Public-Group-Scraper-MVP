FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=pwuser:pwuser . .
RUN mkdir -p /app/output && chown -R pwuser:pwuser /app

USER pwuser

ENTRYPOINT ["node", "main.js"]
