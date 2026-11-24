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

function requestTelegram(fetchTelegram, botToken, method, payload, signal) {
  return fetchTelegram(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
    redirect: 'error',
    signal,
  });
}

function createRelay({ botToken, relayKey, allowedChats, fetchTelegram = fetch, timeoutMs = 5000, intake, generateDraft }) {
  if (!/^[0-9]+:[A-Za-z0-9_-]+$/.test(botToken ?? '')
    || !/^[a-f0-9]{64}$/.test(relayKey ?? '') || !allowedChats?.length
    || allowedChats.some(value => chatId(value) === null)) {
    throw new Error('invalid_configuration');
  }

  const authorizedChats = new Set(allowedChats.map(chatId));
  const expectedAuth = digest(`Bearer ${relayKey}`);

  async function handle(request, response) {
    if (!timingSafeEqual(digest(request.headers.authorization ?? ''), expectedAuth)) {
      return error(response, 401, 'unauthorized');
    }
    const isIntake = request.url === '/classify' && intake;
    const isDraft = request.url === '/drafts' && generateDraft;
    if (request.url !== '/sendMessage' && !isIntake && !isDraft) return error(response, 404, 'not_found');
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
    if (isDraft) {
      if (!hasFields(payload, ['content_id'])) return error(response, 400, 'invalid_content_id');
      const stop = new AbortController();
      response.once('close', () => { if (!response.writableFinished) stop.abort(); });
      try {
        const draft = await generateDraft(payload.content_id, stop.signal);
        response.writeHead(200, JSON_HEADERS);
        response.end(JSON.stringify(draft));
      } catch (failure) {
        if (!stop.signal.aborted) {
          const { EditorialError } = require('./editorial-provider.cjs');
          if (failure instanceof EditorialError) return error(response, failure.status, failure.code);
          throw failure;
        }
      }
      return;
    }
    if (isIntake) {
      const record = await intake(payload);
      response.writeHead(200, JSON_HEADERS);
      response.end(JSON.stringify(record));
      return;
    }
    if (!validMessage(payload)) return error(response, 400, 'invalid_message');
    payload.chat_id = chatId(payload.chat_id);
    if (!authorizedChats.has(payload.chat_id)) return error(response, 403, 'chat_not_allowed');

    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const upstream = await requestTelegram(fetchTelegram, botToken, 'sendMessage', payload, signal);
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

function telegramCaller(botToken, fetchTelegram = fetch) {
  return async (method, payload, timeoutMs = 5000, stop) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = stop ? AbortSignal.any([stop, timeout]) : timeout;
    const response = await requestTelegram(fetchTelegram, botToken, method, payload, signal);
    if (!response.ok) {
      await response.body?.cancel();
      if (method === 'getUpdates' && response.status === 409) throw new Error('telegram_consumer_conflict');
      throw new Error('telegram_http_error');
    }
    const body = await response.json();
    if (body?.ok !== true) throw new Error('telegram_rejected');
    return body.result;
  };
}

function workflowDispatcher(url, relayKey, fetchWorkflow = fetch) {
  return async (update, stop) => {
    const timeout = AbortSignal.timeout(30000);
    const response = await fetchWorkflow(url, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: 'Bearer ' + relayKey },
      body: JSON.stringify(update),
      redirect: 'error',
      signal: stop ? AbortSignal.any([stop, timeout]) : timeout,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('workflow_unavailable');
    }
    return response.json();
  };
}

if (require.main === module) {
  try {
    const secret = name => readFileSync(`/run/secrets/${name}`, 'utf8').trim();
    const botToken = secret('telegram_bot_token');
    const allowedChats = secret('telegram_allowed_chats').split(/\r?\n/).map(line => line.trim());
    const relayKey = secret('telegram_relay_key');
    const seed = process.argv[2] === '--seed-dev-record';
    const poll = process.env.TELEGRAM_DEV_CALLBACKS === '1';
    const workflowUrl = process.env.TELEGRAM_WORKFLOW_URL;
    const integrated = process.env.TELEGRAM_POLLING === '1';
    const expectedBot = process.env.TELEGRAM_EXPECTED_BOT;
    if ((poll && integrated) || (integrated && (!workflowUrl || !/^[A-Za-z0-9_]+$/.test(expectedBot ?? '')))) {
      throw new Error('invalid_polling_configuration');
    }
    const { loadProjects, seedRecord, pollCallbacks } = require('./callbacks.cjs');
    const { createIntake, downloadPhoto } = require('./intake.cjs');
    const { createCapture, httpTranscriber } = require('./capture.cjs');
    const options = {
      records: '/data/records', incoming: '/data/incoming',
      projects: seed || poll || workflowUrl ? loadProjects('/projects') : undefined,
      allowedChats: new Set(allowedChats.map(chatId)),
      callTelegram: telegramCaller(botToken),
      log: console.log,
    };
    const fetchMedia = (filePath, signal) => downloadPhoto(botToken, filePath, fetch, signal);
    if (process.env.TELEGRAM_MULTIMODAL === '1') {
      const userList = process.env.TELEGRAM_ALLOWED_USERS?.trim();
      const users = userList ? userList.split(/[,\s]+/).map(chatId) : undefined;
      if (users?.some(id => id === null || id < 0)) throw new Error('invalid_allowed_users');
      options.capture = createCapture({
        ...options, sessions: '/data/sessions', fetchMedia, botUsername: expectedBot,
        allowedUsers: users && new Set(users),
        idleMs: Number(process.env.TELEGRAM_CAPTURE_IDLE_MS ?? 90000),
        maxMs: Number(process.env.TELEGRAM_CAPTURE_MAX_MS ?? 600000),
        transcribe: process.env.TELEGRAM_TRANSCRIBE_URL && httpTranscriber(process.env.TELEGRAM_TRANSCRIBE_URL),
      });
    }
    const intake = workflowUrl && (options.capture?.ingest ?? createIntake({ ...options, fetchPhoto: fetchMedia }));
    if (process.env.EDITORIAL_ENABLED === '1') {
      const { createEditorialEngine } = require('./editorial-drafts.cjs');
      const { ollamaProvider, templateProvider } = require('./editorial-provider.cjs');
      const kind = process.env.EDITORIAL_PROVIDER ?? 'ollama';
      if (!['ollama', 'template'].includes(kind)) throw new Error('invalid_editorial_provider');
      options.editorial = createEditorialEngine({
        records: options.records, incoming: options.incoming, drafts: '/data/drafts',
        provider: kind === 'template' ? templateProvider : ollamaProvider({
          url: process.env.EDITORIAL_OLLAMA_URL ?? 'http://ollama:11434',
          model: process.env.EDITORIAL_MODEL ?? 'qwen2.5:1.5b',
        }),
        vision: kind === 'ollama' && process.env.EDITORIAL_VISION === '1',
      });
    }
    const server = createRelay({ botToken, relayKey, allowedChats, intake, generateDraft: options.editorial?.request });
    if (seed) {
      if (options.allowedChats.size !== 1) throw new Error('expected_single_chat');
      seedRecord(options.records, options.projects, options.allowedChats.values().next().value);
      console.log('Registro de prueba pendiente creado');
    } else if (poll || integrated) {
      const controller = new AbortController();
      let timer;
      const startCapture = () => {
        timer = setInterval(() => {
          options.capture.tick(controller.signal).catch(() => console.error('No se pudo revisar el almacenamiento de capturas.'));
        }, 1000);
      };
      process.once('SIGTERM', () => {
        controller.abort();
        if (timer) clearInterval(timer);
        server.close();
      });
      server.once('listening', () => {
        const receiver = integrated
          ? { ...options, expectedBot, onListening: options.capture && startCapture,
            dispatchMessage: workflowDispatcher(workflowUrl, relayKey) }
          : options;
        pollCallbacks(receiver, controller.signal).catch(failure => {
          if (controller.signal.aborted) return;
          controller.abort();
          if (timer) clearInterval(timer);
          const reason = {
            webhook_active: 'el bot tiene un webhook activo',
            telegram_consumer_conflict: 'Telegram detectó otro consumidor para el bot',
          }[failure.message] ?? 'no se pudo verificar el bot';
          console.error('Recepción detenida: ' + reason);
        });
      });
    }
    if (!seed) {
      server.on('error', () => {
        console.error('No se pudo iniciar el servicio Telegram.');
        process.exitCode = 1;
      });
      server.listen(8080, '0.0.0.0');
    }
  } catch {
    console.error('No se pudo configurar Telegram Relay o crear el registro de prueba.');
    process.exitCode = 1;
  }
}

module.exports = { createRelay, telegramCaller, workflowDispatcher };
