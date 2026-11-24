const assert = require('node:assert/strict');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { loadProjects, pollCallbacks } = require('../services/telegram-relay/callbacks.cjs');
const { createCapture, httpTranscriber } = require('../services/telegram-relay/capture.cjs');
const { deliverIntakeReply } = require('../services/telegram-relay/intake.cjs');

const group = -123456789;
const alice = 111;
const bob = 222;
const projects = loadProjects(join(__dirname, '..', 'projects'));

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(join(tmpdir(), 'sh-capture-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dirs = Object.fromEntries(['sessions', 'records', 'incoming'].map(key => {
    const path = join(root, key);
    fs.mkdirSync(path);
    return [key, path];
  }));
  let time = 1700000000000;
  let nextId = 0;
  const downloads = [];
  const transcriptions = [];
  const sent = [];
  const acks = [];
  const options = {
    ...dirs, projects, allowedChats: new Set([group, alice]), allowedUsers: new Set([alice, bob]),
    now: () => time, idleMs: 90000, maxMs: 600000, retryMs: 50, botUsername: 'Test_Social_Hub_bot',
    async callTelegram(method, payload) {
      if (method === 'getFile') return { file_path: 'files/' + payload.file_id };
      if (method === 'answerCallbackQuery') { acks.push(payload.text); return true; }
      assert.equal(method, 'sendMessage');
      sent.push(payload);
      return { message_id: sent.length };
    },
    async fetchMedia(path) { downloads.push(path); return Buffer.from(path); },
    async transcribe(bytes) { transcriptions.push(String(bytes)); return { text: 'Una entrevista para Radio Lamat', provider: 'fixture' }; },
    ...overrides,
  };
  let capture = createCapture(options);
  const update = (data, user = alice, chat = group) => ({
    update_id: ++nextId, message: { chat: { id: chat }, from: { id: user }, message_id: nextId, date: 1700000000, ...data },
  });
  const send = async u => deliverIntakeReply(u, { ...options, capture, dispatchMessage: u => capture.ingest(u) });
  const readAll = dir => fs.readdirSync(dir).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(join(dir, name), 'utf8')));
  return {
    dirs, update, send, downloads, transcriptions, sent, acks, options,
    records: () => readAll(dirs.records),
    sessions: () => readAll(dirs.sessions).flatMap(state => Object.values(state.sessions)),
    save: (data, user, chat) => send(update(data, user, chat)),
    move: ms => { time += ms; }, tick: () => capture.tick(),
    restart: () => { capture = createCapture(options); },
    get capture() { return capture; },
  };
}

const photo = (name, caption, album) => ({
  photo: [{ file_id: 'small.jpg', width: 100 }, { file_id: name + '.jpg', width: 200 }],
  caption, media_group_id: album,
});
const voice = { voice: { file_id: 'voice.oga', file_unique_id: 'fake-audio', duration: 900, mime_type: 'audio/ogg' } };
const audio = { audio: { file_id: 'track.mp3', file_name: 'fixture.mp3', duration: 12, mime_type: 'audio/mpeg', title: 'Fixture' } };

for (const [name, messages, expected, kinds] of [
  ['texto individual', [{ text: 'QuasarPunk: texto' }], 'quasarpunk', ['text']],
  ['foto individual', [photo('photo', 'Bitácora: foto')], 'bitacora', ['photo']],
  ['nota de voz individual', [voice], 'lamat', ['voice']],
  ['foto seguida de audio', [photo('photo', 'imagen'), audio], 'lamat', ['photo', 'audio']],
  ['audio seguido de texto', [audio, { text: 'Lamat: materiales' }], 'lamat', ['audio', 'text']],
  ['audio enviado como archivo', [{ document: audio.audio }], 'lamat', ['audio']],
  ['álbum y fotos consecutivas', [photo('first', 'quasarpunk: fotos', 'album-falso'), photo('second', '', 'album-falso'), photo('third', '')], 'quasarpunk', ['photo', 'photo', 'photo']],
]) {
  test('captura y clasifica ' + name, async t => {
    const f = fixture(t);
    for (const message of messages) await f.save(message);
    assert.equal(f.sent.length, 1, 'una sola confirmación durante la captura');
    assert.equal(f.records().length, 0);
    assert.equal(f.transcriptions.length, 0);
    f.move(90000);
    await f.tick();
    const [record] = f.records();
    assert.equal(record.capture_contract_version, '1.0');
    assert.equal(record.classification_contract_version, '1.0');
    assert.equal(record.project_id, expected);
    assert.equal(record.profile_version, projects.get(expected).profile_version);
    assert.deepEqual(record.capture.materials.map(item => item.type), kinds);
    for (const item of record.capture.materials.filter(item => item.telegram_media)) {
      assert.ok(fs.existsSync(join(f.dirs.incoming, item.media_path.split('/').at(-1))));
      assert.ok(item.persisted_bytes > 0);
    }
    if (name.includes('álbum')) assert.deepEqual(record.capture.materials.map(x => x.album_id ?? null), ['album-falso', 'album-falso', null]);
    if (kinds.includes('audio')) {
      const item = record.capture.materials.find(x => x.type === 'audio');
      assert.equal(item.telegram_media.original_name, 'fixture.mp3');
      assert.equal(item.transcription.language, 'es');
      if (name.includes('como archivo')) assert.equal(item.telegram_media.as_document, true);
    }
  });
}

test('cada material reinicia la inactividad y el máximo cierra la automática', async t => {
  const f = fixture(t);
  await f.save({ text: 'QP: captura' });
  for (let step = 0; step < 7; step++) {
    f.move(80000);
    await f.tick();
    assert.equal(f.records().length, 0);
    await f.save({ text: 'material adicional' });
  }
  f.move(40000);
  await f.tick();
  assert.equal(f.records()[0].capture.materials.length, 8);
});

test('/nuevo conserva una captura explícita tras máximos y reinicios; /listo la finaliza una sola vez', async t => {
  const f = fixture(t);
  await f.save({ text: '/nuevo@Test_Social_Hub_bot' });
  await f.save(voice);
  f.move(30 * 60 * 1000);
  f.restart();
  await f.tick();
  assert.equal(f.records().length, 0);
  assert.equal(f.transcriptions.length, 0);
  const close = f.update({ text: '/listo' });
  await Promise.all([f.send(close), f.tick()]);
  f.restart();
  await f.send(close);
  await Promise.all([f.tick(), f.tick()]);
  assert.equal(f.records().length, 1);
  assert.equal(f.transcriptions.length, 1);
  assert.equal(f.records()[0].capture.mode, 'explicit');
});

test('/cancelar impide descarga, transcripción y clasificación', async t => {
  const f = fixture(t);
  await f.save({ text: '/nuevo' });
  await f.save(voice);
  await f.save({ text: '/cancelar' });
  f.move(120000);
  f.restart();
  await f.tick();
  assert.equal(f.sessions()[0].status, 'CANCELLED');
  assert.deepEqual([f.records().length, f.downloads.length, f.transcriptions.length], [0, 0, 0]);
});

test('aísla dos usuarios y dos chats, bloquea usuarios ajenos y conserva el registro histórico', async t => {
  const f = fixture(t);
  const old = f.update({ text: 'proyecto histórico' });
  const target = join(f.dirs.records, 'tg-' + old.update_id + '.json');
  const legacy = '{"status":"CLASSIFIED","project":"lamat"}';
  fs.writeFileSync(target, legacy);
  await f.send(old);
  for (const [user, chat, project] of [[alice, group, 'qp'], [bob, group, 'lamat'], [alice, alice, 'bitacora']]) {
    await f.save({ text: project + ': material' }, user, chat);
  }
  await f.save({ text: 'contenido ajeno' }, 333, group);
  await f.save({ text: 'chat ajeno' }, alice, 555);
  f.move(90000);
  f.restart();
  await f.tick();
  assert.equal(f.sessions().length, 3);
  assert.equal(f.records().length, 4);
  assert.equal(fs.readFileSync(target, 'utf8'), legacy);
});

test('duplicados tras reiniciar no duplican material ni confirmación', async t => {
  const f = fixture(t);
  const original = f.update(voice);
  await f.send(original);
  f.restart();
  await f.send({ ...original, update_id: 999 });
  assert.equal(f.sent.length, 1);
  f.move(90000);
  await f.tick();
  f.restart();
  await f.send(original);
  await f.tick();
  assert.equal(f.records().length, 1);
  assert.equal(f.records()[0].capture.materials.length, 1);
  assert.equal(f.sent.length, 2);
});

test('recupera una sesión automática abierta y respeta la inactividad al reiniciar', async t => {
  const f = fixture(t);
  await f.save({ text: 'lamat: captura' });
  f.move(50000);
  f.restart();
  await f.tick();
  assert.equal(f.records().length, 0);
  f.move(40000);
  await f.tick();
  assert.equal(f.records()[0].project_id, 'lamat');
});

test('reintenta descarga, conserva audio ante error de transcripción y permite /listo', async t => {
  let downloads = 0;
  let speech = false;
  const f = fixture(t, {
    async fetchMedia(path) {
      downloads++;
      if (downloads === 1) throw Error('simulated_disconnect');
      return Buffer.from(path);
    },
    async transcribe() {
      if (!speech) throw Error('simulated_timeout');
      return { text: 'Radio Lamat' };
    },
  });
  await f.save(voice);
  f.move(90000);
  await f.tick();
  assert.equal(f.sessions()[0].error, 'download_failed');
  f.move(50);
  await f.tick();
  assert.equal(f.sessions()[0].error, 'transcription_failed');
  assert.equal(fs.readdirSync(f.dirs.incoming).length, 1);
  f.move(100);
  await f.tick();
  assert.equal(f.sessions()[0].status, 'FAILED');
  assert.equal(f.records().length, 0);
  f.restart();
  speech = true;
  await f.save({ text: '/listo' });
  await f.tick();
  assert.equal(f.records()[0].project_id, 'lamat');
  assert.equal(downloads, 2);
});

test('el teclado de una captura agrupada solo lo resuelve su autor y conserva la primera elección', async t => {
  const f = fixture(t);
  await f.save(photo('first', 'QuasarPunk'));
  await f.save(voice);
  await f.save({ text: '/listo' });
  await f.tick();
  const [record] = f.records();
  assert.equal(record.status, 'PENDING_CLASSIFICATION');
  assert.equal(record.classification.status, 'AMBIGUOUS');
  const buttons = f.sent.at(-1).reply_markup.inline_keyboard.flat();
  assert.deepEqual(buttons.map(x => x.callback_data.split(':').at(-1)), ['lamat', 'quasarpunk']);
  const updates = [[bob, 'lamat'], [alice, 'quasarpunk'], [alice, 'lamat']].map(([id, project], index) => ({
    update_id: index + 50, callback_query: {
      id: 'fake-' + index, from: { id }, message: { chat: { id: group } }, data: 'sh:' + record.content_id + ':' + project,
    },
  }));
  const controller = new AbortController();
  const { callTelegram } = f.options;
  await pollCallbacks({
    ...f.options, capture: f.capture, log() {},
    async callTelegram(method, data) {
      if (method === 'getMe') return { username: 'Test_Social_Hub_bot' };
      if (method === 'getUpdates') {
        if (updates.length) return updates.splice(0);
        controller.abort();
        return [];
      }
      return callTelegram(method, data);
    },
  }, controller.signal);
  assert.deepEqual(f.acks, ['Selección no autorizada.', 'Clasificado en QuasarPunk', 'Ya clasificado: QuasarPunk']);
  assert.equal(f.records()[0].capture.materials.length, 2);
  assert.equal(f.records()[0].classification.method, 'telegram_selection');
});

test('el proveedor HTTP recibe el audio binario y rechaza un error del servicio', async () => {
  const fixture = Buffer.from('test audio');
  const provider = httpTranscriber('http://test.invalid/transcribe', async (url, request) => {
    assert.equal(url, 'http://test.invalid/transcribe');
    assert.equal(request.method, 'POST');
    assert.deepEqual(request.body, fixture);
    return Response.json({ text: 'Hola', model: 'base' });
  });
  assert.deepEqual(await provider(fixture), { provider: 'local-http', text: 'Hola', model: 'base' });
  const broken = httpTranscriber('http://test.invalid', async () => new Response(null, { status: 422 }));
  await assert.rejects(broken(fixture), /transcriber_unavailable/);
});

test('si el worker se detiene durante la transcripción, retoma el audio persistido al reiniciar', async t => {
  const stop = new AbortController();
  let attempts = 0;
  const f = fixture(t, {
    async transcribe() {
      if (++attempts === 1) stop.abort();
      return { text: 'Radio Lamat' };
    },
  });
  await f.save(voice);
  await f.save({ text: '/listo' });
  await f.capture.tick(stop.signal);
  assert.equal(f.sessions()[0].status, 'SEALED');
  assert.equal(f.records().length, 0);
  f.restart();
  await f.tick();
  assert.equal(attempts, 2);
  assert.equal(f.downloads.length, 1);
  assert.equal(f.records()[0].status, 'CLASSIFIED');
});
