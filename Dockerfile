# Single container: builds the React app, then serves it and the API from one Node process.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 8787
VOLUME /data
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/index.js"]
