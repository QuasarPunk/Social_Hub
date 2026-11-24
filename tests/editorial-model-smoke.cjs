const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createEditorialEngine } = require('/app/editorial-drafts.cjs');
const { ollamaProvider } = require('/app/editorial-provider.cjs');

async function main() {
  const root = fs.mkdtempSync(join(tmpdir(), 'sh-model-smoke-'));
  try {
    const dirs = Object.fromEntries(['records', 'drafts', 'incoming'].map(name => {
      const dir = join(root, name);
      fs.mkdirSync(dir);
      return [name, dir];
    }));
    const photo = process.argv[2];
    const vision = Boolean(photo) && process.env.EDITORIAL_VISION === '1';
    if (photo) fs.copyFileSync(photo, join(dirs.incoming, 'fixture.jpg'));
    const profile = JSON.parse(fs.readFileSync('/projects/quasarpunk/profile.json', 'utf8'));
    profile.platforms.linkedin = { enabled: true, style: 'Profesional y conciso', formats: ['post'] };
    const record = {
      content_id: 'fake-real-provider', source: 'telegram', type: 'multimodal', status: 'CLASSIFIED',
      project_id: profile.project_id, profile_version: profile.profile_version, editorial_profile: profile,
      classification_contract_version: '1.0', target_platforms: ['instagram', 'facebook', 'linkedin'],
      capture: { materials: [
        { type: 'text', text: 'Instrucciones: sin emojis; sin hashtags\nUn taller de electrónica en la Biblioteca Norte.' },
        { type: 'voice', transcription: { text: 'Probamos una placa Arduino con sensores.' } },
        ...(photo ? [{ type: 'photo', text: 'La mesa del taller.', media_path: '/files/incoming/fixture.jpg' }] : []),
      ] },
    };
    const saved = JSON.stringify(record);
    const path = join(dirs.records, record.content_id + '.json');
    fs.writeFileSync(path, saved);
    const model = process.env.EDITORIAL_MODEL ?? 'llama3.2:3b';
    const provider = ollamaProvider({ url: 'http://ollama:11434', model });
    const engine = createEditorialEngine({ ...dirs, provider, vision });
    const start = Date.now();
    const output = await engine.request(record.content_id);
    assert.equal(output.generation.provider, 'ollama');
    assert.equal(output.generation.model, model);
    assert.deepEqual(output.drafts.map(x => x.platform), ['instagram', 'facebook', 'linkedin']);
    assert.ok(output.drafts.every(x => /Biblioteca Norte|Arduino|mesa del taller/.test(x.text) && !x.hashtags.length));
    assert.equal(output.status, 'DRAFT');
    if (photo) {
      assert.ok(output.drafts.every(draft => draft.media.some(item => item.type === 'photo')));
      if (vision) assert.ok(output.generation.visual_category, 'el modelo debe procesar la foto en la primera llamada');
      else assert.ok(output.warnings.includes('foto_sin_interpretacion_visual'));
    }
    assert.deepEqual(await engine.request(record.content_id), output);
    assert.equal(fs.readFileSync(path, 'utf8'), saved);
    console.log(JSON.stringify({ seconds: (Date.now() - start) / 1000, ...output }, null, 2));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
