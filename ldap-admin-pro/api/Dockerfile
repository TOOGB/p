# Dockerfile pour l'API Node.js
FROM node:18-alpine

# Installation des dépendances système
RUN apk add --no-cache \
    openldap-clients \
    curl \
    bash

# Création du répertoire de travail
WORKDIR /usr/src/app

# Copie des fichiers de configuration
COPY package*.json ./

# Installation des dépendances
RUN npm ci --only=production && \
    npm cache clean --force

# Copie du code source
COPY . .

# Création d'un utilisateur non-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /usr/src/app

# Utilisation de l'utilisateur non-root
USER nodejs

# Exposition du port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Commande de démarrage
CMD ["node", "server.js"]