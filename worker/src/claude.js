// Claude-aanroep met web search, een strikte "publish"-tool, prompt caching en kostenberekening.
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-sonnet-5-5';

// USD per miljoen tokens. Cache-schrijven (5 min) = 1,25x invoer. Web search: $10 per 1000.
// Bij een terugval naar een ander model rekenen we met dat model.
const PRICES = {
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.2 },
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2 },
  'claude-opus-5': { in: 5, out: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { in: 5, out: 25, cacheRead: 0.5 },
  'claude-sonnet-5': { in: 2, out: 10, cacheRead: 0.2 },
};
const WEB_SEARCH_USD = 0.01;

export function costUsd(model, u) {
  const p = PRICES[model] ?? PRICES[MODEL];
  return (
    (u.input_tokens * p.in + u.output_tokens * p.out + u.cache_read_tokens * p.cacheRead + u.cache_write_tokens * p.in * 1.25) / 1e6 +
    u.web_search_requests * WEB_SEARCH_USD
  );
}

/**
 * Eén "beurt" bij Claude: blijft doorgaan bij pause_turn (max. 2 vervolgen, geen oneindige lus),
 * en geeft de input van de publish-tool terug.
 * system: vaste systeemprompt (wordt gecachet); userContent: de wisselende samenvatting.
 */
export async function runClaude(env, ctx, { system, userContent, tool, maxSearches, effort = 'medium', maxTokens = 16000 }) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('Worker-secret ANTHROPIC_API_KEY ontbreekt');
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 8 * 60 * 1000 });

  const usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, web_search_requests: 0 };
  let servedBy = MODEL;
  const messages = [{ role: 'user', content: userContent }];

  for (let round = 0; round < 3; round++) {
    ctx.budget.use();
    // Geen streaming: één JSON-antwoord verwerken kost minder rekentijd (gratis Workers-plan: ~10 ms CPU).
    const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort },
        // Vaste prefix (tools + system) wordt gecachet; de dagelijkse data staat erna.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: [
          { type: 'web_search_20260209', name: 'web_search', max_uses: maxSearches },
          tool,
        ],
        tool_choice: { type: 'auto' },
        messages,
      });

    const u = response.usage ?? {};
    usage.input_tokens += u.input_tokens ?? 0;
    usage.output_tokens += u.output_tokens ?? 0;
    usage.cache_read_tokens += u.cache_read_input_tokens ?? 0;
    usage.cache_write_tokens += u.cache_creation_input_tokens ?? 0;
    usage.web_search_requests += u.server_tool_use?.web_search_requests ?? 0;
    servedBy = response.model || servedBy;

    if (response.stop_reason === 'refusal') {
      const err = new Error(`Claude weigerde (${response.stop_details?.category ?? 'onbekend'})`);
      err.usage = usage; err.model = servedBy;
      throw err;
    }
    const call = response.content.find(b => b.type === 'tool_use' && b.name === tool.name);
    if (call) return { input: call.input, usage, model: servedBy };

    if (response.stop_reason === 'pause_turn') {
      // Server-tool-lus gepauzeerd: zelfde beurt laten afmaken
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }
    if (response.stop_reason === 'max_tokens') {
      const err = new Error('Antwoord afgekapt (max_tokens)');
      err.usage = usage; err.model = servedBy;
      throw err;
    }
    // Geen tool-aanroep: één keer expliciet vragen om te publiceren
    if (round === 0) {
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: `Roep nu de tool ${tool.name} aan met het resultaat.` });
      continue;
    }
    break;
  }
  const err = new Error(`Claude leverde geen ${tool.name}-aanroep op`);
  err.usage = usage; err.model = servedBy;
  throw err;
}
