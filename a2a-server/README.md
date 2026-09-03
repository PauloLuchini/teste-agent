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
   - `protocolVersion: "0.3.0"` (ver `src/agentCard.js`), reportada dentro do
     Agent Card. É a versão exigida pelo watsonx Orchestrate no momento
     (versões antigas como 0.2.1 estão deprecadas lá). Confirme contra a
     especificação vigente antes de integrar em produção, pois o A2A ainda
     evolui: https://a2a-protocol.org/latest/specification/

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

## Rodando com um modelo local (sem cobrança por token)

Por padrão o servidor usa a API da Anthropic (`MODEL_PROVIDER=anthropic`),
cobrada por token. Se você quer rodar o raciocínio do agente localmente,
sem depender de uma API paga, use o [Ollama](https://ollama.com/):

```bash
# instale o Ollama (https://ollama.com/download) e baixe um modelo
# com suporte a tool calling — obrigatório, o agente depende disso
# para chamar Read/Write/Edit/Glob/Grep/Bash:
ollama pull llama3.1
ollama serve   # se não estiver rodando como serviço já

# no .env do a2a-server:
# MODEL_PROVIDER=ollama
# OLLAMA_BASE_URL=http://localhost:11434
# OLLAMA_MODEL=llama3.1
```

`ANTHROPIC_API_KEY` deixa de ser necessário nesse modo. A troca de provider
é feita em `src/providers/` (`anthropic.js` e `ollama.js`), que expõem o
mesmo contrato `chat({ system, messages, tools })` para o `agentLoop.js` —
trocar de provider não muda o resto do servidor (autenticação, Agent Card,
endpoints A2A).

**Ressalvas:**
- **Isso muda onde a inferência roda, não onde o servidor precisa estar
  acessível.** O watsonx Orchestrate (SaaS na nuvem) ainda precisa alcançar
  o endpoint `/a2a` por HTTPS — rodar o modelo localmente não elimina a
  necessidade de hospedar/expor publicamente o servidor (veja a seção
  seguinte), **a menos que** você também rode o watsonx Orchestrate
  localmente (Developer Edition), caso em que `localhost` basta.
- **Qualidade de tool calling varia bastante entre modelos locais.** A API
  de function calling do Ollama é menos madura que a da Anthropic (por
  exemplo, não devolve um `id` por chamada de ferramenta — o servidor gera
  um internamente só para rastrear o turno). Modelos pequenos podem
  alucinar chamadas de ferramenta com mais frequência ou ignorar o
  `input_schema`; teste bem antes de confiar em produção.
- Rodando em container (seção abaixo), o Ollama do host não é alcançável
  em `localhost` de dentro do container — aponte `OLLAMA_BASE_URL` para
  `http://host.docker.internal:11434` (Docker Desktop) ou publique o
  Ollama na rede do container.

## Expondo o modelo local a um serviço externo (proxy autenticado)

Cenário diferente do agente A2A: aqui você quer que um serviço externo (ex.:
o watsonx Orchestrate, registrando um *custom provider* em `orchestrate
models add`) use o **modelo** local diretamente, não o agente.

O Ollama expõe uma API compatível com OpenAI em `/v1` — confirmado com:

```bash
curl http://localhost:11434/v1/models
# {"object":"list","data":[{"id":"llama3.1:latest",...}]}
```

**Nunca exponha a porta 11434 direto num túnel:** o Ollama não tem
autenticação nenhuma, então qualquer pessoa com a URL usaria sua máquina e
sua GPU à vontade — e as rotas nativas `/api/*` incluem operações
destrutivas (apagar modelo, baixar modelo arbitrário).

Use o proxy em `src/ollamaProxy.js`:

```bash
# no .env:
# OLLAMA_PROXY_PORT=11435
# OLLAMA_PROXY_TOKENS=$(openssl rand -hex 32)

npm run proxy
```

Ele exige `Authorization: Bearer <token>` e encaminha **apenas** `/v1/*`
para o Ollama; `/api/*` não passa (404). O túnel aponta para a porta do
proxy, não para a do Ollama:

```bash
cloudflared tunnel --url http://localhost:11435
```

Aí a base URL a registrar no serviço externo é `https://SUA-URL-DO-TUNEL/v1`,
com o token de `OLLAMA_PROXY_TOKENS` como API key.

Note que `OLLAMA_PROXY_TOKENS` é separado de `A2A_BEARER_TOKENS` de
propósito: são audiências diferentes (quem chama o agente vs. quem consome o
modelo), então revogar um não derruba o outro.

## Rodando em container (Podman ou Docker)

O `Dockerfile` fica em `a2a-server/`, mas o **contexto de build é a raiz do
repositório** — a imagem também precisa do system prompt em
`.claude/agents/tester.md`. Rode os comandos a partir da raiz do repo:

```bash
# build (troque podman por docker se preferir)
podman build -f a2a-server/Dockerfile -t tester-a2a .

# run — monte o projeto-ALVO (onde o agente vai ler/escrever/rodar testes)
# em /workspace; aqui usamos o próprio repo como exemplo
podman run --rm -p 41241:41241 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e A2A_BEARER_TOKENS=$(openssl rand -hex 32) \
  -e AGENT_BASE_URL=http://localhost:41241 \
  -v "$(pwd)":/workspace:Z \
  tester-a2a
```

Notas:
- `:Z` no `-v` é a flag do Podman para relabeling SELinux (comum em
  Fedora/RHEL); no Docker ou em distros sem SELinux, pode omitir.
- `WORKSPACE_DIR` já vem fixado em `/workspace` na imagem — é onde
  `Read`/`Write`/`Edit`/`Glob`/`Grep`/`Bash` vão operar. Monte ali o
  repositório em que você quer que o `tester` escreva/rode testes.
- **Isso ainda é local.** Um container rodando na sua máquina não tem uma
  URL alcançável pela internet — para o watsonx Orchestrate (que roda na
  nuvem) conseguir chamar este agente, ele precisa de um `api_url` público
  (deploy em Code Engine, um túnel tipo `ngrok`/Cloudflare Tunnel apontando
  para este container, etc.). Rodar local com Podman é ótimo para
  desenvolver/testar o agente antes disso, mas não substitui a hospedagem
  pública quando for de fato importar no Orchestrate.

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
