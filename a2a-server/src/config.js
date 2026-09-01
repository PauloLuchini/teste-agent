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

  // Qual provider de modelo usar para o raciocínio do agente:
  // "anthropic" (API paga, na nuvem) ou "ollama" (modelo local, sem custo
  // por token — ver src/providers/ollama.js).
  provider: (process.env.MODEL_PROVIDER ?? "anthropic").toLowerCase(),

  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",

  // Usados apenas quando provider === "ollama".
  ollamaBaseUrl: (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, ""),
  ollamaModel: process.env.OLLAMA_MODEL ?? "llama3.1",

  bearerTokens: (process.env.A2A_BEARER_TOKENS ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean),
  workspaceDir: path.resolve(__dirname, "..", process.env.WORKSPACE_DIR ?? "..",),
};
