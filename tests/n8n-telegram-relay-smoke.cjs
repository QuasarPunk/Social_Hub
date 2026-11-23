const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { once } = require('node:events');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { promisify } = require('node:util');
const { createRelay } = require('../services/telegram-relay/server.cjs');
const workflow = require('../workflows/SH-01-telegram-servicio-prueba.json');

const run = promisify(execFile);
const relayKey = 'b'.repeat(64);
const credential = { id: 'SocialHubSmoke001', name: 'Solo prueba local', type: 'httpHeaderAuth' };
const send = workflow.nodes.find(node => node.type === 'n8n-nodes-base.httpRequest');
const fixture = JSON.parse(workflow.nodes.find(node => node.name === 'Simular clasificacion pendiente').parameters.jsonOutput);
const botToken = '123456:TEST_ONLY_NOT_A_TELEGRAM_TOKEN';

async function main() {
  let received;
  const server = createRelay({
    botToken, relayKey, allowedChats: [fixture.chat_id],
    fetchTelegram: async (url, options) => {
      received = { url, payload: JSON.parse(options.body) };
      return Response.json({ ok: true, result: { message_id: 1 } });
    },
  });
  const directory = mkdtempSync(join(tmpdir(), 'social-hub-smoke-'));
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    send.parameters.url = `http://127.0.0.1:${server.address().port}/sendMessage`;
    send.credentials = { httpHeaderAuth: { id: credential.id, name: credential.name } };
    workflow.id = 'SocialHubSmoke002';
    const workflowPath = join(directory, 'workflow.json');
    const credentialsPath = join(directory, 'credentials.json');
    writeFileSync(workflowPath, JSON.stringify(workflow));
    writeFileSync(credentialsPath, JSON.stringify([{
      ...credential, data: { name: 'Authorization', value: `Bearer ${relayKey}` },
    }]), { mode: 0o600 });
    const env = {
      ...process.env,
      N8N_USER_FOLDER: directory,
      N8N_ENCRYPTION_KEY: 'test-only-encryption-key',
      N8N_DIAGNOSTICS_ENABLED: 'false',
      N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
    };
    const { stdout: version } = await run('n8n', ['--version'], { env });
    console.log(`n8n ${version.trim()}`);
    assert.equal(version.trim(), '2.48.6');
    await run('n8n', ['import:credentials', '--input', credentialsPath], { env });
    await run('n8n', ['import:workflow', '--input', workflowPath], { env });
    const { stdout } = await run('n8n', ['execute', '--id', workflow.id, '--rawOutput'], { env });
    assert.match(stdout, /"message_id"\s*:\s*1/);
    assert.equal(received.url, `https://api.telegram.org/bot${botToken}/sendMessage`);
    assert.equal(received.payload.chat_id, fixture.chat_id);
    assert.match(received.payload.text, /Seleccionar proyecto/);
    assert.deepEqual(received.payload.reply_markup.inline_keyboard, fixture.clarification.options.map(project => [{
      text: project.name,
      callback_data: `sh:${fixture.content_id}:${project.project_id}`,
    }]));
    console.log('n8n ejecutó el borrador y el simulador recibió los tres botones.');
  } finally {
    server.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

main().catch(failure => {
  console.error(failure.stderr || failure.stdout || failure.message);
  process.exitCode = 1;
});
