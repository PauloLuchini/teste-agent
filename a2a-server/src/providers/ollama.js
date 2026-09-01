import { randomUUID } from "node:crypto";
import { config } from "../config.js";

/**
 * Converte as tool definitions (formato Anthropic, com input_schema) para
 * o formato de "function calling" usado pela API do Ollama (/api/chat).
 */
function toOllamaTools(tools) {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

/**
 * Converte o histórico canônico do agentLoop para mensagens no formato
 * do Ollama. Diferente da Anthropic, o Ollama não usa tool_use_id: o
 * resultado de uma tool volta como { role: "tool", content, tool_name }.
 */
function toOllamaMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const msg = { role: "assistant", content: m.text ?? "" };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          function: { name: tc.name, arguments: tc.input },
        }));
      }
      out.push(msg);
    } else if (m.role === "tool") {
      out.push({ role: "tool", content: m.content, tool_name: m.name });
    }
  }
  return out;
}

// Reforço de uso de ferramentas específico para modelos locais via Ollama.
// O system prompt em .claude/agents/tester.md foi escrito para o harness do
// Claude Code, onde o uso de tools é implícito e fortemente treinado no
// modelo. Modelos locais (ex.: llama3.1) seguem essa convenção com bem
// menos disciplina e tendem a "alucinar" blocos de código fingindo ter
// rodado um comando em vez de de fato chamar a ferramenta — por isso esse
// reforço só é aplicado aqui, não no prompt canônico usado pela Anthropic.
const TOOL_USE_REINFORCEMENT = `
INSTRUÇÕES DE USO DE FERRAMENTAS (siga à risca):
- Você tem acesso a ferramentas reais (Read, Write, Edit, Glob, Grep, Bash) fornecidas nesta chamada.
- Para qualquer ação que exija tocar o sistema de arquivos ou rodar um comando, você DEVE chamar a ferramenta correspondente — nunca escreva blocos de código fingindo que rodou um comando, e nunca invente a saída de um comando que você não executou de fato.
- Se a pergunta puder ser respondida sem tocar o sistema de arquivos, responda em texto normalmente, sem chamar ferramentas à toa.
- Nunca diga que um arquivo existe, foi criado/editado, ou que um teste passou, sem ter chamado a ferramenta correspondente nesta conversa e visto o resultado real dela.`;

/**
 * Chama um modelo local via Ollama (POST {OLLAMA_BASE_URL}/api/chat) e
 * devolve o turno no mesmo formato canônico que o provider da Anthropic:
 * { text, toolCalls, done, raw }.
 *
 * Requer um modelo com suporte a tool calling (ex.: llama3.1, qwen2.5,
 * mistral-nemo) já baixado localmente: `ollama pull <modelo>`.
 */
export async function chat({ system, messages, tools }) {
  const body = {
    model: config.ollamaModel,
    stream: false,
    messages: [
      { role: "system", content: system + "\n" + TOOL_USE_REINFORCEMENT },
      ...toOllamaMessages(messages),
    ],
    tools: toOllamaTools(tools),
  };

  let res;
  try {
    res = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Sem isso, uma trava no Ollama (modelo travado, sem VRAM/RAM, etc.)
      // deixa a chamada pendurada para sempre sem nenhum erro aparecer.
      signal: AbortSignal.timeout(config.ollamaTimeoutMs),
    });
  } catch (err) {
    if (err.name === "TimeoutError") {
      throw new Error(
        `Ollama não respondeu em ${config.ollamaTimeoutMs / 1000}s (turno pendurado). ` +
          "Rode `ollama ps` para ver se o modelo está travado, ou aumente OLLAMA_TIMEOUT_MS no .env."
      );
    }
    throw new Error(
      `Não foi possível conectar ao Ollama em ${config.ollamaBaseUrl} (${err.message}). ` +
        "Confirme que o Ollama está rodando (`ollama serve`) e que OLLAMA_BASE_URL está correto."
    );
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Ollama respondeu ${res.status}: ${errText || res.statusText}`);
  }

  const data = await res.json();
  const message = data.message ?? {};
  const text = (message.content ?? "").trim();
  const toolCalls = (message.tool_calls ?? []).map((tc) => ({
    // O Ollama não devolve um id de tool call — geramos um localmente só
    // para rastrear o par chamada/resultado dentro deste turno.
    id: randomUUID(),
    name: tc.function?.name,
    input: tc.function?.arguments ?? {},
  }));

  return { text, toolCalls, done: toolCalls.length === 0, raw: data };
}
