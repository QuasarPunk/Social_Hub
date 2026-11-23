const { spawnSync } = require('node:child_process');
const { readFileSync, renameSync, unlinkSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { integratedDrafts } = require('./telegram-workflows.cjs');

const root = resolve(__dirname, '..');
const secretDir = join(root, 'secrets', 'telegram-dev');
const compose = ['compose', '--env-file', '.env.example', '-p',
  'social-hub-telegram-dev', '-f', 'compose.telegram-dev.yml'];

function run(command, args, message, input) {
  const result = spawnSync(command, args, { cwd: root, input, encoding: 'utf8', timeout: 180000 });
  if (result.status !== 0) throw new Error(message);
  return result.stdout.trim();
}

function readSecret(name) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(join(secretDir, name))).trim();
  } catch {
    throw new Error(`No se pudo leer ${name} como UTF-8.`);
  }
}

function validateSecrets() {
  const files = ['bot-token', 'relay-key', 'allowed-chats'];
  const tracked = run('git', ['ls-files', '--', 'secrets/'], 'No se pudo revisar Git.');
  if (tracked) throw new Error('Git tiene archivos versionados en secrets/.');
  for (const name of [...files, '.allowed-chats.tmp']) {
    run('git', ['check-ignore', '--quiet', '--', `secrets/telegram-dev/${name}`],
      'Git debe ignorar todos los archivos de secrets/telegram-dev/.');
  }
  const token = readSecret('bot-token');
  const key = readSecret('relay-key');
  const list = readSecret('allowed-chats');
  if (!/^[0-9]+:[A-Za-z0-9_-]+$/.test(token)) throw new Error('Formato inválido en bot-token.');
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Formato inválido en relay-key.');

  // Accept unambiguous lists of decimal IDs and store the relay's line-based format.
  const source = list.startsWith('[') && list.endsWith(']') ? list.slice(1, -1).trim() : list;
  const entries = source.includes(',') ? source.split(',') : source.split(/\r?\n/);
  const chats = entries.map(value => value.trim().replace(/^"(-?[1-9][0-9]*)"$/, '$1'));
  if (chats.some(value => !/^-?[1-9][0-9]{0,15}$/.test(value) || Math.abs(Number(value)) >= 2 ** 52)) {
    throw new Error('allowed-chats requiere IDs decimales no nulos de hasta 52 bits.');
  }
  const relayLines = list.split(/\r?\n/).map(line => line.trim());
  if (relayLines.join('\n') !== chats.join('\n')) {
    const temp = join(secretDir, '.allowed-chats.tmp');
    writeFileSync(temp, chats.join('\n') + '\n', { flag: 'wx', mode: 0o600 });
    try {
      renameSync(temp, join(secretDir, 'allowed-chats'));
    } catch {
      unlinkSync(temp);
      throw new Error('No se pudo normalizar allowed-chats.');
    }
    console.log('allowed-chats normalizado a un ID decimal por línea.');
  }
  console.log('Los tres secretos tienen formato válido y Git los ignora.');
  return { key, chats: [...new Set(chats)] };
}

function draftFor(chat, credential) {
  const workflow = require('../workflows/SH-01-telegram-servicio-prueba.json');
  const simulation = workflow.nodes.find(node => node.name === 'Simular clasificacion pendiente');
  const fixture = JSON.parse(simulation.parameters.jsonOutput);
  fixture.chat_id = Number(chat);
  fixture.clarification.options = ['quasarpunk', 'lamat', 'bitacora'].map(id => {
    const profile = require(`../projects/${id}/profile.json`);
    return { project_id: profile.project_id, name: profile.name };
  });
  simulation.parameters.jsonOutput = JSON.stringify(fixture, null, 2);
  const send = workflow.nodes.find(node => node.type === 'n8n-nodes-base.httpRequest');
  send.credentials = { httpHeaderAuth: { id: credential.id, name: credential.name } };
  workflow.id = 'SocialHubTelegramDev01';
  workflow.name = 'Social Hub 0.1 - Prueba manual Telegram Dev';
  return workflow;
}

async function main() {
  const { key, chats } = validateSecrets();
  run('docker', [...compose, 'config', '--quiet'], 'Docker Compose rechazó la configuración de desarrollo.');
  console.log('Configuración de Docker Compose válida.');
  if (process.argv.includes('--check')) return;
  const integrated = process.argv.includes('--integrated');
  if (!integrated && chats.length !== 1) throw new Error('Para preparar el borrador, dejá un único destino en allowed-chats.');

  const credential = { id: 'SocialHubTelegramAuth01', name: 'Telegram Relay Dev', type: 'httpHeaderAuth' };
  const workflows = integrated ? integratedDrafts({
    credential: { id: credential.id, name: credential.name },
    entryId: 'SocialHubDevEntry01',
    classificationId: 'SocialHubDevClass02',
  }) : [draftFor(chats[0], credential)];
  if (integrated) {
    process.env.TELEGRAM_POLLING = '0';
    process.env.TELEGRAM_DEV_CALLBACKS = '0';
  }
  run('docker', [...compose, 'up', '-d', '--build'],
    'No se pudo iniciar Docker Compose de desarrollo. Revisá el acceso al motor de Docker.');

  for (let attempt = 0; ; attempt++) {
    const health = await fetch('http://127.0.0.1:5680/healthz/readiness', {
      signal: AbortSignal.timeout(2000),
    }).catch(() => null);
    if (health?.ok) break;
    if (attempt === 29) throw new Error('n8n no respondió en el puerto 5680.');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const container = [...compose, 'exec', '-T', 'n8n'];
  const probe = `
    const key = require('node:fs').readFileSync(0, 'utf8');
    fetch('http://telegram-relay:8080/sendMessage', {
      headers: { authorization: 'Bearer ' + key },
      signal: AbortSignal.timeout(5000),
    }).then(response => { process.exitCode = response.status === 405 ? 0 : 1; })
      .catch(() => { process.exitCode = 1; });
  `;
  run('docker', [...container, 'node', '-e', probe],
    'El relay no confirmó conectividad y autenticación desde n8n.', key);
  console.log('n8n responde en el puerto 5680 y el relay acepta la clave interna.');

  // Keep plaintext input in a private temporary directory inside the dev container.
  const importDraft = [
    'set -eu', 'umask 077', 'dir=$(mktemp -d)', 'trap \'rm -rf -- "$dir"\' EXIT',
    'cd "$dir"',
    'node -e \'const fs = require("node:fs"); const data = JSON.parse(fs.readFileSync(0, "utf8")); fs.writeFileSync("credentials.json", JSON.stringify(data.credentials)); fs.writeFileSync("workflow.json", JSON.stringify(data.workflows));\'',
    'n8n import:credentials --input=credentials.json',
    'n8n import:workflow --activeState=false --input=workflow.json',
  ].join('\n');
  run('docker', [...container, 'sh', '-c', importDraft], 'No se pudo importar el borrador y la credencial en n8n.',
    JSON.stringify({ credentials: [{ ...credential, data: { name: 'Authorization', value: `Bearer ${key}` } }], workflows }));
  console.log('Borradores y credencial Header Auth importados en n8n de desarrollo.');
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
