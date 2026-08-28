import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 41241),
  baseUrl: (process.env.AGENT_BASE_URL ?? `http://localhost:${process.env.PORT ?? 41241}`).replace(/\/$/, ""),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
  bearerTokens: (process.env.A2A_BEARER_TOKENS ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean),
  workspaceDir: path.resolve(__dirname, "..", process.env.WORKSPACE_DIR ?? "..",),
};
