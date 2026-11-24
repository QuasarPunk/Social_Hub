const fs = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createEditorialEngine } = require('/app/editorial-drafts.cjs');
const { ollamaProvider } = require('/app/editorial-provider.cjs');

const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const generic = /^(?:en un mundo|descubr[ií]|te invitamos|una parada en la agenda|una propuesta de|para compartir con la comunidad)/i;

function words(text) {
  return new Set(text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(word => word.length > 4));
}

function overlap(first, second) {
  const a = words(first);
  const b = words(second);
  const shared = [...a].filter(word => b.has(word)).length;
  return shared / Math.max(1, Math.min(a.size, b.size));
}

function metrics(caseItem, output) {
  const texts = output.drafts.map(item => item.text);
  const checks = caseItem.checks.map(token => texts.every(text => text.toLowerCase().includes(token.toLowerCase())));
  let pairs = 0;
  let total = 0;
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      total += overlap(texts[i], texts[j]);
      pairs++;
    }
  }
  return {
    restriction_ok: texts.every(text => !/#\p{L}/u.test(text) && !emoji.test(text)),
    no_final_question: caseItem.instruction.includes('sin llamada a la acción')
      ? texts.every(text => !/\?/.test(text)) : null,
    facts_ok: checks.every(Boolean),
    checks,
    distinct_platforms: new Set(texts).size === texts.length,
    average_overlap: Number((total / Math.max(1, pairs)).toFixed(2)),
    generic_opening: texts.some(text => generic.test(text.replace(/^✦\s*/u, ''))),
    lengths: texts.map(text => text.length),
    warnings: output.warnings,
    errors: output.errors,
    attempted: output.generation.attempted,
    prompt_version: output.generation.prompt_version,
  };
}

async function main() {
  const model = process.env.EDITORIAL_MODEL ?? 'llama3.2:3b';
  const cases = JSON.parse(fs.readFileSync('/test/fixtures/editorial-quality.json', 'utf8'));
  const provider = ollamaProvider({ url: 'http://ollama:11434', model, timeoutMs: 120000 });
  const results = [];
  let totalSeconds = 0;
  for (const caseItem of cases) {
    const root = fs.mkdtempSync(join(tmpdir(), 'sh-quality-'));
    const dirs = Object.fromEntries(['records', 'drafts', 'incoming'].map(name => {
      const dir = join(root, name);
      fs.mkdirSync(dir);
      return [name, dir];
    }));
    const profile = JSON.parse(fs.readFileSync('/projects/' + caseItem.project + '/profile.json', 'utf8'));
    const record = {
      content_id: 'quality-' + caseItem.id,
      source: 'telegram',
      type: 'multimodal',
      status: 'CLASSIFIED',
      project_id: caseItem.project,
      profile_version: profile.profile_version,
      editorial_profile: profile,
      classification_contract_version: '1.0',
      target_platforms: caseItem.platforms,
      capture: { materials: [{ type: 'text', text: caseItem.instruction + '\n' + caseItem.text }] },
    };
    fs.writeFileSync(join(dirs.records, record.content_id + '.json'), JSON.stringify(record));
    const engine = createEditorialEngine({ ...dirs, provider });
    const start = Date.now();
    let output;
    let failure;
    try {
      output = await engine.request(record.content_id);
    } catch (error) {
      failure = error.code ?? error.message;
    }
    const seconds = (Date.now() - start) / 1000;
    totalSeconds += seconds;
    results.push({
      case: caseItem.id,
      seconds: Number(seconds.toFixed(1)),
      failure: failure ?? null,
      metrics: output ? metrics(caseItem, output) : null,
      drafts: output ? output.drafts.map(item => ({ platform: item.platform, text: item.text })) : [],
    });
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ model, total_seconds: Number(totalSeconds.toFixed(1)), cases: results }, null, 2));
}

main().catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
