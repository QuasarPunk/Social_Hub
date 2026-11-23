const assert = require('node:assert/strict');
const { once } = require('node:events');
const { Readable } = require('node:stream');
const test = require('node:test');
const vm = require('node:vm');
const { createRelay } = require('../services/telegram-relay/server.cjs');
const workflow = require('../workflows/SH-01-telegram-servicio-prueba.json');
const original = require('../workflows/SH-01-telegram-teclado-prueba.json');

const botToken = '123456:TEST_ONLY_NOT_A_TELEGRAM_TOKEN';
const relayKey = 'a'.repeat(64);
const allowedChats = ['123456789', '-1001234567890'];
const headers = { authorization: `Bearer ${relayKey}`, 'content-type': 'application/json' };
const send = workflow.nodes.find(node => node.name === 'Enviar seleccion de proyecto');
const prepare = workflow.nodes.find(node => node.name === 'Preparar botones de proyectos');
const fixture = JSON.parse(workflow.nodes.find(node => node.name === 'Simular clasificacion pendiente').parameters.jsonOutput);
const [{ json }] = vm.runInNewContext(`(function () { ${prepare.parameters.jsCode} })()`, {
  Buffer,
  $input: { first: () => ({ json: fixture }) },
});
const payload = JSON.parse(JSON.stringify(vm.runInNewContext(send.parameters.jsonBody.slice(3, -2), { $json: json })));

async function start(t, fetchTelegram, timeoutMs) {
  const server = createRelay({ botToken, relayKey, allowedChats, fetchTelegram, timeoutMs });
  server.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (options = {}, path = '/sendMessage') => {
    const response = await fetch(base + path, {
      method: 'POST', headers, body: JSON.stringify(payload), ...options,
    });
    const body = await response.text();
    assert.ok(!body.includes(botToken) && !body.includes(relayKey));
    return [response.status, JSON.parse(body)];
  };
}

test('el borrador envía las tres filas generadas por SH-01 sin referencias de instancia', async t => {
  assert.equal(workflow.active, false);
  assert.deepEqual(workflow.pinData, {});
  assert.ok(workflow.nodes.every(node => !node.credentials && !node.webhookId));
  assert.equal(send.type, 'n8n-nodes-base.httpRequest');
  assert.equal(send.parameters.genericAuthType, 'httpHeaderAuth');
  assert.equal(send.parameters.url, 'http://telegram-relay:8080/sendMessage');
  assert.equal(workflow.connections[prepare.name].main[0][0].node, send.name);
  assert.deepEqual(prepare.parameters, original.nodes.find(node => node.name === prepare.name).parameters);

  const received = [];
  const post = await start(t, async (url, options) => {
    received.push([url, options]);
    return Response.json({ ok: true, result: { message_id: 7, text: botToken, chat: { id: fixture.chat_id } } });
  });
  assert.deepEqual(await post(), [200, { ok: true, message_id: 7 }]);
  const multiButton = {
    ...payload,
    chat_id: allowedChats[1],
    reply_markup: { inline_keyboard: [payload.reply_markup.inline_keyboard.flat()] },
  };
  assert.deepEqual(await post({ body: JSON.stringify(multiButton) }), [200, { ok: true, message_id: 7 }]);
  const maxCallback = { text: 'X', callback_data: 'é'.repeat(32) };
  const atLimit = { ...payload, reply_markup: { inline_keyboard: [[maxCallback]] } };
  assert.deepEqual(await post({ body: JSON.stringify(atLimit) }), [200, { ok: true, message_id: 7 }]);
  const [[url, options], [, second], [, third]] = received;
  assert.equal(url, `https://api.telegram.org/bot${botToken}/sendMessage`);
  assert.equal(options.method, 'POST');
  assert.equal(options.redirect, 'error');
  assert.deepEqual(Object.keys(options.headers), ['content-type']);
  assert.deepEqual(JSON.parse(options.body), payload);
  assert.deepEqual(payload.reply_markup.inline_keyboard.map(row => row[0].text), ['Bitácora', 'Ecoaldea Lamat', 'QuasarPunk']);
  assert.deepEqual(JSON.parse(second.body), { ...multiButton, chat_id: Number(allowedChats[1]) });
  assert.deepEqual(JSON.parse(third.body), atLimit);
});

test('rechaza claves, métodos, rutas, formatos, chats y teclados inválidos antes de llamar a Telegram', async t => {
  let calls = 0;
  const post = await start(t, () => { calls++; });
  const checks = [
    [{ headers: {} }, '/sendMessage', 401, 'unauthorized'],
    [{ headers: { ...headers, authorization: 'Bearer wrong' } }, '/sendMessage', 401, 'unauthorized'],
    [{}, '/answerCallbackQuery', 404, 'not_found'],
    [{}, '/sendMessage?query=1', 404, 'not_found'],
    [{ method: 'GET', body: undefined }, '/sendMessage', 405, 'method_not_allowed'],
    [{ headers: { ...headers, 'content-type': 'text/plain' } }, '/sendMessage', 415, 'unsupported_content_type'],
    [{ body: '{' }, '/sendMessage', 400, 'invalid_json'],
    [{ body: Buffer.from([0xff]) }, '/sendMessage', 400, 'invalid_json'],
    [{ body: 'x'.repeat(65537) }, '/sendMessage', 413, 'body_too_large'],
    [{ body: Readable.from([Buffer.alloc(32768), Buffer.alloc(32769)]), duplex: 'half' }, '/sendMessage', 413, 'body_too_large'],
    [{ body: JSON.stringify({ ...payload, chat_id: 42 }) }, '/sendMessage', 403, 'chat_not_allowed'],
  ];
  for (const [options, path, status, error] of checks) {
    assert.deepEqual(await post(options, path), [status, { ok: false, error }]);
  }
  for (const invalid of [
    null, { ...payload, chat_id: '@channel' }, { ...payload, text: ' ' },
    { ...payload, text: 'x'.repeat(4097) }, { ...payload, parse_mode: 'HTML' },
    ...[[], [[]], [[{ text: 'X', url: 'https://example.com' }]], [[{ text: 'X', callback_data: 'é'.repeat(33) }]]]
      .map(inline_keyboard => ({ ...payload, reply_markup: { inline_keyboard } })),
  ]) {
    assert.deepEqual(await post({ body: JSON.stringify(invalid) }), [400, { ok: false, error: 'invalid_message' }]);
  }
  assert.equal(calls, 0);
});

test('devuelve errores de Telegram saneados y realiza un solo intento por solicitud', async t => {
  const replies = [
    () => new Response(botToken, { status: 429 }),
    () => new Response(botToken, { status: 503 }),
    () => Response.json({ ok: false, description: botToken }),
    () => new Response(botToken),
    () => Response.json({ ok: true, result: { message_id: botToken } }),
    () => { throw new Error(botToken); },
  ];
  const post = await start(t, () => replies.shift()());
  for (const error of [
    'telegram_http_error', 'telegram_http_error', 'telegram_rejected',
    'telegram_invalid_response', 'telegram_invalid_response', 'telegram_unavailable',
  ]) {
    assert.deepEqual(await post(), [502, { ok: false, error }]);
  }
  assert.equal(replies.length, 0);
});

test('el timeout cubre tanto la conexión como la lectura del cuerpo de Telegram', async t => {
  function waitForAbort(signal) {
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }
  const connecting = await start(t, (_, { signal }) => waitForAbort(signal), 30);
  const reading = await start(t, (_, { signal }) => ({ ok: true, json: () => waitForAbort(signal) }), 30);
  for (const post of [connecting, reading]) {
    assert.deepEqual(await post(), [504, { ok: false, error: 'telegram_timeout' }]);
  }
});

test('el servicio exige una configuración válida al iniciar', () => {
  const config = { botToken, relayKey, allowedChats };
  for (const override of [{ botToken: '' }, { relayKey: 'weak' }, { allowedChats: [] }, { allowedChats: ['0'] }]) {
    assert.throws(() => createRelay({ ...config, ...override }), { message: 'invalid_configuration' });
  }
});
