import { randomUUID } from "node:crypto";
import { runTesterAgent } from "./agentLoop.js";
import { createTask, getTask, setStatus, updateTask } from "./taskStore.js";

function textFromMessage(message) {
  return (message?.parts ?? [])
    .filter((p) => p.kind === "text" || p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

function agentMessage(taskId, contextId, text) {
  return {
    role: "agent",
    parts: [{ kind: "text", text }],
    messageId: randomUUID(),
    taskId,
    contextId,
  };
}

async function handleMessageSend(params) {
  const userText = textFromMessage(params?.message);
  if (!userText) {
    const err = new Error("message.parts deve conter ao menos uma parte de texto.");
    err.rpcCode = -32602;
    throw err;
  }

  const task = createTask(params?.message?.contextId);
  task.history.push(params.message);
  setStatus(task.id, "working");

  try {
    const { text } = await runTesterAgent(userText);
    const reply = agentMessage(task.id, task.contextId, text || "(sem resposta em texto)");
    task.history.push(reply);
    task.artifacts.push({
      artifactId: randomUUID(),
      name: "resultado",
      parts: [{ kind: "text", text: text || "" }],
    });
    setStatus(task.id, "completed");
  } catch (err) {
    const reply = agentMessage(task.id, task.contextId, `Falhou: ${err.message}`);
    task.history.push(reply);
    setStatus(task.id, "failed", { message: err.message });
  }

  return getTask(task.id);
}

async function handleTasksGet(params) {
  const task = getTask(params?.id);
  if (!task) {
    const err = new Error(`Task não encontrada: ${params?.id}`);
    err.rpcCode = -32001;
    throw err;
  }
  return task;
}

async function handleTasksCancel(params) {
  const task = getTask(params?.id);
  if (!task) {
    const err = new Error(`Task não encontrada: ${params?.id}`);
    err.rpcCode = -32001;
    throw err;
  }
  if (task.status.state === "working" || task.status.state === "submitted") {
    setStatus(task.id, "canceled");
  }
  return task;
}

const methods = {
  "message/send": handleMessageSend,
  "tasks/get": handleTasksGet,
  "tasks/cancel": handleTasksCancel,
};

export async function handleJsonRpc(body) {
  if (body?.jsonrpc !== "2.0" || typeof body?.method !== "string") {
    return {
      jsonrpc: "2.0",
      id: body?.id ?? null,
      error: { code: -32600, message: "Requisição JSON-RPC inválida." },
    };
  }

  const handler = methods[body.method];
  if (!handler) {
    return {
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: { code: -32601, message: `Método não suportado: ${body.method}` },
    };
  }

  try {
    const result = await handler(body.params);
    return { jsonrpc: "2.0", id: body.id ?? null, result };
  } catch (err) {
    return {
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: { code: err.rpcCode ?? -32000, message: err.message },
    };
  }
}
