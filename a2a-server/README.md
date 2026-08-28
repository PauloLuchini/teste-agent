# tester — servidor A2A

Expõe o subagente `tester` (definido em `.claude/agents/tester.md`) como um
agente externo, chamável por outros agentes via o protocolo
[A2A (Agent2Agent)](https://a2a-protocol.org/), usando JSON-RPC 2.0 sobre HTTP.

## As três informações do agente externo

Depois de rodar o servidor (veja abaixo), este agente é identificado por:

1. **URL do agente**
   - Agent Card (descoberta): `{AGENT_BASE_URL}/.well-known/agent-card.json`
   - Endpoint JSON-RPC (chamadas): `{AGENT_BASE_URL}/a2a`
   - `AGENT_BASE_URL` é o que você define no `.env` — em local costuma ser
     `http://localhost:41241`; em produção, a URL pública onde você hospedar
     este servidor (ex.: atrás de um domínio HTTPS).

2. **Versão do protocolo suportada**
   - `protocolVersion: "0.2.5"` (ver `src/agentCard.js`), reportada dentro do
     Agent Card. Confirme contra a especificação vigente antes de integrar em
     produção, pois o A2A ainda evolui:
     https://a2a-protocol.org/latest/specification/

3. **Credenciais de autenticação**
   - Esquema: HTTP Bearer token (`securitySchemes.bearerAuth` no Agent Card).
   - O(s) token(s) válido(s) são definidos por você em `A2A_BEARER_TOKENS`
     (uma ou mais chaves separadas por vírgula) — gere um com, por exemplo,
     `openssl rand -hex 32`.
   - Cada chamada ao endpoint `/a2a` deve enviar
     `Authorization: Bearer <token>`.
   - Sem `A2A_BEARER_TOKENS` configurado, o servidor recusa todas as
     chamadas (fail-closed) — ele expõe Bash e acesso a arquivos, então
     nunca deve ficar acessível sem autenticação.

## Rodando localmente

```bash
cd a2a-server
cp .env.example .env
# edite .env: ANTHROPIC_API_KEY e A2A_BEARER_TOKENS pelo menos
npm install
npm start
```

O servidor sobe em `http://localhost:41241` (ou na porta que você definir).

## Testando

Agent Card (não exige autenticação, é metadado público de descoberta):

```bash
curl http://localhost:41241/.well-known/agent-card.json
```

Enviar uma mensagem ao agente (`message/send`):

```bash
curl -X POST http://localhost:41241/a2a \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "message/send",
    "params": {
      "message": {
        "role": "user",
        "messageId": "msg-1",
        "parts": [{ "kind": "text", "text": "Liste os arquivos do workspace e diga se há testes." }]
      }
    }
  }'
```

Consultar o estado de uma task (`tasks/get`):

```bash
curl -X POST http://localhost:41241/a2a \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"2","method":"tasks/get","params":{"id":"<task-id>"}}'
```

## O que o agente pode fazer

O agente executa com as mesmas ferramentas do subagente `tester` original:
`Read`, `Write`, `Edit`, `Glob`, `Grep` e `Bash`, restritas ao diretório
definido em `WORKSPACE_DIR` (por padrão, a raiz deste repositório). Ele usa a
API da Anthropic (`ANTHROPIC_API_KEY`, modelo em `ANTHROPIC_MODEL`) para
raciocinar e decidir quais ferramentas chamar.

## Segurança — leia antes de expor publicamente

- Este agente pode **executar comandos de shell** (`Bash`) no workspace
  configurado. Trate o token Bearer como uma credencial de alto privilégio.
- Nunca rode sem `A2A_BEARER_TOKENS` definido, nunca reutilize o token de
  exemplo do `.env.example`, e prefira colocar o servidor atrás de HTTPS
  (proxy reverso/load balancer) antes de expô-lo fora da rede local.
- `WORKSPACE_DIR` limita os caminhos que `Read`/`Write`/`Edit`/`Glob`/`Grep`
  podem tocar; `Bash`, porém, roda com `cwd` nesse diretório mas **não**
  sandboxa o comando em si — não exponha este servidor a chamadores que você
  não confia.

## Streaming e notificações push

Este servidor implementa o transporte JSON-RPC síncrono (`message/send`,
`tasks/get`, `tasks/cancel`). `message/stream` (SSE) e push notifications
não estão implementados — o Agent Card anuncia
`capabilities.streaming: false` e `pushNotifications: false` de acordo.
