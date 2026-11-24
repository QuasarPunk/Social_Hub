const { readFileSync, readdirSync, realpathSync, statSync } = require('node:fs');
const { resolve, join, sep } = require('node:path');
const { atomicWrite, readRecord } = require('./editorial.cjs');
const { EditorialError, editorialPlan } = require('./editorial-provider.cjs');
const prompt = require('./editorial-prompts/v3.json');

const layout = {
  instagram: { max_fragments: 3, maxChars: 650, label: 'Sensorial y breve' },
  facebook: { max_fragments: 5, maxChars: 1400, label: 'Contexto y conversación' },
  linkedin: { max_fragments: 4, maxChars: 1150, label: 'Perspectiva y análisis' },
};
const idPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const permittedMedia = /^\/files\/incoming\/[a-z0-9][a-z0-9_.-]{0,140}$/i;
const malicious = /\b(?:(?:ignor[aeá]|omit[íei]|olvid[áa]|override|ignore|desobedec[ée])\b.{0,90}\b(?:instrucciones|reglas|orden(?:es)?|prompt|system|rules|previous|anterior(?:es)?)|(?:system|developer)\s*[:>]|(?:public[áa]|post|reveal|revel[áa]|mostr[áa])\b.{0,90}\b(?:api.?key|secretos|credencial(?:es)?|token(?:s)?|redes sociales))\b/i;
const simple = value => typeof value === 'string' && value.trim();
const emojiChars = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const fillerCopy = /^(?:en un mundo|descubr[ií]|te invitamos|una parada en la agenda|una propuesta de|para compartir con la comunidad|din[aá]mico, visual y atractivo|en nuestro [uú]ltimo proyecto|hoy en d[ií]a)/i;
const bannedCopyPhrases = /\b(?:en este post|descubre|aprende|te explicamos|en nuestro [uú]ltimo proyecto|proyectos? innovadores?|experiencias? [uú]nicas?|hoy en d[ií]a)\b/i;
const directiveStart = /^(?:hace|hacé|prepará|prepara|creá|crea|generá|genera|redactá|redacta|escribí|escribe|explicá|explica|publicá|publica)(?=\s|$)/i;
const numbers = new Map(Object.entries({ dos: '2', doscientas: '200', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9', diez: '10', once: '11', doce: '12', trece: '13', catorce: '14', quince: '15', dieciseis: '16', diecisiete: '17', dieciocho: '18', diecinueve: '19', veinte: '20', treinta: '30', cuarenta: '40', cincuenta: '50', cien: '100' }));

function flat(value) {
  return String(value).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function polishCopy(value, preferences = {}) {
  let text = String(value).trim();
  const removed = [];
  const before = text;
  text = text
    .replace(/\bEn este post\b[,:]?\s*/gi, '')
    .replace(/\bDescubre\s+(c[oó]mo|qu[eé]|los?\b|las?\b)/gi, 'Revisamos $1')
    .replace(/\bAprende\s+a\s+/gi, 'Se explica cómo ')
    .replace(/\bAprende\s+/gi, 'Se explica ')
    .replace(/\bTe explicamos\s+/gi, 'Explicamos ')
    .replace(/\bEn nuestro [uú]ltimo proyecto\b/gi, (_, offset) => offset === 0 ? 'En este trabajo' : 'en este trabajo')
    .replace(/\bproyectos innovadores\b/gi, 'proyectos')
    .replace(/\bproyecto innovador\b/gi, 'proyecto')
    .replace(/\bexperiencias [uú]nicas\b/gi, 'experiencias interactivas')
    .replace(/\bexperiencia [uú]nica\b/gi, 'experiencia interactiva')
    .replace(/\bHoy en d[ií]a\b/gi, 'Actualmente');
  if (text !== before) removed.push('frases_genericas_omitidas');
  if (!preferences.call_to_action) {
    const statements = text.split(/(?<=[.!?])\s+/u);
    const kept = statements.filter(statement => {
      const normalized = flat(statement).replace(/^[-*¡!\s]+/, '');
      return !/[?]/.test(statement)
        && !/^(?:unete|sumate|proba|comparti|te invitamos|visita|escribinos|contanos|seguinos|mir[aa]|aplicaras|podras|puedes|podes|conoc[ée]|encontraras|experimenta|asegurate|utiliza)\b/.test(normalized)
        && !/para aprender mas\b/.test(normalized);
    });
    if (kept.length !== statements.length) {
      removed.push('llamada_accion_omitida');
      text = kept.join(' ').trim();
    }
  }
  const beforeArtifacts = text;
  text = text.replace(/\s*[©®™]\s*\d{4}[^\n]*/g, '').replace(/\s+[¡!¿?]+\s*[ñÑ]?\b/g, ' ').replace(/¬/g, 'á').replace(/[ \t]{2,}/g, ' ').trim();
  if (text !== beforeArtifacts) removed.push('artefactos_modelo_omitidos');
  if (!text) return { text: '', removed };
  text = text.replace(/(^|[\n.!?]\s*|: \s*)([a-záéíóúñ])/gu, (_, lead, letter) => lead + letter.toUpperCase());
  return { text, removed };
}

function cleanCopy(value, maxChars, preferences = {}) {
  if (typeof value !== 'string') return { text: null, reason: 'ausente', removed: [] };
  const polished = polishCopy(value, preferences);
  let text = polished.text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const removed = [...polished.removed];
  if (preferences.inline_hashtags !== true && /#[\p{L}\p{N}_]{2,40}/u.test(text)) {
    text = text.replace(/#[\p{L}\p{N}_]{2,40}/gu, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
    removed.push('hashtags_modelo_omitidos');
  }
  if (preferences.inline_emojis !== true && emojiChars.test(text)) {
    text = text.replace(emojiChars, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
    removed.push('emojis_modelo_omitidos');
  }
  text = text.replace(/^\*{1,2}\s*|\s*\*{1,2}$/g, '').trim();
  if (!text) return { text: null, reason: 'vacia', removed };
  if (text.length > maxChars - 50) return { text: null, reason: 'larga', removed };
  if (/[\u0000-\u001f\u007f]/.test(text.replace(/\n/g, ''))) return { text: null, reason: 'control', removed };
  if (fillerCopy.test(text)) return { text: null, reason: 'relleno', removed };
  if (text.split(/\n\n+/).length > 5) return { text: null, reason: 'parrafos', removed };
  return { text, reason: null, removed };
}

function contentWords(value) {
  return new Set(flat(value).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(word => word.length > 3));
}

function numericSignals(value) {
  const text = flat(value);
  const digits = text.match(/\b\d+(?:[.,]\d+)?\b/g) ?? [];
  const words = [...numbers].filter(([word]) => new RegExp('\\b' + word + '\\b').test(text)).map(([, digit]) => digit);
  return [...new Set([...digits, ...words])];
}

function fidelityWarnings(copy, selected) {
  if (!selected.length) return [];
  const target = flat(copy);
  const targetSignals = new Set(numericSignals(copy));
  const found = new Set();
  for (const fragment of selected) {
    const signals = numericSignals(fragment.text);
    if (signals.some(signal => !targetSignals.has(signal))) found.add('fidelity_numbers_review');
    const words = [...contentWords(fragment.text)];
    if (words.length) {
      const covered = words.filter(word => target.includes(word)).length / words.length;
      if (covered < 0.35) found.add('fidelity_review');
    }
  }
  return [...found];
}

function applyRestrictions(text, flags, instructions) {
  const token = flat(text);
  const rules = [
    [/(?:sin|ni)\s+(?:hashtags|etiquetas)/, value => { value.hashtags = false; value.inline_hashtags = false; }, 'sin hashtags'],
    [/(?:sin|ni)\s+(?:emojis|iconos)/, value => { value.emojis = false; value.inline_emojis = false; }, 'sin emojis'],
    [/(?:con|incluir)\s+hashtags/, value => { value.hashtags = true; value.inline_hashtags = true; }, 'con hashtags'],
    [/(?:con|incluir)\s+(?:emojis|iconos)/, value => { value.emojis = true; value.inline_emojis = true; }, 'con emojis'],
    [/(?:sin|ni)\s+(?:llamada a la accion|pregunta final|cta|closing)/, value => { value.call_to_action = false; }, 'sin llamada a la accion'],
    [/(?:con|incluir)\s+(?:llamada a la accion|pregunta final|cta)/, value => { value.call_to_action = true; }, 'con llamada a la accion'],
    [/\b(?:breve|sintetico|corto|poco texto)\b/, value => { value.brief = true; }, 'breve'],
    [/\b(?:en vinetas|en lista|formato lista|lista de puntos)\b/, value => { value.bullets = true; }, 'en vinetas'],
    [/\b(?:calida|cercana|tecnica|didactica|sobria|profesional)\b/, value => { value.tone = token.match(/\b(?:calida|cercana|tecnica|didactica|sobria|profesional)\b/)[0]; }, null],
  ];
  let matched = false;
  for (const [pattern, apply, label] of rules) {
    if (!pattern.test(token)) continue;
    matched = true;
    apply(flags);
    if (label) instructions.push(label);
  }
  return matched;
}

function controls(text, flags, instructions, warnings) {
  for (const option of text.split(/[;,]/)) {
    const value = option.trim();
    if (!value) continue;
    if (!applyRestrictions(value, flags, instructions)) warnings.add('instruccion_para_revision');
  }
}

function splitStatements(value) {
  return value.split(/\r?\n|(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑ¡¿])/u).map(x => x.trim()).filter(Boolean);
}

function extractTopics(statement, profile) {
  const names = [profile.project_id, profile.name, ...(profile.aliases ?? [])].filter(Boolean);
  const match = statement.match(/(?:explicando|explic[áa]|hablando\s+de|hablando\s+sobre|sobre|acerca\s+de|referido\s+a|tratando\s+sobre)\s+(.+)$/i);
  if (!match) return null;
  let topic = match[1]
    .replace(/[,;]\s*(?:sin|con)\s+[^,;]+$/gi, '')
    .replace(/^\s*(?:brevemente|de)\s+/i, '')
    .replace(/[.]+$/, '')
    .trim();
  for (const name of names) {
    topic = topic.replace(new RegExp('\\b' + escapePattern(flat(name)) + '\\b', 'gi'), '');
  }
  topic = topic.replace(/\s{2,}/g, ' ').replace(/^[,;\s]+|[,;\s]+$/g, '').trim();
  return topic.length >= 8 ? topic : null;
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

function interpretIntent(record, profile, warnings) {
  const { segments, media } = materialContext(record, warnings);
  const flags = {
    hashtags: profile.preferences?.use_hashtags === true,
    emojis: profile.preferences?.use_emojis === true,
    inline_hashtags: false,
    inline_emojis: false,
    call_to_action: false,
    brief: false,
    bullets: false,
    tone: typeof profile.communication?.style === 'string' ? profile.communication.style : null,
  };
  const instructions = [];
  const directives = [];
  const topics = [];
  const facts = new Set();
  for (const segment of segments) {
    for (const statement of splitStatements(segment)) {
      const prefixed = statement.match(/^(?:instrucci[oó]n(?:es)?|formato)\s*:\s*(.*)$/i);
      if (prefixed) {
        controls(prefixed[1], flags, instructions, warnings);
        continue;
      }
      applyRestrictions(statement, flags, instructions);
      if (malicious.test(statement) || /[\u0000-\u001f\u007f]/u.test(statement)) {
        warnings.add('fragmento_de_control_omitido');
        continue;
      }
      const topic = extractTopics(statement, profile);
      if (topic) {
        topics.push(topic);
        directives.push(statement);
        continue;
      }
      const data = statement.match(/^([^:]+):\s*(.*)$/);
      const names = [profile.project_id, profile.name, ...(profile.aliases ?? [])].map(x => flat(x));
      const content = data && names.includes(flat(data[1])) ? data[2] : statement;
      if (directiveStart.test(content.trim())) {
        directives.push(statement);
        continue;
      }
      if (!simple(content)) continue;
      if (content.length > 420 || facts.size >= 12) {
        warnings.add('fragmento_fuera_de_limite');
        continue;
      }
      facts.add(content.trim());
    }
  }
  const uniqueTopics = [...new Set(topics)];
  const mode = uniqueTopics.length && facts.size ? 'mixto' : uniqueTopics.length ? 'generativo' : facts.size ? 'documental' : null;
  return {
    mode, topics: uniqueTopics, facts: [...facts], instructions: [...new Set(instructions)],
    directives: [...new Set(directives)],
    restrictions: { hashtags: flags.hashtags, emojis: flags.emojis, inline_hashtags: flags.inline_hashtags,
      inline_emojis: flags.inline_emojis, call_to_action: flags.call_to_action,
      brief: flags.brief, bullets: flags.bullets, tone: flags.tone },
    materials: media.map(item => item.type),
    fragments: [...facts].map((text, id) => ({ id, text })), media, flags,
  };
}

function platformMenus(profile, preferences, targets) {
  return Object.fromEntries(targets.map(platform => [platform, {
    ...layout[platform],
    max_fragments: preferences.brief ? 2 : layout[platform].max_fragments,
    format: profile.platforms[platform].formats?.includes('post') ? 'post' : (profile.platforms[platform].formats?.[0] ?? 'post'),
    style: profile.platforms[platform].style ?? profile.communication?.style ?? '',
  }]));
}

function schemaFor(platforms, ids) {
  const shape = { type: 'object', additionalProperties: false, required: Object.keys(platforms), properties: {} };
  for (const [platform, config] of Object.entries(platforms)) {
    shape.properties[platform] = {
      type: 'object', additionalProperties: false, required: ['copy', 'fragments'],
      properties: {
        copy: { type: 'string', minLength: 1, maxLength: Math.max(1, config.maxChars - 50) },
        fragments: { type: 'array', minItems: 0, maxItems: Math.min(config.max_fragments, ids.length), uniqueItems: true,
          items: { type: 'integer', enum: ids } },
      },
    };
  }
  return {
    type: 'object', additionalProperties: false, required: ['destinations', 'visual'],
    properties: { destinations: shape, visual: { type: 'string', enum: prompt.visual_categories } },
  };
}

function validatePlan(plan, platforms, size, warnings = new Set(), intent = {}, preferences = {}) {
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
    if (!keys.every(key => ['copy', 'fragments'].includes(key)) || !keys.includes('copy') || !keys.includes('fragments')) fail('destination_shape');
    const clean = cleanCopy(picked.copy, menu.maxChars, preferences);
    for (const warning of clean.removed) warnings.add(warning);
    if (!clean.text) fail('copy_' + clean.reason);
    const minimum = preferences.brief ? 60 : 80;
    if (clean.text.length < minimum) fail('copy_too_short');
    const normalizedCopy = flat(clean.text);
    for (const literal of [...(intent.topics ?? []), ...(intent.directives ?? [])]) {
      const normalizedLiteral = flat(literal);
      if (normalizedCopy === normalizedLiteral || (normalizedLiteral.length > 20 && normalizedCopy.startsWith(normalizedLiteral)
        && clean.text.length < normalizedLiteral.length + 80)) fail('copy_literal_instruction');
    }
    if (directiveStart.test(clean.text)) fail('copy_literal_instruction');
    if (/^\*{1,2}[^*\n]+\*{1,2}\s*[:.!]?\s*\n/i.test(clean.text)
      || /^(?:hola|estimad|en este post|descubre|en nuestro [uú]ltimo proyecto|hoy en d[ií]a)/i.test(clean.text)) fail('copy_generic_opening');
    if (bannedCopyPhrases.test(normalizedCopy)) fail('copy_generic_phrase');
    if (!preferences.call_to_action && /\?\s*$/.test(clean.text)) fail('restriction_final_question');
    picked.copy = clean.text;
    if (!Array.isArray(picked.fragments)) fail('fragments_type');
    if (picked.fragments.length < 0 || picked.fragments.length > menu.max_fragments) fail('fragments_count');
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
  const source = flat(fragments.join(' '));
  const canonical = new Set([flat(profile.project_id), flat(profile.name)].map(value => value.replace(/^#/, '')));
  return [...new Set(profile.preferences?.default_hashtags ?? [])].filter(tag => {
    if (!/^#[\p{L}\p{N}_]{2,40}$/u.test(tag)) return false;
    const name = flat(tag).replace(/^#/, '');
    return canonical.has(name) || source.includes(name);
  }).slice(0, 6);
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
    const intent = interpretIntent(record, profile, warnings);
    if (!intent.mode) throw new EditorialError('no_editorial_facts');
    const preferences = intent.flags;
    const fragments = intent.fragments;
    const platforms = platformMenus(profile, preferences, targets);
    const images = vision ? imageInput(intent.media, incoming, warnings) : [];
    if (intent.media.some(x => x.type === 'photo') && !images.length) warnings.add('foto_sin_interpretacion_visual');
    const input = {
      profile: { name: profile.name, project_id: profile.project_id, language: profile.communication?.language,
        tone: profile.communication?.tone, style: profile.communication?.style, personality: profile.communication?.personality,
        mission: profile.identity?.mission, values: profile.identity?.values, audience: profile.audience?.description,
        restrictions: profile.editorial?.restrictions, custom_instructions: profile.editorial?.custom_instructions,
        narrative_notes: profile.editorial?.narrative_notes },
      intent: { mode: intent.mode, topics: intent.topics, facts: intent.facts, instructions: intent.instructions,
        directives: intent.directives, restrictions: intent.restrictions, materials: intent.materials },
      fragments,
      platforms: Object.fromEntries(targets.map(platform => [platform, { format: platforms[platform].format,
        style: platforms[platform].style, max_fragments: platforms[platform].max_fragments,
        max_chars: platforms[platform].maxChars }])),
      preferences: { ...preferences, default_hashtags: profile.preferences?.default_hashtags ?? [] },
    };
    const start = now();
    const { result, attempted, imageUsed } = await editorialPlan(provider, {
      system: prompt.system, input, schema: schemaFor(platforms, fragments.map(x => x.id)), images,
    }, plan => validatePlan(plan, platforms, fragments.length, warnings, intent, preferences), stop, wait);
    const duration = now() - start;
    if (images.length && !imageUsed) warnings.add('foto_sin_interpretacion_visual');
    const generatedAt = new Date(now()).toISOString();
    const generatedDrafts = targets.map(platform => {
      const design = platforms[platform];
      const plan = result.destinations[platform];
      const selected = plan.fragments.map(id => fragments[id]).filter(Boolean);
      for (const warning of fidelityWarnings(plan.copy, selected)) warnings.add(warning);
      return { draft_id: record.content_id + '-' + platform, platform, format: design.format, status: 'DRAFT',
        text: plan.copy, hashtags: preferences.hashtags ? hashtagsFor(profile, selected) : [], media: intent.media };
    });
    const output = {
      draft_contract_version: '1.0',
      content_id: record.content_id,
      project_id: record.project_id,
      profile_version: record.profile_version,
      status: 'DRAFT',
      generation: { provider: provider.name, model: provider.model, prompt_version: prompt.version,
        mode: intent.mode, topics: intent.topics, provenance: provider.name === 'template' ? 'template_fallback' : 'model',
        attempted, generated_at: generatedAt, duration_ms: duration,
        visual_category: imageUsed ? result.visual : null },
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

module.exports = { createEditorialEngine, schemaFor, validatePlan, interpretIntent };
