const { setTimeout: delay } = require('node:timers/promises');

const { slug, loadProjects, classifiedRecord, readRecord, saveRecord } = require('./editorial.cjs');
const { deliverIntakeReply } = require('./intake.cjs');
const callbackPattern = new RegExp(`^sh:(${slug}):(${slug})$`);

function seedRecord(directory, projects, chat) {
  const options = ['quasarpunk', 'lamat', 'bitacora'].map(id => {
    const profile = projects.get(id);
    if (!profile) throw new Error('missing_editorial_profile');
    return { project_id: id, name: profile.name };
  });
  saveRecord(directory, {
    content_id: 'tg-1000',
    chat_id: chat,
    status: 'PENDING_CLASSIFICATION',
    clarification: { required: true, options },
  }, true);
}

function classify(query, { allowedChats, records, projects, capture }) {
  const chat = query.message?.chat?.id;
  if (!allowedChats.has(chat)) return 'Chat no autorizado.';
  const data = query.data;
  const match = typeof data === 'string' && Buffer.byteLength(data) <= 64 && callbackPattern.exec(data);
  if (!match || match[0] !== data) return 'Selección inválida.';
  const [, contentId, projectId] = match;
  const record = readRecord(records, contentId);
  if (record?.content_id !== contentId || record.chat_id !== chat) return 'Contenido no disponible.';
  if (record.user_id != null && (query.from?.id !== record.user_id
    || (capture && !capture.permitted(chat, query.from.id)))) return 'Selección no autorizada.';
  const project = projects.get(projectId);
  if (!project) return 'Proyecto no disponible.';
  if (record.status === 'CLASSIFIED') {
    return `Ya clasificado: ${record.editorial_profile?.name ?? projects.get(record.project_id)?.name ?? record.project_id}`;
  }
  if (record.status !== 'PENDING_CLASSIFICATION' || record.clarification?.required !== true) {
    return 'El contenido no está pendiente.';
  }
  if (!record.clarification.options?.some(option => option.project_id === projectId)) {
    return 'Proyecto no disponible.';
  }

  saveRecord(records, classifiedRecord(record, project, 'telegram_selection'), false);
  return `Clasificado en ${project.name}`;
}

async function handleCallback(query, options) {
  const { callTelegram, log } = options;
  log('callback_query recibida');
  if (typeof query.id !== 'string' || !query.id) return;
  let text;
  try {
    text = classify(query, options);
  } catch {
    log('No se pudo actualizar el registro');
    text = 'No se pudo guardar la selección. Intentá de nuevo.';
  }
  try {
    const result = await callTelegram('answerCallbackQuery', {
      callback_query_id: query.id, text: [...text].slice(0, 200).join(''),
    });
    if (result !== true) throw new Error('invalid_callback_response');
    log('answerCallbackQuery aceptada');
  } catch {
    log('No se pudo confirmar answerCallbackQuery');
  }
}

async function pollCallbacks(options, signal) {
  const { callTelegram, log, dispatchMessage, expectedBot = 'test_social_hub_bot' } = options;
  const bot = await callTelegram('getMe', {}, 5000, signal);
  if (bot?.username?.toLowerCase() !== expectedBot.toLowerCase()) throw new Error('unexpected_bot');
  if (dispatchMessage) {
    const webhook = await callTelegram('getWebhookInfo', {}, 5000, signal);
    if (webhook?.url !== '') throw new Error('webhook_active');
  }
  let offset;
  let listening = false;
  while (!signal.aborted) {
    try {
      const updates = await callTelegram('getUpdates', {
        offset, timeout: 20, allowed_updates: dispatchMessage ? ['message', 'callback_query'] : ['callback_query'],
      }, 25000, signal);
      if (!Array.isArray(updates)) throw new Error('invalid_updates');
      if (!listening) {
        log(dispatchMessage ? 'Recepción de mensajes y callbacks activa' : 'Recepción de callback_query activa');
        options.onListening?.();
      }
      listening = true;
      for (const update of updates) {
        if (signal.aborted) return;
        if (!Number.isSafeInteger(update?.update_id)) continue;
        if (update.callback_query) await handleCallback(update.callback_query, options);
        if (dispatchMessage && options.allowedChats.has(update.message?.chat?.id)) {
          await deliverIntakeReply(update, options, signal);
        }
        offset = Math.max(offset ?? 0, update.update_id + 1);
      }
    } catch (failure) {
      if (signal.aborted) return;
      if (failure.message === 'telegram_consumer_conflict') throw failure;
      log('No se pudo consultar o procesar una actualización; se reintentará');
      await delay(3000, undefined, { signal }).catch(() => {});
    }
  }
}

module.exports = { loadProjects, seedRecord, pollCallbacks };
