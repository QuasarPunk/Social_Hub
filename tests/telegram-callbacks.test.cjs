const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { loadProjects, seedRecord, pollCallbacks } = require('../services/telegram-relay/callbacks.cjs');

const projects = loadProjects(join(__dirname, '..', 'projects'));
const chat = -123456789;

function fixture(t) {
  const records = mkdtempSync(join(tmpdir(), 'sh-callbacks-'));
  t.after(() => rmSync(records, { recursive: true, force: true }));
  seedRecord(records, projects, chat);
  return { records, projects, allowedChats: new Set([chat, 111]), path: join(records, 'tg-1000.json') };
}

async function simulate(options, callbacks) {
  const controller = new AbortController();
  const acks = [];
  const logs = [];
  const polls = [];
  let polled = false;
  await pollCallbacks({
    ...options,
    log: line => logs.push(line),
    async callTelegram(method, payload) {
      if (method === 'getMe') return { username: 'Test_Social_Hub_bot' };
      if (method === 'answerCallbackQuery') {
        acks.push(payload);
        return true;
      }
      polls.push({ method, payload });
      if (polled) {
        controller.abort();
        return [];
      }
      polled = true;
      return callbacks.map((callback, index) => ({
        update_id: index + 1,
        callback_query: { id: `mock-${index}`, message: { chat: { id: chat } }, ...callback },
      }));
    },
  }, controller.signal);
  assert.deepEqual(polls.map(({ method, payload }) => [method, payload.allowed_updates, payload.offset]), [
    ['getUpdates', ['callback_query'], undefined],
    ['getUpdates', ['callback_query'], callbacks.length + 1],
  ]);
  assert.ok(logs.includes('Recepción de callback_query activa'));
  assert.equal(logs.filter(line => line === 'callback_query recibida').length, callbacks.length);
  return acks;
}

for (const [projectId, name] of [
  ['quasarpunk', 'QuasarPunk'], ['lamat', 'Ecoaldea Lamat'], ['bitacora', 'Bitácora'],
]) {
  test(`clasifica ${name}, contesta y conserva la primera elección tras reiniciar`, async t => {
    const options = fixture(t);
    const callback = { data: `sh:tg-1000:${projectId}` };
    const acks = await simulate(options, [callback, callback]);
    assert.deepEqual(acks, [
      { callback_query_id: 'mock-0', text: `Clasificado en ${name}` },
      { callback_query_id: 'mock-1', text: `Ya clasificado: ${name}` },
    ]);
    const saved = readFileSync(options.path, 'utf8');
    const record = JSON.parse(saved);
    assert.equal(record.status, 'CLASSIFIED');
    assert.equal(record.project_id, projectId);
    assert.equal(record.clarification.required, false);
    const [replay] = await simulate(options, [{ data: 'sh:tg-1000:lamat' }]);
    assert.equal(replay.text, `Ya clasificado: ${name}`);
    assert.throws(() => seedRecord(options.records, projects, chat), { code: 'EEXIST' });
    assert.equal(readFileSync(options.path, 'utf8'), saved);
  });
}

test('contesta selecciones rechazadas sin cambiar el registro', async t => {
  const options = fixture(t);
  const record = JSON.parse(readFileSync(options.path, 'utf8'));
  record.clarification.options = [{ project_id: 'lamat' }];
  const original = JSON.stringify(record);
  writeFileSync(options.path, original);
  const acks = await simulate(options, [
    { data: 'sh:tg-1000:lamat', message: { chat: { id: 222 } } },
    { data: 'sh:tg-1000:lamat', message: { chat: { id: 111 } } },
    { data: 'sh:../tg-1000:lamat' },
    { data: 'sh:tg-1000:inexistente' },
    { data: 'sh:tg-1000:quasarpunk' },
    { data: 'sh:missing:lamat' },
  ]);
  assert.deepEqual(acks.map(ack => ack.text), [
    'Chat no autorizado.', 'Contenido no disponible.', 'Selección inválida.',
    'Proyecto no disponible.', 'Proyecto no disponible.', 'Contenido no disponible.',
  ]);
  assert.equal(readFileSync(options.path, 'utf8'), original);
});

test('un token de otro bot detiene el receptor antes de consultar actualizaciones', async () => {
  await assert.rejects(pollCallbacks({
    async callTelegram(method) {
      assert.equal(method, 'getMe');
      return { username: 'otro_bot' };
    },
  }, new AbortController().signal), /unexpected_bot/);
});
