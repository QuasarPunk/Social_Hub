const { setTimeout: delay } = require('node:timers/promises');

const editorialCodes = new Set([
  'content_not_classified', 'content_not_found', 'editorial_busy', 'invalid_capture_contract',
  'invalid_content_id', 'invalid_editorial_profile', 'invalid_provider_response', 'no_editorial_facts',
  'no_supported_platforms', 'provider_quota', 'provider_rejected_input', 'provider_timeout',
  'provider_unavailable',
]);

function sanitizedEditorialFailure(error) {
  const code = editorialCodes.has(error?.code) ? error.code : 'unknown';
  const reason = typeof error?.reason === 'string' && /^[a-z_]{1,40}$/.test(error.reason) ? error.reason : null;
  return 'code=' + code + (reason ? ' reason=' + reason : '');
}

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
            options: { temperature: 0.2, num_ctx: 4096, num_predict: 1024 },
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
          const failure = new EditorialError('invalid_provider_response', 502, true);
          failure.stage = 'provider_parse';
          throw failure;
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
      const planned = await provider.plan(query, stop);
      const result = validate(planned) ?? planned;
      return { result, attempted: attempt, imageUsed: query.images.length > 0 };
    } catch (error) {
      if (attempt === 2 || !error.retryable || stop?.aborted) throw error;
      await wait(1200, undefined, { signal: stop });
    }
  }
}

module.exports = { EditorialError, ollamaProvider, templateProvider, editorialPlan, sanitizedEditorialFailure };
