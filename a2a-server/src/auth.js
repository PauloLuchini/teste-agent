import { config } from "./config.js";

/**
 * Middleware de autenticação Bearer para o endpoint JSON-RPC do A2A.
 * O Agent Card anuncia esse esquema em `securitySchemes.bearerAuth`.
 */
export function requireBearerAuth(req, res, next) {
  if (config.bearerTokens.length === 0) {
    // Nenhum token configurado: bloqueia por padrão para não expor o
    // agente (com acesso a Bash/arquivos) sem autenticação nenhuma.
    return res.status(500).json({
      jsonrpc: "2.0",
      id: req.body?.id ?? null,
      error: { code: -32000, message: "Servidor sem A2A_BEARER_TOKENS configurado." },
    });
  }

  const header = req.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token || !config.bearerTokens.includes(token)) {
    return res.status(401).json({
      jsonrpc: "2.0",
      id: req.body?.id ?? null,
      error: { code: -32001, message: "Não autenticado: Bearer token ausente ou inválido." },
    });
  }

  next();
}
