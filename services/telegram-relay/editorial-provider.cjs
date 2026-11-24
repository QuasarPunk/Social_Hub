const { setTimeout: delay } = require('node:timers/promises');

class EditorialError extends Error {
  constructor(code, status = 422, retryable = false) {
    super(code);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function ollamaProvider({ url, model, timeoutMs = 80000, fetchModel = fetch }) {
  const endpoint = new URL('/api/chat', url);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || !model) {
    throw new Error('invalid_editorial_provider_config');
  }
  return {
    name: 'ollama', model,
    async plan({ system, input, schema, images }, stop) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = stop ? AbortSignal.any([timeout, stop]) : timeout;
      let response;
      try {
        response = await fetchModel(endpoint, {
          method: 'POST', redirect: 'error', signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model, stream: false, format: schema, keep_alive: '2m',
            options: { temperature: 0, num_ctx: 4096, num_predict: 400 },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: JSON.stringify(input), ...(images.length && { images }) },
            ],
          }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 429) throw new EditorialError('provider_quota', 429);
          if ([400, 422].includes(response.status)) throw new EditorialError('provider_rejected_input', 502, true);
          throw new EditorialError('provider_unavailable', 503, response.status >= 500);
        }
        return JSON.parse((await response.json()).message.content);
      } catch (error) {
        if (error instanceof EditorialError) throw error;
        if (error instanceof SyntaxError || error instanceof TypeError && response) {
          throw new EditorialError('invalid_provider_response', 502, true);
        }
        throw new EditorialError(timeout.aborted ? 'provider_timeout' : 'provider_unavailable', 503, true);
      }
    },
  };
}

const templateProvider = {
  name: 'template', model: 'es-platforms-v1',
  async plan({ input }) {
    return {
      destinations: Object.fromEntries(Object.entries(input.platforms).map(([platform, info]) => [
        platform, { opening: 0, fragments: input.fragments.slice(0, info.max_fragments).map(x => x.id) },
      ])),
      visual: 'sin determinar',
    };
  },
};

async function editorialPlan(provider, request, validate, stop, wait = delay) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const query = attempt === 1 ? request : { ...request, images: [] };
    try {
      const result = await provider.plan(query, stop);
      validate(result);
      return { result, attempted: attempt, imageUsed: query.images.length > 0 };
    } catch (error) {
      if (attempt === 2 || !error.retryable || stop?.aborted) throw error;
      await wait(1200, undefined, { signal: stop });
    }
  }
}

module.exports = { EditorialError, ollamaProvider, templateProvider, editorialPlan };
