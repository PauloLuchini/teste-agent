import express from "express";
import { Readable } from "node:stream";
import { config } from "./config.js";

const app = express();

/**
 * Autenticação Bearer do proxy.
 *
 * Usa OLLAMA_PROXY_TOKENS, separado de A2A_BEARER_TOKENS de propósito: são
 * audiências diferentes (quem chama o agente vs. quem consome o modelo),
 * então revogar um token não derruba o outro caminho.
 */
function requireProxyAuth(req, res, next) {
  if (config.ollamaProxyTokens.length === 0) {
    // Fail-closed: sem token configurado o proxy não serve ninguém, para
    // não virar um Ollama aberto na internet por descuido.
    return res.status(500).json({
      error: "Proxy sem OLLAMA_PROXY_TOKENS configurado — recusando por padrão.",
    });
  }

  const [scheme, token] = (req.get("authorization") ?? "").split(" ");

  if (scheme !== "Bearer" || !token || !config.ollamaProxyTokens.includes(token)) {
    return res.status(401).json({
      error: "Não autenticado: Bearer token ausente ou inválido.",
    });
  }

  next();
}

app.get("/healthz", (req, res) => res.json({ ok: true, upstream: config.ollamaBaseUrl }));

// Só a superfície compatível com OpenAI (/v1/*) é encaminhada. As rotas
// nativas /api/* ficam de fora de propósito: elas incluem operações
// destrutivas (apagar modelo, baixar modelo arbitrário) que ninguém do lado
// de fora precisa para fazer inferência.
//
// Sem express.json() aqui: o corpo é repassado como stream, para não
// reserializar o payload e para preservar respostas SSE (stream: true).
app.use("/v1", requireProxyAuth, async (req, res) => {
  const target = `${config.ollamaBaseUrl}${req.originalUrl}`;

  const init = {
    method: req.method,
    headers: { "content-type": req.get("content-type") ?? "application/json" },
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req;
    // Exigido pelo fetch do Node quando o corpo é um stream.
    init.duplex = "half";
  }

  let upstream;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    return res.status(502).json({
      error:
        `Não foi possível alcançar o Ollama em ${config.ollamaBaseUrl} (${err.message}). ` +
        "Confirme que ele está rodando (`ollama serve`).",
    });
  }

  res.status(upstream.status);
  const contentType = upstream.headers.get("content-type");
  if (contentType) res.set("content-type", contentType);

  if (!upstream.body) return res.end();

  Readable.fromWeb(upstream.body).pipe(res);
});

app.listen(config.ollamaProxyPort, () => {
  console.log(`[ollama-proxy] ouvindo em http://localhost:${config.ollamaProxyPort}`);
  console.log(`[ollama-proxy] encaminhando /v1/* para ${config.ollamaBaseUrl}`);
  if (config.ollamaProxyTokens.length === 0) {
    console.warn(
      "[ollama-proxy] AVISO: nenhum OLLAMA_PROXY_TOKENS configurado — todas as chamadas serão recusadas."
    );
  }
});
