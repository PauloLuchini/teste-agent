# Imagem do servidor A2A do agente "tester".
#
# IMPORTANTE: o contexto de build é a RAIZ do repositório (não a2a-server/),
# porque a imagem também precisa do system prompt em .claude/agents/tester.md.
# Build:
#   podman build -f a2a-server/Dockerfile -t tester-a2a .
#   (a partir da raiz do repositório)

FROM node:22-slim AS deps
WORKDIR /app/a2a-server
COPY a2a-server/package.json a2a-server/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim

# grep é usado pela ferramenta Grep do agente.
RUN apt-get update \
    && apt-get install -y --no-install-recommends grep \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/a2a-server
COPY --from=deps /app/a2a-server/node_modules ./node_modules
COPY a2a-server/package.json a2a-server/package-lock.json ./
COPY a2a-server/src ./src

# .claude/agents/tester.md fica um nível acima de a2a-server/ no repositório
# real — mantemos o mesmo layout relativo dentro da imagem (/app/.claude).
COPY .claude /app/.claude

# Diretório que o agente lê/escreve/roda comandos (WORKSPACE_DIR).
# Vazio por padrão: monte o repositório-alvo aqui em tempo de execução, ex.:
#   podman run -v "$(pwd)":/workspace:Z ...
RUN mkdir -p /workspace && chown -R node:node /workspace /app

ENV NODE_ENV=production \
    WORKSPACE_DIR=/workspace \
    PORT=41241

EXPOSE 41241

# Executa como usuário sem privilégios — o processo ainda roda Bash a
# pedido do agente, então nunca rode isso como root em produção.
USER node

CMD ["node", "src/server.js"]
