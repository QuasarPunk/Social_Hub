const { createHash, timingSafeEqual } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { createServer } = require('node:http');

const MAX_BODY = 64 * 1024;
const MAX_CHAT_ID = 2 ** 52 - 1;
const JSON_HEADERS = { 'content-type': 'application/json' };

function digest(value) {
  return createHash('sha256').update(value).digest();
}

function hasFields(value, fields) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && fields.every(field => Object.hasOwn(value, field));
}

function chatId(value) {
  if (typeof value === 'string' && /^-?[1-9][0-9]{0,15}$/.test(value)) {
    value = Number(value);
  }
  return Number.isSafeInteger(value) && value !== 0 && Math.abs(value) <= MAX_CHAT_ID
    ? value : null;
}

function validText(value, maxLength) {
  return typeof value === 'string' && value.isWellFormed()
    && value.trim().length > 0 && [...value].length <= maxLength;
}

function validButton(button) {
  return hasFields(button, ['text', 'callback_data'])
    && validText(button.text, 128)
    && validText(button.callback_data, 64)
    && Buffer.byteLength(button.callback_data, 'utf8') <= 64;
}

function validMessage(value) {
  if (!hasFields(value, ['chat_id', 'text', 'reply_markup']) || !chatId(value.chat_id)
    || !validText(value.text, 4096) || !hasFields(value.reply_markup, ['inline_keyboard'])) {
    return false;
  }

  const rows = value.reply_markup.inline_keyboard;
  return Array.isArray(rows) && rows.length > 0 && rows.length <= 100
    && rows.every(row => Array.isArray(row) && row.length > 0
      && row.length <= 8 && row.every(validButton))
    && rows.reduce((count, row) => count + row.length, 0) <= 100;
}

function error(response, status, code) {
  response.writeHead(status, { ...JSON_HEADERS, connection: 'close' });
  response.end(JSON.stringify({ ok: false, error: code }));
}

function createRelay({ botToken, relayKey, allowedChats, fetchTelegram = fetch, timeoutMs = 5000 }) {
  if (!/^[0-9]+:[A-Za-z0-9_-]+$/.test(botToken ?? '')
    || !/^[a-f0-9]{64}$/.test(relayKey ?? '') || !allowedChats?.length
    || allowedChats.some(value => chatId(value) === null)) {
    throw new Error('invalid_configuration');
  }

  const authorizedChats = new Set(allowedChats.map(chatId));
  const expectedAuth = digest(`Bearer ${relayKey}`);
  const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

  async function handle(request, response) {
    if (!timingSafeEqual(digest(request.headers.authorization ?? ''), expectedAuth)) {
      return error(response, 401, 'unauthorized');
    }
    if (request.url !== '/sendMessage') return error(response, 404, 'not_found');
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST');
      return error(response, 405, 'method_not_allowed');
    }
    if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return error(response, 415, 'unsupported_content_type');
    }
    if (Number(request.headers['content-length']) > MAX_BODY) {
      return error(response, 413, 'body_too_large');
    }

    const chunks = [];
    let size = 0;
    // Leave the socket open long enough to return 413 for oversized chunked bodies.
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > MAX_BODY) return error(response, 413, 'body_too_large');
      chunks.push(chunk);
    }

    let payload;
    try {
      payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    } catch {
      return error(response, 400, 'invalid_json');
    }
    if (!validMessage(payload)) return error(response, 400, 'invalid_message');
    payload.chat_id = chatId(payload.chat_id);
    if (!authorizedChats.has(payload.chat_id)) return error(response, 403, 'chat_not_allowed');

    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const upstream = await fetchTelegram(telegramUrl, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(payload),
        redirect: 'error',
        signal,
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        return error(response, 502, 'telegram_http_error');
      }
      const result = await upstream.json();
      if (result?.ok === false) return error(response, 502, 'telegram_rejected');
      const messageId = result?.result?.message_id;
      if (result?.ok !== true || !Number.isSafeInteger(messageId) || messageId < 0) {
        return error(response, 502, 'telegram_invalid_response');
      }
      response.writeHead(200, JSON_HEADERS);
      response.end(JSON.stringify({ ok: true, message_id: messageId }));
    } catch (failure) {
      if (signal.aborted) return error(response, 504, 'telegram_timeout');
      if (failure instanceof SyntaxError) return error(response, 502, 'telegram_invalid_response');
      return error(response, 502, 'telegram_unavailable');
    }
  }

  return createServer({
    headersTimeout: 5000,
    requestTimeout: 10000,
    connectionsCheckingInterval: 1000,
  }, (request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent && !response.destroyed) error(response, 500, 'internal_error');
    });
  });
}

if (require.main === module) {
  try {
    const secret = name => readFileSync(`/run/secrets/${name}`, 'utf8').trim();
    const server = createRelay({
      botToken: secret('telegram_bot_token'),
      relayKey: secret('telegram_relay_key'),
      allowedChats: secret('telegram_allowed_chats').split(/\r?\n/).map(line => line.trim()),
    });
    server.on('error', () => {
      console.error('No se pudo iniciar el servicio Telegram.');
      process.exitCode = 1;
    });
    server.listen(8080, '0.0.0.0');
  } catch {
    console.error('Configuración inválida del servicio Telegram.');
    process.exitCode = 1;
  }
}

module.exports = { createRelay };
