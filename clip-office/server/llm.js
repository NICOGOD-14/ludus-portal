// Integración con Claude (Anthropic SDK). Si no hay API key, el sistema usa modo básico.
import Anthropic from '@anthropic-ai/sdk';
import { getSecret } from './config.js';

let client = null;
let clientKey = '';

export function llmAvailable() { return Boolean(getSecret('ANTHROPIC_API_KEY')); }
export function model() { return getSecret('CLAUDE_MODEL') || 'claude-opus-5-5'; }

function getClient() {
  const key = getSecret('ANTHROPIC_API_KEY');
  if (!key) return null;
  if (!client || clientKey !== key) { client = new Anthropic({ apiKey: key }); clientKey = key; }
  return client;
}

/** Parámetros comunes: fallback automático del servidor si el modelo declina. */
function base(extra) {
  return {
    model: model(),
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    ...extra,
  };
}

function textOf(msg) {
  return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

/** Pide a Claude una respuesta JSON que cumple el schema. */
export async function askJson({ system, prompt, schema, effort = 'medium', maxTokens = 16000, webSearch = false }) {
  const c = getClient();
  if (!c) throw new Error('Sin ANTHROPIC_API_KEY');
  // Con búsqueda web las citas no son compatibles con el formato estricto: se pide JSON en el texto.
  const params = base({
    max_tokens: maxTokens,
    system: webSearch ? `${system}\n\nAl final responde SOLO con un objeto JSON válido que cumpla este JSON Schema, sin texto adicional:\n${JSON.stringify(schema)}` : system,
    output_config: webSearch ? { effort } : { effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: prompt }],
  });
  if (webSearch) params.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }];
  let messages = params.messages;
  for (let i = 0; i < 4; i++) {
    const res = await c.beta.messages.stream({ ...params, messages }).finalMessage();
    if (res.stop_reason === 'refusal') throw new Error('Claude declinó esta solicitud');
    if (res.stop_reason === 'pause_turn') { messages = [...messages, { role: 'assistant', content: res.content }]; continue; }
    const txt = textOf(res);
    const a = txt.indexOf('{');
    const z = txt.lastIndexOf('}');
    return JSON.parse(a >= 0 && z > a ? txt.slice(a, z + 1) : txt);
  }
  throw new Error('Claude no terminó la respuesta');
}

/**
 * Conversación con herramientas (agentes de la oficina).
 * tools: [{ name, description, input_schema, run: async (input) => any }]
 */
export async function chatWithTools({ system, history, tools, effort = 'low', onTool }) {
  const c = getClient();
  if (!c) throw new Error('Sin ANTHROPIC_API_KEY');
  const defs = tools.map(({ run: _r, ...d }) => d);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const messages = [...history];
  const actions = [];
  for (let step = 0; step < 8; step++) {
    const res = await c.beta.messages.create(base({
      max_tokens: 16000,
      system,
      tools: [...defs, { type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
      output_config: { effort },
      messages,
    }));
    if (res.stop_reason === 'refusal') return { text: 'Prefiero no ayudar con eso. ¿Vemos otra idea para el canal?', actions };
    messages.push({ role: 'assistant', content: res.content });
    if (res.stop_reason === 'pause_turn') continue;
    const uses = res.content.filter((b) => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !uses.length) return { text: textOf(res), actions };
    const results = await Promise.all(uses.map(async (u) => {
      const t = byName[u.name];
      try {
        if (!t) throw new Error(`Herramienta desconocida ${u.name}`);
        const input = typeof u.input === 'string' ? JSON.parse(u.input) : u.input;
        onTool?.(u.name, input);
        const out = await t.run(input || {});
        actions.push({ tool: u.name, input, ok: true });
        return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out ?? { ok: true }).slice(0, 20000) };
      } catch (e) {
        actions.push({ tool: u.name, ok: false, error: e.message });
        return { type: 'tool_result', tool_use_id: u.id, content: `Error: ${e.message}`, is_error: true };
      }
    }));
    messages.push({ role: 'user', content: results });
  }
  return { text: 'Listo, dejé las tareas en marcha. Revisa el Estudio en unos minutos.', actions };
}
