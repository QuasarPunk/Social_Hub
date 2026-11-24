const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const { once } = require('node:events');
const { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { promisify } = require('node:util');
const { createRelay, telegramCaller, workflowDispatcher } = require('../services/telegram-relay/server.cjs');
const { createIntake, downloadPhoto } = require('../services/telegram-relay/intake.cjs');
const { createCapture } = require('../services/telegram-relay/capture.cjs');
const { loadProjects, pollCallbacks } = require('../services/telegram-relay/callbacks.cjs');
const { integratedDrafts } = require('../scripts/telegram-workflows.cjs');

const run = promisify(execFile);
const root = mkdtempSync(join(tmpdir(), 'social-hub-editorial-'));
const records = join(root, 'records');
const incoming = join(root, 'incoming');
const profiles = join(root, 'projects');
const credential = { id: 'StageFourSmokeAuth', name: 'Header Auth ficticia' };
const entryId = 'StageFourSmokeEntry';
const classificationId = 'StageFourSmokeClass';
const relayKey = 'c'.repeat(64);
const token = '123456:FAKE_ONLY';
const n8n = 'http://127.0.0.1:5678';
const workflowUrl = n8n + '/webhook/social-hub/telegram-intake';
const chat = 123456789;
const allowedChats = new Set([chat]);
const photoBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const telegramEvents = [];
let child;
let relay;
let n8nLog = '';

const env = {
  ...process.env,
  N8N_USER_FOLDER: root,
  N8N_ENCRYPTION_KEY: 'isolated-fake-key',
  N8N_DIAGNOSTICS_ENABLED: 'false',
  N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
  N8N_PERSONALIZATION_ENABLED: 'false',
  N8N_LISTEN_ADDRESS: '127.0.0.1',
};

async function startN8n() {
  n8nLog = '';
  child = spawn('n8n', ['start'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const output of [child.stdout, child.stderr]) output.on('data', chunk => { n8nLog = (n8nLog + chunk).slice(-4000); });
  for (let attempt = 0; attempt < 120 && child.exitCode === null; attempt++) {
    const ready = await fetch(n8n + '/healthz/readiness', { signal: AbortSignal.timeout(500) }).catch(() => null);
    if (ready?.ok) {
      const hook = await fetch(workflowUrl, { method: 'POST', signal: AbortSignal.timeout(1000) }).catch(() => null);
      await hook?.body?.cancel();
      if (hook && hook.status !== 404) return hook.status;
    }
    await delay(500);
  }
  throw new Error('n8n aislado no inició: ' + n8nLog);
}

async function stopN8n() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}

function telegramMock(batches, controller, { webhook = '', conflict = false } = {}) {
  const offsets = [];
  const messages = [];
  const answers = [];
  const files = [];
  const api = async (url, options) => {
    const apiPrefix = 'https://api.telegram.org/bot' + token + '/';
    if (url === 'https://api.telegram.org/file/bot' + token + '/photos/test.jpg') return new Response(photoBytes);
    assert.ok(url.startsWith(apiPrefix), 'destino de Telegram inesperado');
    const method = url.slice(apiPrefix.length);
    const payload = JSON.parse(options.body);
    let result;
    switch (method) {
      case 'getMe':
        result = { username: 'Test_Social_Hub_bot' };
        break;
      case 'getWebhookInfo':
        result = { url: webhook };
        break;
      case 'getUpdates':
        assert.deepEqual(payload.allowed_updates, ['message', 'callback_query']);
        if (conflict) return Response.json({ ok: false }, { status: 409 });
        offsets.push(payload.offset);
        if (!batches.length) controller.abort();
        result = batches.shift() ?? [];
        break;
      case 'getFile':
        files.push(payload.file_id);
        result = { file_path: 'photos/test.jpg' };
        break;
      case 'sendMessage':
        messages.push(payload);
        result = { message_id: 1000 + telegramEvents.length };
        telegramEvents.push(method);
        break;
      case 'answerCallbackQuery':
        answers.push(payload.text);
        result = true;
        telegramEvents.push(method);
        break;
      default:
        assert.fail('método inesperado ' + method);
    }
    return Response.json({ ok: true, result });
  };
  return { api, offsets, files, messages, answers };
}

function fixture() {
  mkdirSync(records);
  mkdirSync(incoming);
  cpSync(join(__dirname, '..', 'projects'), profiles, { recursive: true });
  const newProfile = JSON.parse(readFileSync(join(profiles, 'quasarpunk', 'profile.json')));
  Object.assign(newProfile, { project_id: 'orion', name: 'Orión', aliases: ['observatorio', 'quasar'], profile_version: 7 });
  mkdirSync(join(profiles, 'orion'));
  const profilePath = join(profiles, 'orion', 'profile.json');
  writeFileSync(profilePath, JSON.stringify({ ...newProfile, profile_version: 0 }));
  assert.throws(() => loadProjects(profiles), { message: 'invalid_editorial_profile' });
  writeFileSync(profilePath, JSON.stringify(newProfile));
}

async function startRelay(mock, port = 0, captureConfig) {
  const options = { allowedChats, records, incoming, projects: loadProjects(profiles), callTelegram: telegramCaller(token, mock.api) };
  const fetchMedia = path => downloadPhoto(token, path, mock.api);
  const capture = captureConfig && createCapture({ ...options, fetchMedia, ...captureConfig });
  const intake = capture?.ingest ?? createIntake({ ...options, fetchPhoto: fetchMedia });
  relay = createRelay({ botToken: token, relayKey, allowedChats: [chat], intake });
  relay.listen(port, '127.0.0.1');
  await once(relay, 'listening');
  return { ...options, capture, log: () => {} };
}

async function stopRelay() {
  if (relay?.listening) await new Promise(resolve => relay.close(resolve));
}

function message(update_id, fields, chatId = chat) {
  return { update_id, message: { chat: { id: chatId }, message_id: update_id + 100, date: 1700000000, ...fields } };
}

function callback(update_id, data) {
  return { update_id, callback_query: { id: 'fake-' + update_id, data, message: { chat: { id: chat } } } };
}

function bytes(id) {
  return readFileSync(join(records, 'tg-' + id + '.json'));
}

function classified(id, project, version, method) {
  const record = JSON.parse(bytes(id));
  assert.equal(record.status, 'CLASSIFIED');
  assert.equal(record.classification_contract_version, '1.0');
  assert.equal(record.project_id, project);
  assert.equal(record.profile_version, version);
  assert.equal(record.editorial_profile.project_id, project);
  assert.equal(record.editorial_profile.profile_version, version);
  assert.equal(record.classification.method, method);
  assert.equal(record.clarification.required, false);
  assert.deepEqual(record.target_platforms, Object.keys(record.editorial_profile.platforms)
    .filter(name => record.editorial_profile.platforms[name].enabled));
  return record;
}

async function main() {
  fixture();
  const firstController = new AbortController();
  const ambiguous = message(5, { text: 'QuasarPunk y Radio Lamat' });
  const first = telegramMock([[
    message(1, { text: 'QP: placa de prueba, con Lamat de referencia' }),
    message(2, { text: 'Una grabación de RÁDIO Lamat.' }),
    message(3, { text: 'Material para BITÁCORA.' }),
    message(4, { caption: 'quasarpunk: foto', photo: [{ file_id: 'small' }, { file_id: 'large' }] }),
    ambiguous,
    message(6, { text: 'observatorio: primer registro' }),
    message(7, { text: 'Un texto sin proyecto' }),
    message(8, { text: 'qp: chat ajeno' }, 987654321),
  ]], firstController);
  const options = await startRelay(first);
  const port = relay.address().port;
  const relayUrl = 'http://127.0.0.1:' + port;
  const { stdout } = await run('n8n', ['--version'], { env });
  assert.equal(stdout.trim(), '2.48.6');
  const save = (name, value) => {
    const path = join(root, name + '.json');
    writeFileSync(path, JSON.stringify(value));
    return path;
  };
  await run('n8n', ['import:credentials', '--input', save('auth', [{
    ...credential, type: 'httpHeaderAuth', data: { name: 'Authorization', value: 'Bearer ' + relayKey },
  }])], { env });
  await run('n8n', ['import:workflow', '--input', save('workflows', integratedDrafts({ credential, entryId, classificationId, relayUrl }))], { env });
  await run('n8n', ['publish:workflow', '--id', classificationId], { env });
  await run('n8n', ['publish:workflow', '--id', entryId], { env });
  const unauthorized = await startN8n();

  const dispatchMessage = workflowDispatcher(workflowUrl, relayKey);
  assert.ok([401, 403].includes(unauthorized), 'SH-01 debe exigir Header Auth');
  const relayUnauthorized = await fetch(relayUrl + '/classify', { method: 'POST' });
  assert.equal(relayUnauthorized.status, 401);
  // Fail fast on workflow errors before the receiver's production retry loop.
  const classifiedOutput = await dispatchMessage(message(1, { text: 'QP: placa de prueba, con Lamat de referencia' }));
  assert.equal(classifiedOutput.project_id, 'quasarpunk');
  await pollCallbacks({ ...options, dispatchMessage }, AbortSignal.any([firstController.signal, AbortSignal.timeout(30000)]));
  assert.deepEqual(first.offsets, [undefined, 9]);
  const automatic = classified(1, 'quasarpunk', 1, 'explicit_prefix');
  classified(2, 'lamat', 1, 'alias_match');
  classified(3, 'bitacora', 1, 'alias_match');
  const photo = classified(4, 'quasarpunk', 1, 'explicit_prefix');
  assert.equal(photo.type, 'photo');
  assert.equal(photo.media_path, '/files/incoming/tg-4.jpg');
  assert.deepEqual(first.files, ['large']);
  assert.deepEqual(readFileSync(join(incoming, 'tg-4.jpg')), photoBytes);
  const pending = JSON.parse(bytes(5));
  assert.equal(pending.status, 'PENDING_CLASSIFICATION');
  assert.equal(pending.classification.status, 'AMBIGUOUS');
  assert.deepEqual(first.messages[4].reply_markup.inline_keyboard, [
    [{ text: 'Ecoaldea Lamat', callback_data: 'sh:tg-5:lamat' }],
    [{ text: 'QuasarPunk', callback_data: 'sh:tg-5:quasarpunk' }],
  ]);
  classified(6, 'orion', 7, 'explicit_prefix');
  assert.ok(first.messages[6].reply_markup.inline_keyboard.flat().some(button => button.callback_data === 'sh:tg-7:orion'));
  assert.equal(first.messages.length, 7);
  assert.throws(() => bytes(8), { code: 'ENOENT' });

  await stopN8n();
  await stopRelay();
  const secondController = new AbortController();
  const second = telegramMock([[
    ambiguous, callback(9, 'sh:tg-5:orion'), callback(10, 'sh:../tg-5:lamat'),
    callback(11, 'sh:tg-5:quasarpunk'), callback(12, 'sh:tg-5:lamat'), callback(13, 'sh:tg-5:quasarpunk'),
  ]], secondController);
  const restarted = await startRelay(second, port);
  await startN8n();
  await pollCallbacks({ ...restarted, dispatchMessage }, AbortSignal.any([secondController.signal, AbortSignal.timeout(30000)]));
  assert.deepEqual(second.offsets, [undefined, 14]);
  assert.deepEqual(second.messages, [], 'el mensaje reenviado no debe duplicar el teclado');
  assert.deepEqual(second.answers, [
    'Proyecto no disponible.', 'Selección inválida.', 'Clasificado en QuasarPunk',
    'Ya clasificado: QuasarPunk', 'Ya clasificado: QuasarPunk',
  ]);
  assert.deepEqual(classified(1, 'quasarpunk', 1, 'explicit_prefix'), automatic);
  const manual = classified(5, 'quasarpunk', 1, 'telegram_selection');
  assert.deepEqual(Object.keys(manual).sort(), Object.keys(automatic).sort());
  const saved = bytes(5);
  assert.equal((await dispatchMessage(ambiguous)).project_id, 'quasarpunk');
  assert.deepEqual(bytes(5), saved, 'un mensaje repetido no debe reescribir la clasificación manual');
  assert.deepEqual(readFileSync(join(incoming, 'tg-4.jpg')), photoBytes);

  for (const [override, error] of [[{ webhook: 'https://example.invalid/webhook' }, 'webhook_active'],
    [{ conflict: true }, 'telegram_consumer_conflict']]) {
    const controller = new AbortController();
    const mock = telegramMock([], controller, override);
    await assert.rejects(pollCallbacks({
      ...restarted, dispatchMessage, callTelegram: telegramCaller(token, mock.api),
    }, controller.signal), { message: error });
  }
  console.log('n8n 2.48.6: SH-01 y SH-02, clasificación automática/manual, foto, perfiles dinámicos, reinicio, idempotencia y consumidor exclusivo verificados.');

  await stopRelay();
  const sessions = join(root, 'sessions');
  mkdirSync(sessions);
  const captureController = new AbortController();
  const asOwner = fields => ({ from: { id: chat }, ...fields });
  const batches = [[
    message(30, asOwner({ text: '/nuevo' })),
    message(31, asOwner({ caption: 'QuasarPunk', photo: [{ file_id: 'photo' }], media_group_id: 'fake-album' })),
    message(32, asOwner({ voice: { file_id: 'voice', duration: 40 } })),
    message(33, asOwner({ text: '/listo' })),
  ]];
  const captureMock = telegramMock(batches, captureController);
  const multimodal = await startRelay(captureMock, port, {
    sessions,
    async transcribe(audio) {
      assert.deepEqual(audio, photoBytes);
      return { text: 'Grabación de Radio Lamat', provider: 'fixture' };
    },
  });
  await pollCallbacks({ ...multimodal, dispatchMessage }, AbortSignal.any([captureController.signal, AbortSignal.timeout(30000)]));
  assert.equal(captureMock.messages.length, 3);
  assert.equal(readdirSync(records).filter(name => name.startsWith('mm-')).length, 0);
  await multimodal.capture.tick();
  const [multimodalFile] = readdirSync(records).filter(name => name.startsWith('mm-'));
  const grouped = JSON.parse(readFileSync(join(records, multimodalFile)));
  const button = captureMock.messages.at(-1).reply_markup.inline_keyboard.flat().find(x => x.callback_data.endsWith(':lamat'));
  assert.equal(grouped.status, 'PENDING_CLASSIFICATION');
  assert.deepEqual(grouped.capture.materials.map(x => x.type), ['photo', 'voice']);
  assert.equal(grouped.capture.materials[1].transcription.provider, 'fixture');
  assert.ok(grouped.capture.materials.every(x => readFileSync(join(incoming, x.media_path.split('/').at(-1))).equals(photoBytes)));
  await stopRelay();
  const manualController = new AbortController();
  const selection = callback(34, button.callback_data);
  selection.callback_query.from = { id: chat };
  const manualMock = telegramMock([[selection]], manualController);
  const recovered = await startRelay(manualMock, port, { sessions });
  await pollCallbacks({ ...recovered, dispatchMessage }, AbortSignal.any([manualController.signal, AbortSignal.timeout(30000)]));
  assert.deepEqual(manualMock.answers, ['Clasificado en Ecoaldea Lamat']);
  const distributed = JSON.parse(readFileSync(join(records, multimodalFile)));
  assert.equal(distributed.classification_contract_version, '1.0');
  assert.equal(distributed.capture_contract_version, '1.0');
  assert.equal(distributed.project_id, 'lamat');
  assert.deepEqual(distributed.capture, grouped.capture);
  assert.deepEqual(bytes(5), saved);
  console.log('n8n 2.48.6: captura multimodal, transcripción simulada, teclado y reinicio verificados.');
}

main().catch(failure => {
  for (const detail of [failure.stack, failure.stdout, failure.stderr]) if (detail) console.error(detail);
  if (n8nLog) console.error(n8nLog);
  process.exitCode = 1;
}).finally(async () => {
  await stopN8n();
  await stopRelay();
  rmSync(root, { recursive: true, force: true });
});
