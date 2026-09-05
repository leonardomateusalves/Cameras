# ==============================================================================
# 🚀 DOCKERFILE - NEXUS RTSP MONITOR BACKEND (Google Cloud Run)
# ==============================================================================
# Base: Node.js 20 em Alpine Linux com FFmpeg nativo
# Leve (~120MB), arranque instantâneo, consumo de RAM reduzido (<60MB)
# ==============================================================================

FROM node:20-alpine

# Instala FFmpeg e dependências de sistema essenciais
RUN apk add --no-cache \
    ffmpeg \
    bash \
    ca-certificates \
    tzdata

# Diretório de trabalho padrão
WORKDIR /app

# Copia arquivos de definição de dependências
COPY package*.json ./

# Instala dependências de produção
RUN npm install --only=production --ignore-scripts

# Copia o código-fonte e arquivo de configuração
COPY server.js config.json ./

# Configurações de ambiente otimizadas para Google Cloud Run
ENV NODE_ENV=production
ENV PORT=8080
ENV STREAMS_DIR=/tmp/streams

# Cria a pasta temporária para HLS na RAM (tmpfs) e ajusta permissões para o usuário node
RUN mkdir -p /tmp/streams && chown -R node:node /tmp/streams /app

# Execução como usuário não-root (boa prática de segurança para Cloud Run)
USER node

# Porta padrão exposta pelo Cloud Run
EXPOSE 8080

# Inicia o servidor backend
CMD ["node", "server.js"]
