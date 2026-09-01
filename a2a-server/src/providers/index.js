import { config } from "../config.js";
import * as anthropicProvider from "./anthropic.js";
import * as ollamaProvider from "./ollama.js";

const providers = {
  anthropic: anthropicProvider,
  ollama: ollamaProvider,
};

/**
 * Devolve o provider de modelo configurado via MODEL_PROVIDER
 * ("anthropic" ou "ollama"). Cada provider expõe chat({ system, messages,
 * tools }) -> { text, toolCalls, done, raw } — o mesmo contrato para o
 * agentLoop, independente de onde a inferência roda.
 */
export function getProvider() {
  const provider = providers[config.provider];
  if (!provider) {
    throw new Error(
      `MODEL_PROVIDER inválido: "${config.provider}". Use "anthropic" ou "ollama".`
    );
  }
  return provider;
}
