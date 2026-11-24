const { readFileSync, readdirSync, realpathSync, statSync } = require('node:fs');
const { resolve, join, sep } = require('node:path');
const { atomicWrite, readRecord } = require('./editorial.cjs');
const { EditorialError, editorialPlan } = require('./editorial-provider.cjs');
const prompt = require('./editorial-prompts/v2.json');

const layout = {
  instagram: { max_fragments: 3, maxChars: 650, label: 'Una idea para empezar', cta: '¿Qué te llama la atención?' },
  facebook: { max_fragments: 5, maxChars: 1400, label: 'Para compartir con la comunidad', cta: '¿Qué te gustaría sumar a la conversación?' },
  linkedin: { max_fragments: 4, maxChars: 1150, label: 'Para poner en contexto', cta: '¿Qué otra perspectiva sumarías?' },
};
const idPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const permittedMedia = /^\/files\/incoming\/[a-z0-9][a-z0-9_.-]{0,140}$/i;
const malicious = /\b(?:(?:ignor[aeá]|omit[íei]|olvid[áa]|override|ignore|desobedec[ée])\b.{0,90}\b(?:instrucciones|reglas|orden(?:es)?|prompt|system|rules|previous|anterior(?:es)?)|(?:system|developer)\s*[:>]|(?:public[áa]|post|reveal|revel[áa]|mostr[áa])\b.{0,90}\b(?:api.?key|secretos|credencial(?:es)?|token(?:s)?|redes sociales))\b/i;
const simple = value => typeof value === 'string' && value.trim();
const emojiChars = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const fillerCopy = /^(?:en un mundo|descubr[ií]|te invitamos|una parada en la agenda|una propuesta de|para compartir con la comunidad)/i;

function cleanCopy(value, maxChars) {
  if (typeof value !== 'string') return { text: null, reason: 'ausente', removed: [] };
  let text = value.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const removed = [];
  if (/#[\p{L}\p{N}_]{2,40}/u.test(text)) {
    text = text.replace(/#[\p{L}\p{N}_]{2,40}/gu, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
    removed.push('hashtags_modelo_omitidos');
  }
  if (emojiChars.test(text)) {
    text = text.replace(emojiChars, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
    removed.push('emojis_modelo_omitidos');
  }
  if (!text) return { text: null, reason: 'vacia', removed };
  if (text.length > maxChars - 100) return { text: null, reason: 'larga', removed };
  if (/[\u0000-\u001f\u007f]/.test(text.replace(/\n/g, ''))) return { text: null, reason: 'control', removed };
  if (fillerCopy.test(text)) return { text: null, reason: 'relleno', removed };
  if (text.split(/\n\n+/).length > 3) return { text: null, reason: 'parrafos', removed };
  return { text, reason: null, removed };
}

function contentWords(value) {
  return new Set(value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(word => word.length > 3));
}

function coveredByCopy(copy, selected) {
  const target = contentWords(copy);
  return selected.every(fragment => {
    const words = [...contentWords(fragment.text)];
    if (!words.length) return true;
    return words.filter(word => target.has(word)).length / words.length >= 0.6;
  });
}

function controls(text, flags, warnings) {
  const token = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  if (/^(?:sin hashtags|sin etiquetas)$/.test(token)) flags.hashtags = false;
  else if (/^(?:sin emojis|sin iconos)$/.test(token)) flags.emojis = false;
  else if (/^(?:sin llamada a la accion|sin pregunta final)$/.test(token)) flags.call_to_action = false;
  else if (/^(?:breve|texto breve|formato breve)$/.test(token)) flags.brief = true;
  else if (/^(?:lista|en lista|en vinetas|formato lista)$/.test(token)) flags.bullets = true;
  else warnings.add('instruccion_para_revision');
}

function materialContext(record, warnings) {
  const grouped = record.capture?.materials;
  if (grouped !== undefined && !Array.isArray(grouped)) throw new EditorialError('invalid_capture_contract');
  const segments = [];
  const media = new Map();
  for (const item of grouped ?? [{ type: record.type, text: record.instruction, media_path: record.media_path }]) {
    if (simple(item.text)) segments.push(item.text);
    if (simple(item.transcription?.text)) segments.push(item.transcription.text);
    if (typeof item.media_path === 'string' && permittedMedia.test(item.media_path)
      && ['photo', 'voice', 'audio'].includes(item.type)) {
      media.set(item.media_path, { type: item.type, path: item.media_path });
    } else if (item.media_path) warnings.add('ruta_multimedia_no_compatible');
  }
  return { segments, media: [...media.values()] };
}

function contentFragments(record, profile, preferences, warnings) {
  const { segments, media } = materialContext(record, warnings);
  const exactNames = [profile.project_id, profile.name, ...(profile.aliases ?? [])].map(x => x.toLowerCase());
  const fragments = new Set();
  for (const segment of segments) {
    for (const line of segment.split(/\r?\n/).map(x => x.trim()).filter(Boolean)) {
      const instruction = line.match(/^(?:instrucci[oó]n(?:es)?|formato)\s*:\s*(.*)$/i);
      if (instruction) {
        for (const option of instruction[1].split(/[;,]/)) controls(option, preferences, warnings);
        continue;
      }
      const match = line.match(/^([^:]+):\s*(.*)$/);
      const data = match && exactNames.includes(match[1].trim().toLowerCase()) ? match[2] : line;
      for (const part of data.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¡¿])/u)) {
        const fact = part.trim();
        if (!fact) continue;
        if (malicious.test(fact) || /[\u0000-\u001f\u007f]/u.test(fact)) {
          warnings.add('fragmento_de_control_omitido');
          continue;
        }
        if (fact.length > 420 || fragments.size >= 12) {
          warnings.add('fragmento_fuera_de_limite');
          continue;
        }
        fragments.add(fact);
      }
    }
  }
  return { fragments: [...fragments].map((text, id) => ({ id, text })), media };
}

function platformMenus(profile, preferences, targets) {
  const voice = profile.communication?.style ?? ('Una propuesta de ' + profile.name);
  return Object.fromEntries(targets.map(platform => [platform, {
    ...layout[platform],
    max_fragments: preferences.brief ? 2 : layout[platform].max_fragments,
    format: profile.platforms[platform].formats?.includes('post') ? 'post' : (profile.platforms[platform].formats?.[0] ?? 'post'),
    style: profile.platforms[platform].style ?? '',
    openings: [voice.slice(0, 95), (profile.platforms[platform].style ?? layout[platform].label).slice(0, 95),
      ('Desde ' + profile.name).slice(0, 95)],
  }]));
}

function schemaFor(platforms, ids) {
  const shape = { type: 'object', additionalProperties: false, required: Object.keys(platforms), properties: {} };
  for (const [platform, config] of Object.entries(platforms)) {
    shape.properties[platform] = {
      type: 'object', additionalProperties: false, required: ['opening', 'fragments', 'copy'],
      properties: {
        opening: { type: 'integer', enum: [0, 1, 2] },
        fragments: { type: 'array', minItems: 1, maxItems: Math.min(config.max_fragments, ids.length), uniqueItems: true,
          items: { type: 'integer', enum: ids } },
        copy: { type: 'string', minLength: 1, maxLength: Math.max(1, config.maxChars - 100) },
      },
    };
  }
  return {
    type: 'object', additionalProperties: false, required: ['destinations', 'visual'],
    properties: { destinations: shape, visual: { type: 'string', enum: prompt.visual_categories } },
  };
}

function validatePlan(plan, platforms, size, warnings = new Set()) {
  const exact = (object, keys) => !!object && typeof object === 'object' && !Array.isArray(object)
    && Object.keys(object).length === keys.length && keys.every(key => Object.hasOwn(object, key));
  const fail = reason => {
    const error = new EditorialError('invalid_provider_response', 502, true);
    error.stage = 'validate';
    error.reason = reason;
    throw error;
  };
  if (!exact(plan, ['destinations', 'visual'])) fail('plan_shape');
  if (!prompt.visual_categories.includes(plan.visual)) fail('visual_category');
  if (!exact(plan.destinations, Object.keys(platforms))) fail('destination_keys');
  for (const [platform, menu] of Object.entries(platforms)) {
    const picked = plan.destinations[platform];
    const keys = picked && typeof picked === 'object' && !Array.isArray(picked) ? Object.keys(picked) : [];
    if (!keys.every(key => ['opening', 'fragments', 'copy'].includes(key)) || !keys.includes('opening')
      || !keys.includes('fragments') || ![0, 1, 2].includes(picked.opening)) fail('destination_shape');
    if (Object.hasOwn(picked, 'copy') && typeof picked.copy !== 'string') fail('copy_type');
    if (!Array.isArray(picked.fragments)) fail('fragments_type');
    if (picked.fragments.length < 1 || picked.fragments.length > menu.max_fragments) fail('fragments_count');
    if (picked.fragments.some(id => !Number.isSafeInteger(id) || id < 0 || id >= size)) fail('fragment_id');
    if (new Set(picked.fragments).size !== picked.fragments.length) {
      const seen = new Set();
      picked.fragments = picked.fragments.filter(id => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      warnings.add('fragmentos_repetidos_omitidos');
    }
  }
  return plan;
}

function imageInput(media, incoming, warnings) {
  const root = realpathSync(incoming);
  const images = [];
  for (const item of media.filter(x => x.type === 'photo').slice(0, 2)) {
    try {
      const path = realpathSync(resolve(root, item.path.slice('/files/incoming/'.length)));
      if (!path.startsWith(root + sep) || !statSync(path).isFile() || statSync(path).size > 3 * 1024 * 1024) throw Error();
      const bytes = readFileSync(path);
      if (bytes.subarray(0, 3).toString('hex') !== 'ffd8ff') throw Error();
      images.push(bytes.toString('base64'));
    } catch {
      warnings.add('foto_sin_interpretacion_visual');
    }
  }
  return images;
}

function hashtagsFor(profile, fragments) {
  const flat = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const source = flat(fragments.join(' '));
  const canonical = new Set([flat(profile.project_id), flat(profile.name)]);
  return [...new Set(profile.preferences?.default_hashtags ?? [])].filter(tag =>
    /^#[\p{L}\p{N}_]{2,40}$/u.test(tag) && (canonical.has(flat(tag)) || source.includes(flat(tag)))).slice(0, 6);
}

function createEditorialEngine({ records, drafts, incoming, provider, vision = false, wait, now = Date.now }) {
  const running = new Map();
  const readDraft = id => readRecord(drafts, id);

  async function generate(record, stop) {
    if (record.status !== 'CLASSIFIED' || record.classification_contract_version !== '1.0') {
      throw new EditorialError('content_not_classified', 409);
    }
    const profile = record.editorial_profile;
    if (!profile || profile.project_id !== record.project_id || !Number.isSafeInteger(record.profile_version)
      || record.profile_version !== profile.profile_version || !simple(profile.name)
      || !profile.platforms || !Array.isArray(record.target_platforms)) throw new EditorialError('invalid_editorial_profile');
    const targets = Object.keys(layout).filter(platform => profile.platforms[platform]?.enabled === true
      && record.target_platforms.includes(platform));
    if (!targets.length) throw new EditorialError('no_supported_platforms');

    const warnings = new Set();
    const preferences = { hashtags: profile.preferences?.use_hashtags === true, emojis: profile.preferences?.use_emojis === true,
      call_to_action: profile.preferences?.call_to_action === true, brief: false, bullets: false };
    const { fragments, media } = contentFragments(record, profile, preferences, warnings);
    if (!fragments.length) throw new EditorialError('no_editorial_facts');
    const platforms = platformMenus(profile, preferences, targets);
    const images = vision ? imageInput(media, incoming, warnings) : [];
    if (media.some(x => x.type === 'photo') && !images.length) warnings.add('foto_sin_interpretacion_visual');
    const input = {
      profile: { name: profile.name, project_id: profile.project_id, language: profile.communication?.language,
        tone: profile.communication?.tone, style: profile.communication?.style, personality: profile.communication?.personality,
        mission: profile.identity?.mission, values: profile.identity?.values, audience: profile.audience?.description,
        restrictions: profile.editorial?.restrictions, custom_instructions: profile.editorial?.custom_instructions,
        narrative_notes: profile.editorial?.narrative_notes },
      fragments,
      platforms: Object.fromEntries(targets.map(platform => [platform, { format: platforms[platform].format,
        style: platforms[platform].style, max_fragments: platforms[platform].max_fragments,
        max_chars: platforms[platform].maxChars }])),
      preferences,
    };
    const { result, attempted, imageUsed } = await editorialPlan(provider, {
      system: prompt.system, input, schema: schemaFor(platforms, fragments.map(x => x.id)), images,
    }, plan => validatePlan(plan, platforms, fragments.length, warnings), stop, wait);
    if (images.length && !imageUsed) warnings.add('foto_sin_interpretacion_visual');
    const generatedAt = new Date(now()).toISOString();
    const generatedDrafts = targets.map(platform => {
      const design = platforms[platform];
      const plan = result.destinations[platform];
      const parsedCopy = cleanCopy(plan.copy, design.maxChars);
      let copy = parsedCopy.text;
      for (const warning of parsedCopy.removed) warnings.add(warning);
      const selectedFragments = plan.fragments.map(id => fragments[id]);
      if (copy && !coveredByCopy(copy, selectedFragments)) {
        copy = null;
        warnings.add('cobertura_incompleta');
      }
      if (plan.copy !== undefined && !copy) {
        warnings.add('copia_modelo_no_usada');
        warnings.add('copia_' + parsedCopy.reason);
      }
      const opening = (preferences.emojis && platform === 'instagram' ? '✦ ' : '') + design.openings[plan.opening];
      const lines = [opening];
      const selected = [];
      for (const id of plan.fragments) {
        const fact = fragments[id].text;
        const value = preferences.bullets ? '• ' + fact : fact;
        if ([...lines, value].join('\n\n').length > design.maxChars - 100) continue;
        lines.push(value);
        selected.push(fact);
      }
      if (preferences.call_to_action) lines.push(design.cta);
      const prefix = preferences.emojis && platform === 'instagram' ? '✦ ' : '';
      return { draft_id: record.content_id + '-' + platform, platform, format: design.format, status: 'DRAFT',
        text: copy ? prefix + copy : lines.join('\n\n'),
        hashtags: preferences.hashtags ? hashtagsFor(profile, selected) : [], media };
    });
    const output = {
      draft_contract_version: '1.0',
      content_id: record.content_id,
      project_id: record.project_id,
      profile_version: record.profile_version,
      status: 'DRAFT',
      generation: { provider: provider.name, model: provider.model, prompt_version: prompt.version, attempted,
        generated_at: generatedAt, visual_category: imageUsed ? result.visual : null },
      warnings: [...warnings],
      errors: [],
      drafts: generatedDrafts,
    };
    stop?.throwIfAborted();
    try {
      atomicWrite(join(drafts, record.content_id + '.json'), JSON.stringify(output, null, 2) + '\n', true);
      return output;
    } catch (error) {
      if (error.code === 'EEXIST') return readDraft(record.content_id);
      throw error;
    }
  }

  async function request(contentId, stop) {
    if (typeof contentId !== 'string' || !idPattern.test(contentId)) throw new EditorialError('invalid_content_id', 400);
    const saved = readDraft(contentId);
    if (saved) return saved;
    if (running.has(contentId)) return running.get(contentId);
    if (running.size) throw new EditorialError('editorial_busy', 503);
    const record = readRecord(records, contentId);
    if (!record || record.content_id !== contentId) throw new EditorialError('content_not_found', 404);
    const job = generate(record, stop);
    running.set(contentId, job);
    try { return await job; } finally { running.delete(contentId); }
  }

  function latest(chat, user) {
    return readdirSync(records).filter(file => file.endsWith('.json') && idPattern.test(file.slice(0, -5)))
      .map(file => readRecord(records, file.slice(0, -5)))
      .filter(r => r?.status === 'CLASSIFIED' && r.classification_contract_version === '1.0' && r.chat_id === chat
        && (r.user_id === user || r.user_id == null && chat === user))
      .sort((a, b) => (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0))[0]?.content_id;
  }
  return { request, latest };
}

module.exports = { createEditorialEngine, schemaFor, validatePlan };
