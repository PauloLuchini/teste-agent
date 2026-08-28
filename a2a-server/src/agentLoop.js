import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { toolDefinitions, runTool } from "./tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESTER_AGENT_MD = path.resolve(__dirname, "..", "..", ".claude", "agents", "tester.md");

let cachedSystemPrompt;

/**
 * Extrai o corpo (fora do frontmatter YAML) de .claude/agents/tester.md
 * para usar como system prompt do agente exposto via A2A.
 */
async function loadSystemPrompt() {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  const raw = await fs.readFile(TESTER_AGENT_MD, "utf8");
  const withoutFrontmatter = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
  cachedSystemPrompt = withoutFrontmatter.trim();
  return cachedSystemPrompt;
}

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const MAX_TURNS = 24;

/**
 * Roda o agente "tester" até ele produzir uma resposta final de texto
 * (sem mais chamadas de ferramenta), executando as tool calls no meio
 * do caminho. Retorna o texto final e o histórico de mensagens.
 */
export async function runTesterAgent(userMessage, { onEvent } = {}) {
  const system = await loadSystemPrompt();
  const messages = [{ role: "user", content: userMessage }];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model: config.model,
      max_tokens: 4096,
      system,
      tools: toolDefinitions,
      messages,
    });

    onEvent?.({ type: "model_turn", response });

    const toolUses = response.content.filter((b) => b.type === "tool_use");

    if (toolUses.length === 0 || response.stop_reason !== "tool_use") {
      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { text, messages: [...messages, { role: "assistant", content: response.content }] };
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults = [];
    for (const toolUse of toolUses) {
      onEvent?.({ type: "tool_call", tool: toolUse.name, input: toolUse.input });
      let result;
      let isError = false;
      try {
        result = await runTool(toolUse.name, toolUse.input);
      } catch (err) {
        result = `Erro: ${err.message}`;
        isError = true;
      }
      onEvent?.({ type: "tool_result", tool: toolUse.name, result, isError });
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: String(result).slice(0, 50_000),
        is_error: isError,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  throw new Error("O agente excedeu o número máximo de turnos sem concluir.");
}
