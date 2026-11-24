const { randomBytes } = require('node:crypto');
const { readFileSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');
const { atomicWrite, classifyRecord, readRecord, saveRecord } = require('./editorial.cjs');
const { deliverRecordReply } = require('./intake.cjs');

const MAX_ATTEMPTS = 3;
const MAX_BYTES = 20 * 1024 * 1024;

function readState(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { active: null, sessions: {}, updates: {} };
  }
}

function classifyMaterial(update) {
  const m = update.message;
  const photo = Array.isArray(m.photo) ? m.photo.at(-1) : null;
  const audioDocument = /^audio\//i.test(m.document?.mime_type ?? '')
    || /\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav)$/i.test(m.document?.file_name ?? '');
  const audio = m.audio ?? (audioDocument ? m.document : null);
  const media = photo ?? m.voice ?? audio;
  const type = photo ? 'photo' : m.voice ? 'voice' : audio ? 'audio' : 'text';
  if (media ? typeof media.file_id !== 'string' || !media.file_id : typeof m.text !== 'string') return null;
  return {
    type,
    update_id: update.update_id,
    message_id: m.message_id,
    received_at: new Date(m.date * 1000).toISOString(),
    text: type === 'text' ? m.text : (m.caption ?? ''),
    ...(media && {
      telegram_media: {
        file_id: media.file_id, file_unique_id: media.file_unique_id, size: media.file_size,
        mime_type: media.mime_type, original_name: media.file_name, duration_seconds: media.duration,
        width: media.width, height: media.height, title: media.title, performer: media.performer,
        thumbnail: media.thumbnail,
        ...(media === m.document && { as_document: true }),
        ...(photo && { variants: m.photo }),
      },
    }),
    ...(typeof m.media_group_id === 'string' && { album_id: m.media_group_id }),
  };
}

function createCapture(options) {
  const {
    sessions, records, incoming, projects, allowedChats, allowedUsers, botUsername,
    callTelegram, fetchMedia, transcribe, log = () => {},
    now = Date.now, idleMs = 90000, maxMs = 600000, retryMs = 10000,
  } = options;
  if (![idleMs, maxMs, retryMs].every(x => Number.isSafeInteger(x) && x > 0)) {
    throw new Error('invalid_capture_window');
  }
  let busy = false;
  const permitted = (chat, user) => Number.isSafeInteger(user) && user > 0
    && allowedChats.has(chat) && (allowedUsers ? allowedUsers.has(user) : chat === user);
  const actor = (chat, user) => join(sessions, chat + '_' + user + '.json');

  function edit(path, change) {
    const state = readState(path);
    const result = change(state);
    atomicWrite(path, JSON.stringify(state) + '\n');
    return result;
  }

  function close(state, session, time) {
    state.active = null;
    session.status = session.materials.length ? 'SEALED' : 'CANCELLED';
    session.closed_at = time;
  }

  function expire(state, time) {
    const active = state.sessions[state.active];
    if (active && !active.explicit && time >= Math.min(active.expires_at, active.started_at + maxMs)) {
      close(state, active, time);
    }
  }

  function ingest(update) {
    const m = update?.message;
    const chat = m?.chat?.id;
    const user = m?.from?.id;
    const content_id = 'tg-' + update?.update_id;
    if (!permitted(chat, user) || !Number.isSafeInteger(update.update_id) || update.update_id < 0
      || !Number.isSafeInteger(m.message_id) || m.message_id <= 0 || !Number.isSafeInteger(m.date)
      || m.date < 0 || m.date > 8640000000000 || (m.caption != null && typeof m.caption !== 'string')) {
      return { status: 'IGNORED' };
    }
    // A retry after rolling forward from 4.0 must never create a second record.
    if (readRecord(records, content_id)) return { status: 'IGNORED' };
    const command = typeof m.text === 'string'
      ? m.text.match(/^\/(nuevo|listo|cancelar)(?:@([A-Za-z0-9_]+))?\s*$/i) : null;
    if (command?.[2] && command[2].toLowerCase() !== botUsername?.toLowerCase()) return { status: 'IGNORED' };
    const material = command ? null : classifyMaterial(update);
    return edit(actor(chat, user), state => {
      const key = String(m.message_id);
      const previous = state.updates[key];
      if (previous) return { status: 'CAPTURE', content_id, notice: previous.sent ? undefined : previous.notice };
      const time = now();
      expire(state, time);
      let active = state.sessions[state.active];
      const open = explicit => {
        const id = 'mm-' + randomBytes(10).toString('hex');
        const session = { id, chat, user, explicit, status: 'OPEN', started_at: time, materials: [] };
        state.sessions[id] = session;
        state.active = id;
        return session;
      };
      let notice;
      switch (command?.[1].toLowerCase()) {
        case 'nuevo':
          if (active) {
            active.explicit = true;
            notice = 'La captura actual sigue abierta hasta /listo.';
          } else {
            open(true);
            notice = 'Captura abierta. Usá /listo al terminar.';
          }
          break;
        case 'cancelar':
          if (active) {
            active.status = 'CANCELLED';
            active.closed_at = time;
            state.active = null;
          }
          notice = active ? 'Captura cancelada.' : 'No hay una captura abierta.';
          break;
        case 'listo': {
          if (active) {
            close(state, active, time);
            notice = active.materials.length ? 'Captura cerrada. Estoy preparando el material.' : 'La captura estaba vacía.';
          } else {
            const failed = Object.values(state.sessions).findLast(session => session.status === 'FAILED');
            if (failed) {
              failed.status = 'SEALED';
              failed.attempts = 0;
              delete failed.retry_at;
              notice = 'Reintentando la captura anterior.';
            } else notice = 'No hay una captura abierta.';
          }
          break;
        }
        default:
          if (!material) {
            notice = 'Enviá texto, fotos, notas de voz o archivos de audio.';
            break;
          }
          active ??= open(false);
          if (!active.materials.length) notice = 'Material recibido. Podés agregar más o usar /listo.';
          active.materials.push(material);
          active.expires_at = time + idleMs;
      }
      state.updates[key] = { notice, sent: false };
      return { status: 'CAPTURE', content_id, notice };
    });
  }

  function markNotice(update) {
    const m = update.message;
    edit(actor(m.chat.id, m.from.id), state => {
      if (state.updates[m.message_id]) state.updates[m.message_id].sent = true;
    });
  }

  function updateSession(path, id, change) {
    return edit(path, state => change(state.sessions[id]));
  }

  async function downloadMaterial(path, session, index, stop) {
    const item = session.materials[index];
    if (!item.telegram_media || item.media_path) return;
    try {
      if (item.telegram_media.size > MAX_BYTES) throw new Error('media_too_large');
      const file = await callTelegram('getFile', { file_id: item.telegram_media.file_id }, 5000, stop);
      const extension = item.type === 'photo' ? '.jpg'
        : (file?.file_path?.match(/\.[A-Za-z0-9]{1,8}$/)?.[0]?.toLowerCase() ?? '.audio');
      const filename = session.id + '-' + item.message_id + extension;
      const bytes = await fetchMedia(file?.file_path, stop);
      stop?.throwIfAborted();
      atomicWrite(join(incoming, filename), bytes);
      updateSession(path, session.id, current => Object.assign(current.materials[index], {
        media_path: '/files/incoming/' + filename, persisted_bytes: statSync(join(incoming, filename)).size, error: null,
      }));
    } catch {
      stop?.throwIfAborted();
      updateSession(path, session.id, current => { current.materials[index].error = 'download_failed'; });
      throw new Error('download_failed');
    }
  }

  async function transcribeMaterial(path, session, index, stop) {
    const item = session.materials[index];
    if (!['voice', 'audio'].includes(item.type) || item.transcription) return;
    try {
      if (!transcribe) throw new Error('provider_unconfigured');
      const filename = item.media_path.split('/').at(-1);
      const result = await transcribe(readFileSync(join(incoming, filename)), stop);
      stop?.throwIfAborted();
      if (typeof result?.text !== 'string' || !result.text.trim()) throw new Error('no_recognized_speech');
      updateSession(path, session.id, current => Object.assign(current.materials[index], {
        transcription: { ...result, text: result.text.trim(), language: 'es' }, error: null,
      }));
    } catch {
      stop?.throwIfAborted();
      updateSession(path, session.id, current => { current.materials[index].error = 'transcription_failed'; });
      throw new Error('transcription_failed');
    }
  }

  async function processSession(path, session, stop) {
    let record = readRecord(records, session.id);
    if (!record) {
      let downloadError;
      for (let index = 0; index < session.materials.length; index++) {
        await downloadMaterial(path, session, index, stop).catch(error => {
          stop?.throwIfAborted();
          downloadError = error;
        });
      }
      if (downloadError) throw downloadError;
      const downloaded = readState(path).sessions[session.id];
      for (let index = 0; index < downloaded.materials.length; index++) await transcribeMaterial(path, downloaded, index, stop);
      stop?.throwIfAborted();
      const materials = readState(path).sessions[session.id].materials;
      const instruction = [
        ...materials.map(item => item.text).filter(x => x.trim()),
        ...materials.map(item => item.transcription?.text).filter(Boolean),
      ].join('\n');
      const first = materials[0];
      record = classifyRecord({
        content_id: session.id,
        source: 'telegram',
        type: 'multimodal',
        capture_contract_version: '1.0',
        chat_id: session.chat,
        user_id: session.user,
        message_id: first.message_id,
        received_at: first.received_at,
        instruction,
        media_path: materials.find(item => item.type === 'photo')?.media_path ?? null,
        project: null, project_id: null, profile_version: null,
        capture: { mode: session.explicit ? 'explicit' : 'automatic', closed_at: new Date(session.closed_at).toISOString(), materials },
      }, projects);
      saveRecord(records, record, true);
    }
    try {
      await deliverRecordReply(record, options, stop);
    } catch {
      throw new Error('delivery_failed');
    }
    updateSession(path, session.id, current => { current.status = 'DONE'; delete current.error; });
  }

  async function tick(stop) {
    if (stop?.aborted) return;
    const time = now();
    const jobs = [];
    for (const filename of readdirSync(sessions).filter(x => /^-?\d+_\d+\.json$/.test(x))) {
      const path = join(sessions, filename);
      let state = readState(path);
      const active = state.sessions[state.active];
      if (active && !active.explicit && time >= Math.min(active.expires_at, active.started_at + maxMs)) {
        edit(path, value => expire(value, time));
        state = readState(path);
      }
      for (const session of Object.values(state.sessions)) {
        if (session.status === 'SEALED' && (session.retry_at ?? 0) <= time) jobs.push({ path, session });
      }
    }
    if (busy || !jobs.length) return;
    busy = true;
    try {
      for (const { path, session } of jobs) {
        if (stop?.aborted) return;
        try {
          await processSession(path, session, stop);
        } catch (failure) {
          if (stop?.aborted) return;
          const terminal = updateSession(path, session.id, current => {
            current.error = ['download_failed', 'transcription_failed', 'delivery_failed'].includes(failure.message)
              ? failure.message : 'capture_failed';
            current.attempts = (current.attempts ?? 0) + 1;
            current.retry_at = now() + retryMs * current.attempts;
            if (current.attempts < MAX_ATTEMPTS) return false;
            current.status = 'FAILED';
            return true;
          });
          log('La captura tuvo un error recuperable.');
          if (terminal) {
            await callTelegram('sendMessage', {
              chat_id: session.chat,
              text: 'No pude terminar la captura. El material se conserva. Usá /listo para reintentar.',
            }, 5000, stop).catch(() => log('No se pudo avisar sobre la captura.'));
          }
        }
      }
    } finally {
      busy = false;
    }
  }

  return { ingest, markNotice, tick, permitted };
}

function httpTranscriber(url, fetchAudio = fetch) {
  return async (audio, stop) => {
    const timeout = AbortSignal.timeout(20 * 60 * 1000);
    const response = await fetchAudio(url, {
      method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: audio,
      signal: stop ? AbortSignal.any([stop, timeout]) : timeout, redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('transcriber_unavailable');
    }
    const { text, model } = await response.json();
    return { text, provider: 'local-http', ...(model && { model }) };
  };
}

module.exports = { createCapture, httpTranscriber };
