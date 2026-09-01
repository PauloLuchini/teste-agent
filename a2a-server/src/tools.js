import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { glob } from "glob";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);

/**
 * Garante que um caminho pedido pelo modelo fica dentro do workspace
 * configurado, para não permitir escapar do diretório do projeto.
 */
function resolveInWorkspace(requestedPath) {
  const resolved = path.resolve(config.workspaceDir, requestedPath);
  const root = config.workspaceDir + path.sep;
  if (resolved !== config.workspaceDir && !resolved.startsWith(root)) {
    throw new Error(
      `Caminho fora do workspace permitido: ${requestedPath}`
    );
  }
  return resolved;
}

export const toolDefinitions = [
  {
    name: "Read",
    description: "Lê o conteúdo de um arquivo de texto do workspace.",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Caminho relativo ao workspace." },
      },
      required: ["file_path"],
    },
  },
  {
    name: "Write",
    description: "Cria ou sobrescreve um arquivo com o conteúdo dado.",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Caminho relativo ao workspace." },
        content: { type: "string", description: "Conteúdo completo do arquivo." },
      },
      required: ["file_path", "content"],
    },
  },
  {
    name: "Edit",
    description: "Substitui uma ocorrência exata de texto em um arquivo existente.",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
      },
      required: ["file_path", "old_string", "new_string"],
    },
  },
  {
    name: "Glob",
    description:
      "Busca arquivos por padrão glob dentro do workspace, recursivamente em subdiretórios. " +
      "Use ** para descer em qualquer profundidade — ex.: '**/*' lista todos os arquivos do " +
      "workspace, '**/*.js' todos os .js em qualquer subpasta. Um padrão como '*' ou './*' só " +
      "olha o nível raiz do workspace e não encontra nada se os arquivos estiverem em subpastas.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "Grep",
    description: "Busca um padrão regex no conteúdo dos arquivos do workspace (via ripgrep/grep).",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string", description: "Diretório ou arquivo onde buscar (opcional)." },
      },
      required: ["pattern"],
    },
  },
  {
    name: "Bash",
    description:
      "Executa um comando de shell dentro do workspace (ex.: rodar a suíte de testes). Uso restrito e auditado.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string" },
      },
      required: ["command"],
    },
  },
];

export async function runTool(name, input) {
  switch (name) {
    case "Read": {
      const p = resolveInWorkspace(input.file_path);
      return await fs.readFile(p, "utf8");
    }
    case "Write": {
      const p = resolveInWorkspace(input.file_path);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, input.content, "utf8");
      return `Arquivo escrito: ${input.file_path}`;
    }
    case "Edit": {
      const p = resolveInWorkspace(input.file_path);
      const current = await fs.readFile(p, "utf8");
      if (!current.includes(input.old_string)) {
        throw new Error("old_string não encontrado no arquivo — edição abortada.");
      }
      const updated = current.replace(input.old_string, input.new_string);
      await fs.writeFile(p, updated, "utf8");
      return `Arquivo editado: ${input.file_path}`;
    }
    case "Glob": {
      const matches = await glob(input.pattern, { cwd: config.workspaceDir, nodir: true });
      return matches.join("\n") || "(nenhum arquivo encontrado)";
    }
    case "Grep": {
      const target = input.path ? resolveInWorkspace(input.path) : config.workspaceDir;
      try {
        const { stdout } = await execFileAsync(
          "grep",
          ["-rn", "-E", input.pattern, target],
          { maxBuffer: 1024 * 1024 * 10 }
        );
        return stdout || "(sem ocorrências)";
      } catch (err) {
        // grep sai com código 1 quando não encontra nada — não é erro.
        if (err.code === 1) return "(sem ocorrências)";
        throw err;
      }
    }
    case "Bash": {
      try {
        const { stdout, stderr } = await execFileAsync("bash", ["-lc", input.command], {
          cwd: config.workspaceDir,
          maxBuffer: 1024 * 1024 * 20,
          timeout: 5 * 60 * 1000,
        });
        return [stdout, stderr].filter(Boolean).join("\n") || "(sem saída)";
      } catch (err) {
        const out = [err.stdout, err.stderr].filter(Boolean).join("\n");
        throw new Error(`Comando falhou (código ${err.code}):\n${out || err.message}`);
      }
    }
    default:
      throw new Error(`Ferramenta desconhecida: ${name}`);
  }
}
