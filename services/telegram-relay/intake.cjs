const { join, posix } = require('node:path');
const { classifyRecord, readRecord, saveRecord, atomicWrite } = require('./editorial.cjs');

const MAX_PHOTO = 20 * 1024 * 1024;

async function downloadPhoto(botToken, filePath, fetchTelegram = fetch) {
  if (typeof filePath !== 'string' || !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+$/.test(filePath)
    || ['.', '..'].includes(posix.basename(filePath))) throw new Error('invalid_photo_path');
  const response = await fetchTelegram('https://api.telegram.org/file/bot' + botToken + '/' + filePath, {
    redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_PHOTO) {
    await response.body?.cancel();
    throw new Error('photo_unavailable');
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > MAX_PHOTO) throw new Error('photo_too_large');
    chunks.push(chunk);
  }
  if (!length) throw new Error('empty_photo');
  return Buffer.concat(chunks);
}

function createIntake({ records, incoming, projects, allowedChats, callTelegram, fetchPhoto }) {
  const inFlight = new Map();
  async function store(update, message, contentId) {
    const chat = message.chat.id;
    const previous = readRecord(records, contentId);
    if (previous) {
      if (previous.chat_id !== chat || previous.message_id !== message.message_id) throw new Error('content_id_conflict');
      if (previous.status !== 'RECEIVED') return previous;
      const record = classifyRecord({
        ...previous,
        instruction: previous.instruction ?? '',
        project_id: null,
        profile_version: null,
      }, projects);
      saveRecord(records, record, false);
      return record;
    }

    const photo = Array.isArray(message.photo) ? message.photo.at(-1) : null;
    const type = photo?.file_id ? 'photo' : typeof message.text === 'string' ? 'text' : 'unsupported';
    if (type === 'unsupported') return { content_id: contentId, status: 'UNSUPPORTED' };
    const filename = contentId + '.jpg';
    if (type === 'photo') {
      const file = await callTelegram('getFile', { file_id: photo.file_id });
      atomicWrite(join(incoming, filename), await fetchPhoto(file?.file_path));
    }

    const record = classifyRecord({
      content_id: contentId,
      source: 'telegram',
      type,
      chat_id: chat,
      message_id: message.message_id,
      instruction: type === 'photo' ? (message.caption ?? '') : message.text,
      project: null,
      project_id: null,
      profile_version: null,
      file_id: photo?.file_id ?? null,
      media_path: type === 'photo' ? '/files/incoming/' + filename : null,
      received_at: new Date(message.date * 1000).toISOString(),
    }, projects);
    saveRecord(records, record, true);
    return record;
  }

  return async update => {
    const message = update?.message;
    const id = update?.update_id;
    if (!allowedChats.has(message?.chat?.id)) return { status: 'IGNORED' };
    if (!Number.isSafeInteger(id) || id < 0 || !Number.isSafeInteger(message.message_id)
      || !Number.isSafeInteger(message.date) || message.date < 0 || message.date > 8640000000000
      || (message.caption != null && typeof message.caption !== 'string')) return { status: 'IGNORED' };
    const contentId = 'tg-' + id;
    const existing = inFlight.get(contentId);
    if (existing) {
      await existing;
      return store(update, message, contentId);
    }
    const storing = store(update, message, contentId);
    inFlight.set(contentId, storing);
    try {
      return await storing;
    } finally {
      inFlight.delete(contentId);
    }
  };
}

async function deliverIntakeReply(update, { records, callTelegram, dispatchMessage }, signal) {
  const result = await dispatchMessage(update, signal);
  if (result?.status === 'IGNORED') return;
  const contentId = 'tg-' + update.update_id;
  const chatId = update.message.chat.id;
  if (result?.content_id !== contentId) throw new Error('invalid_workflow_response');
  if (result.status === 'UNSUPPORTED') {
    await callTelegram('sendMessage', { chat_id: chatId, text: 'Enviá texto o una fotografía.' }, 5000, signal);
    return;
  }
  const record = readRecord(records, contentId);
  if (!record || record.chat_id !== chatId || !['PENDING_CLASSIFICATION', 'CLASSIFIED'].includes(record.status)) {
    throw new Error('invalid_workflow_response');
  }
  if (record.telegram_reply_message_id != null) return;
  const payload = record.status === 'CLASSIFIED'
    ? { text: 'Material recibido. Clasificado en ' + (record.editorial_profile?.name ?? record.project ?? record.project_id) }
    : {
      text: 'Seleccioná el proyecto para ' + contentId + '.',
      reply_markup: { inline_keyboard: record.clarification.options.map(option => [{
        text: option.name, callback_data: 'sh:' + contentId + ':' + option.project_id,
      }]) },
    };
  const sent = await callTelegram('sendMessage', { chat_id: chatId, ...payload }, 5000, signal);
  if (!Number.isSafeInteger(sent?.message_id) || sent.message_id < 0) throw new Error('invalid_message_id');
  saveRecord(records, { ...record, telegram_reply_message_id: sent.message_id }, false);
}

module.exports = { createIntake, deliverIntakeReply, downloadPhoto };
