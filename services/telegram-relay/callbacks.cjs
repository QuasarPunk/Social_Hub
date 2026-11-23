const { randomUUID } = require('node:crypto');
const { readFileSync, readdirSync, renameSync, writeFileSync, unlinkSync, linkSync } = require('node:fs');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const slug = '[a-z0-9][a-z0-9_-]*';
const callbackPattern = new RegExp(`^sh:(${slug}):(${slug})$`);

function loadProjects(directory) {
  const projects = new Map();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const profile = JSON.parse(readFileSync(join(directory, entry.name, 'profile.json'), 'utf8'));
    if (profile.active !== true) continue;
    if (profile.project_id !== entry.name || !new RegExp(`^${slug}$`).test(entry.name)
      || typeof profile.name !== 'string' || !profile.name.trim()) {
      throw new Error('invalid_editorial_profile');
    }
    projects.set(profile.project_id, profile);
  }
  return projects;
}

function saveRecord(directory, record, createOnly) {
  const path = join(directory, `${record.content_id}.json`);
  const temp = join(directory, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600, flush: true });
    if (createOnly) linkSync(temp, path);
    else renameSync(temp, path);
  } finally {
    try {
      unlinkSync(temp);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

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

function classify(query, { allowedChats, records, projects }) {
  const chat = query.message?.chat?.id;
  if (!allowedChats.has(chat)) return 'Chat no autorizado.';
  const data = query.data;
  const match = typeof data === 'string' && Buffer.byteLength(data) <= 64 && callbackPattern.exec(data);
  if (!match || match[0] !== data) return 'Selección inválida.';
  const [, contentId, projectId] = match;
  let record;
  try {
    record = JSON.parse(readFileSync(join(records, `${contentId}.json`), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return 'Contenido no disponible.';
    throw error;
  }
  if (record?.content_id !== contentId || record.chat_id !== chat) return 'Contenido no disponible.';
  const project = projects.get(projectId);
  if (!project) return 'Proyecto no disponible.';
  if (record.status === 'CLASSIFIED') {
    return `Ya clasificado: ${projects.get(record.project_id)?.name ?? record.project_id}`;
  }
  if (record.status !== 'PENDING_CLASSIFICATION' || record.clarification?.required !== true) {
    return 'El contenido no está pendiente.';
  }
  if (!record.clarification.options?.some(option => option.project_id === projectId)) {
    return 'Proyecto no disponible.';
  }

  // One receiver per dev volume. No asynchronous work between reading and replacing the record.
  saveRecord(records, {
    ...record,
    status: 'CLASSIFIED',
    project_id: projectId,
    project: projectId,
    editorial_profile: project,
    target_platforms: Object.entries(project.platforms ?? {})
      .filter(([, config]) => config.enabled === true).map(([name]) => name),
    clarification: { ...record.clarification, required: false },
    updated_at: new Date().toISOString(),
  }, false);
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
    log('No se pudo actualizar el registro de desarrollo');
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
  const { callTelegram, log } = options;
  const bot = await callTelegram('getMe', {}, 5000, signal);
  if (bot?.username?.toLowerCase() !== 'test_social_hub_bot') throw new Error('unexpected_bot');
  let offset;
  let listening = false;
  while (!signal.aborted) {
    try {
      const updates = await callTelegram('getUpdates', {
        offset, timeout: 20, allowed_updates: ['callback_query'],
      }, 25000, signal);
      if (!Array.isArray(updates)) throw new Error('invalid_updates');
      if (!listening) log('Recepción de callback_query activa');
      listening = true;
      for (const update of updates) {
        if (signal.aborted) return;
        if (!Number.isSafeInteger(update?.update_id)) continue;
        if (update.callback_query) await handleCallback(update.callback_query, options);
        offset = Math.max(offset ?? 0, update.update_id + 1);
      }
    } catch {
      if (signal.aborted) return;
      log('Telegram no entregó actualizaciones; se volverá a consultar');
      await delay(3000, undefined, { signal }).catch(() => {});
    }
  }
}

module.exports = { loadProjects, seedRecord, pollCallbacks };
