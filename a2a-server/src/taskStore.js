import { randomUUID } from "node:crypto";

/** Armazenamento em memória das tasks A2A. Reinicia a cada restart do processo. */
const tasks = new Map();

export function createTask(contextId) {
  const task = {
    id: randomUUID(),
    contextId: contextId ?? randomUUID(),
    status: { state: "submitted", timestamp: new Date().toISOString() },
    history: [],
    artifacts: [],
  };
  tasks.set(task.id, task);
  return task;
}

export function getTask(id) {
  return tasks.get(id);
}

export function updateTask(id, patch) {
  const task = tasks.get(id);
  if (!task) return undefined;
  Object.assign(task, patch);
  return task;
}

export function setStatus(id, state, extra = {}) {
  const task = tasks.get(id);
  if (!task) return undefined;
  task.status = { state, timestamp: new Date().toISOString(), ...extra };
  return task;
}
