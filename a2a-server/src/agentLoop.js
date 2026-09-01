import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getProvider } from "./providers/index.js";
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

const MAX_TURNS = 24;

/**
 * Roda o agente "tester" até ele produzir uma resposta final de texto
 * (sem mais chamadas de ferramenta), executando as tool calls no meio
 * do caminho. O histórico é mantido em um formato canônico, independente
 * de provider (Anthropic ou Ollama — ver src/providers/). Retorna o texto
 * final e o histórico de mensagens.
 */
export async function runTesterAgent(userMessage, { onEvent } = {}) {
  const system = await loadSystemPrompt();
  const provider = getProvider();
  const messages = [{ role: "user", content: userMessage }];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const result = await provider.chat({ system, messages, tools: toolDefinitions });

    onEvent?.({ type: "model_turn", raw: result.raw });

    messages.push({ role: "assistant", text: result.text, toolCalls: result.toolCalls });

    if (result.done) {
      return { text: result.text, messages };
    }

    for (const toolCall of result.toolCalls) {
      onEvent?.({ type: "tool_call", tool: toolCall.name, input: toolCall.input });
      let content;
      let isError = false;
      try {
        content = await runTool(toolCall.name, toolCall.input);
      } catch (err) {
        content = `Erro: ${err.message}`;
        isError = true;
      }
      onEvent?.({ type: "tool_result", tool: toolCall.name, result: content, isError });
      messages.push({
        role: "tool",
        toolCallId: toolCall.id,
        name: toolCall.name,
        content: String(content).slice(0, 50_000),
        isError,
      });
    }
  }

  throw new Error("O agente excedeu o número máximo de turnos sem concluir.");
}
