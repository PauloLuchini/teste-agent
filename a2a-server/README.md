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

## Importando no IBM watsonx Orchestrate

O watsonx Orchestrate consegue registrar este agente como um "external
agent" A2A, mas **só via ADK (linha de comando)** — o assistente de import
da UI não cobre agentes A2A.

1. **Hospede o servidor publicamente.** watsonx Orchestrate precisa alcançar
   `api_url` por HTTPS — `localhost` só funciona se o Orchestrate rodar na
   mesma máquina/rede (ex.: Developer Edition local). Para produção, suba
   este servidor em algo como IBM Code Engine, Cloud Run, um container
   atrás de um domínio com TLS, etc.

2. **Instale o ADK e conecte ao seu ambiente:**

   ```bash
   pip install --upgrade ibm-watsonx-orchestrate
   orchestrate env add -n meu-ambiente -u <URL_DA_SUA_INSTANCIA_ORCHESTRATE>
   orchestrate env activate meu-ambiente
   ```

3. **Edite `watsonx-orchestrate/tester_a2a_agent.yaml`** com a URL pública
   do seu `/a2a` e o token Bearer (o mesmo de `A2A_BEARER_TOKENS`).

4. **Importe o agente:**

   ```bash
   orchestrate agents import -f watsonx-orchestrate/tester_a2a_agent.yaml
   ```

5. Confirme com `orchestrate agents list` e adicione o `tester` a um
   assistant/time pela UI do Orchestrate.

Pontos importantes confirmados na documentação oficial:
- O campo `provider` precisa ser exatamente `external_chat/A2A/0.3.0` — o
  Orchestrate versiona o protocolo A2A nesse campo, e versões antigas (ex.:
  0.2.1) estão deprecadas. Por isso `A2A_PROTOCOL_VERSION` em
  `src/agentCard.js` está fixada em `0.3.0`.
- `auth_scheme` aceita `BEARER_TOKEN`, `API_KEY` ou `NONE` — usamos
  `BEARER_TOKEN`, compatível com o `securitySchemes.bearerAuth` do nosso
  Agent Card.

Referências:
- [Orchestrating external agents using A2A standard on watsonx Orchestrate (IBM Developer)](https://developer.ibm.com/tutorials/orchestrate-agents-a2a-standard/)
- [Integrating Agents in watsonx Orchestrate via A2A — Niklas Heidloff](https://heidloff.net/article/a2a-watsonx-orchestrate/)
- [connect agent — watsonx Orchestrate developer docs](https://developer.watson-orchestrate.ibm.com/_releases/1.15.0/agents/connect_agent)
- [IBM/ibm-watsonx-orchestrate-adk (GitHub)](https://github.com/IBM/ibm-watsonx-orchestrate-adk)

Não consegui abrir essas páginas diretamente neste ambiente (proxy de rede
bloqueou o fetch), então os nomes exatos dos comandos `orchestrate env
add/activate` e possíveis flags adicionais vieram de buscas/resumos, não de
leitura completa da doc — confira a página oficial antes de rodar em
produção, os detalhes finos podem variar por versão do ADK.

## Streaming e notificações push

Este servidor implementa o transporte JSON-RPC síncrono (`message/send`,
`tasks/get`, `tasks/cancel`). `message/stream` (SSE) e push notifications
não estão implementados — o Agent Card anuncia
`capabilities.streaming: false` e `pushNotifications: false` de acordo.
