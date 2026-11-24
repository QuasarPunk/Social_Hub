const { sanitizedEditorialFailure } = require('./editorial-provider.cjs');

const pending = new Set();

function startEditorialPreview(message, { capture, editorial, callTelegram, expectedBot, log }, stop) {
  const command = typeof message.text === 'string'
    && message.text.match(/^\/borrador(?:@([A-Za-z0-9_]+))?(?:\s+(\S+))?\s*$/i);
  if (!command) return false;
  const chat_id = message.chat.id;
  const user = message.from?.id;
  if (command[1] && command[1].toLowerCase() !== expectedBot?.toLowerCase()) return true;
  if (!capture?.permitted(chat_id, user)) return true;
  const actor = chat_id + ':' + user;
  if (pending.has(actor)) return true;
  pending.add(actor);

  const reply = text => callTelegram('sendMessage', { chat_id, text }, 5000, stop);
  (async () => {
    const platform = command[2]?.toLowerCase();
    if (platform && !['instagram', 'facebook', 'linkedin'].includes(platform)) {
      await reply('Usá /borrador, /borrador instagram, /borrador facebook o /borrador linkedin.');
      return;
    }
    if (capture?.pending?.(chat_id, user)) {
      await reply('Hay una captura abierta o en proceso. Cerrala con /listo o esperá la confirmación antes de pedir /borrador.');
      return;
    }
    const id = editorial.latest(chat_id, user);
    if (!id) {
      await reply('Todavía no hay una captura clasificada. Cerrala con /listo y esperá la confirmación.');
      return;
    }
    let result;
    try {
      result = await editorial.request(id, stop);
    } catch (failure) {
      if (stop.aborted) return;
      log('editorial.request stage=preview ' + sanitizedEditorialFailure(failure));
      const explanations = {
        editorial_busy: 'Hay otro borrador en curso. Volvé a intentar en un momento.',
        no_editorial_facts: 'La captura necesita texto, una descripción o voz transcrita para preparar el borrador.',
        no_supported_platforms: 'El perfil no tiene plataformas compatibles habilitadas.',
        provider_quota: 'El proveedor alcanzó su cuota. El registro sigue disponible para reintentar.',
      };
      await reply(explanations[failure.code] ?? 'No se pudo preparar el borrador. Podés reintentar con /borrador.');
      return;
    }
    const draft = platform ? result.drafts.find(item => item.platform === platform) : result.drafts[0];
    if (!draft) { await reply('Esa plataforma no está habilitada para la captura.'); return; }
    await reply(['Borrador para ' + draft.platform, draft.text, draft.hashtags.join(' ')].filter(Boolean).join('\n\n'));
  })().catch(() => { if (!stop.aborted) log('No se pudo responder la consulta de borrador.'); }).finally(() => pending.delete(actor));
  return true;
}

module.exports = { startEditorialPreview };
