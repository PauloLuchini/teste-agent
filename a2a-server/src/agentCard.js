import { config } from "./config.js";

// Versão do protocolo A2A (Agent2Agent) que este servidor implementa.
// 0.3.0 é a versão exigida pelo watsonx Orchestrate no momento (provider
// "external_chat/A2A/0.3.0") — versões anteriores como 0.2.1 estão
// deprecadas lá. Confirme sempre contra a especificação vigente:
// https://a2a-protocol.org/latest/specification/
export const A2A_PROTOCOL_VERSION = "0.3.0";

/**
 * Agent Card exposto em /.well-known/agent-card.json, conforme a spec A2A.
 * Descreve quem é o agente, onde ele fica, qual versão de protocolo fala
 * e como chamá-lo com segurança (esquema de autenticação).
 */
export function buildAgentCard() {
  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: "tester",
    description:
      "Agente especializado em testes de software: escreve, roda e corrige testes automatizados, " +
      "investigando falhas e reportando cobertura.",
    url: `${config.baseUrl}/a2a`,
    preferredTransport: "JSONRPC",
    version: "0.1.0",
    provider: {
      organization: "teste-agent",
      url: config.baseUrl,
    },
    documentationUrl: `${config.baseUrl}/`,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "Token Bearer estático emitido pelo operador deste agente (ver A2A_BEARER_TOKENS).",
      },
    },
    security: [{ bearerAuth: [] }],
    skills: [
      {
        id: "write-and-run-tests",
        name: "Escrever e rodar testes",
        description:
          "Escreve testes automatizados para o código indicado, seguindo as convenções do projeto, " +
          "e executa a suíte para confirmar que passam.",
        tags: ["testing", "qa", "automation"],
        examples: [
          "Escreva testes unitários para src/utils/parser.js",
          "Rode a suíte de testes e me diga o que está falhando",
        ],
      },
      {
        id: "diagnose-failing-tests",
        name: "Diagnosticar testes quebrados",
        description: "Investiga a causa raiz de um teste falhando e propõe a correção.",
        tags: ["testing", "debugging"],
        examples: ["O teste test_login está falhando no CI, descubra por quê"],
      },
    ],
  };
}
