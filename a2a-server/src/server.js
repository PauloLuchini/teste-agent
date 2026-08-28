import express from "express";
import { config } from "./config.js";
import { buildAgentCard } from "./agentCard.js";
import { requireBearerAuth } from "./auth.js";
import { handleJsonRpc } from "./rpc.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

// Agent Card: metadados públicos de descoberta do protocolo A2A.
app.get("/.well-known/agent-card.json", (req, res) => {
  res.json(buildAgentCard());
});

// Compatibilidade com o caminho usado por versões anteriores da spec.
app.get("/.well-known/agent.json", (req, res) => {
  res.json(buildAgentCard());
});

app.get("/", (req, res) => {
  res.json({
    agent: "tester",
    protocol: "A2A",
    agentCard: "/.well-known/agent-card.json",
    rpcEndpoint: "/a2a",
  });
});

app.get("/healthz", (req, res) => res.json({ ok: true }));

// Endpoint JSON-RPC 2.0 do A2A — autenticado via Bearer token.
app.post("/a2a", requireBearerAuth, async (req, res) => {
  const result = await handleJsonRpc(req.body);
  res.json(result);
});

app.listen(config.port, () => {
  console.log(`[a2a] agente "tester" ouvindo em ${config.baseUrl}`);
  console.log(`[a2a] agent card: ${config.baseUrl}/.well-known/agent-card.json`);
  console.log(`[a2a] endpoint json-rpc: ${config.baseUrl}/a2a`);
  if (config.bearerTokens.length === 0) {
    console.warn("[a2a] AVISO: nenhum A2A_BEARER_TOKENS configurado — chamadas serão rejeitadas.");
  }
  if (!config.anthropicApiKey) {
    console.warn("[a2a] AVISO: ANTHROPIC_API_KEY ausente — o agente falhará ao processar mensagens.");
  }
});
