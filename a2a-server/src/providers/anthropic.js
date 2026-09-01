import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

/**
 * Converte o histórico canônico do agentLoop para o formato de mensagens
 * da API da Anthropic, agrupando tool_results consecutivos em uma única
 * mensagem "user" (a API exige todos os resultados de um turno paralelo
 * de tool use em uma mensagem só).
 */
function toAnthropicMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
      continue;
    }
    if (m.role === "assistant") {
      const content = [];
      if (m.text) content.push({ type: "text", text: m.text });
      for (const tc of m.toolCalls ?? []) {
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
      }
      out.push({ role: "assistant", content });
      continue;
    }
    if (m.role === "tool") {
      const block = {
        type: "tool_result",
        tool_use_id: m.toolCallId,
        content: m.content,
        is_error: m.isError,
      };
      const last = out[out.length - 1];
      if (last?.role === "user" && Array.isArray(last.content) && last.content[0]?.type === "tool_result") {
        last.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }
  return out;
}

/**
 * Chama a API da Anthropic e devolve o turno no formato canônico usado
 * pelo agentLoop: { text, toolCalls, done, raw }.
 */
export async function chat({ system, messages, tools }) {
  const response = await client.messages.create({
    model: config.model,
    max_tokens: 4096,
    system,
    tools,
    messages: toAnthropicMessages(messages),
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  const toolCalls = response.content
    .filter((b) => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));

  return {
    text,
    toolCalls,
    done: response.stop_reason !== "tool_use" || toolCalls.length === 0,
    raw: response,
  };
}
