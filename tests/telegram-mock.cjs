const assert = require('node:assert/strict');
const http = require('node:http');
const workflow = require('../workflows/SH-01-telegram-teclado-prueba.json');

const fixture = JSON.parse(workflow.nodes.find(
  node => node.name === 'Simular clasificacion pendiente',
).parameters.jsonOutput);
const fakeToken = '123456:TEST_ONLY_NOT_A_TELEGRAM_TOKEN';

function reply(response, status, json) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(json));
}

http.createServer(async (request, response) => {
  if (request.url === `/bot${fakeToken}/getMe`) {
    reply(response, 200, { ok: true, result: { id: 123456, is_bot: true, first_name: 'Social Hub Test' } });
    return;
  }
  if (request.method !== 'POST' || request.url !== `/bot${fakeToken}/sendMessage`) {
    reply(response, 404, { ok: false, description: 'Operación fuera de la prueba' });
    return;
  }
  try {
    request.setEncoding('utf8');
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 16384) throw new Error('Cuerpo demasiado grande');
    }
    const message = JSON.parse(body);
    assert.match(request.headers['content-type'], /^application\/json\b/);
    assert.equal(String(message.chat_id), String(fixture.chat_id));
    assert.match(message.text, /Seleccionar proyecto/);
    assert.deepEqual(message.reply_markup.inline_keyboard, fixture.clarification.options.map(project => [{
      text: project.name,
      callback_data: `sh:${fixture.content_id}:${project.project_id}`,
    }]));
    console.log('sendMessage verificado con los tres botones ficticios');
    reply(response, 200, { ok: true, result: { message_id: 1, ...message } });
  } catch {
    console.error('La solicitud no coincide con la prueba de teclado');
    reply(response, 400, { ok: false, description: 'Solicitud de prueba inválida' });
  }
}).listen(18765, '127.0.0.1', () => console.log('Simulador de Telegram en puerto 18765'));
