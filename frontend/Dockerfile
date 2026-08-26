# ── Build stage ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
ARG VITE_AUTH_API_URL=/api/auth
ARG VITE_TASK_API_URL=/api/tasks
ENV VITE_AUTH_API_URL=$VITE_AUTH_API_URL
ENV VITE_TASK_API_URL=$VITE_TASK_API_URL
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

# ── Runtime stage ────────────────────────────────────────────────────────
FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -qO- http://localhost:8080/healthz || exit 1
CMD ["nginx", "-g", "daemon off;"]
