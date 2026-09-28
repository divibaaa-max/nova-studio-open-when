FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
ENV DATA_DIR=/app/storage/data
ENV UPLOAD_DIR=/app/storage/uploads
EXPOSE 3000
CMD ["npm","start"]
