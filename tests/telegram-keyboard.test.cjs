const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const workflow = require('../workflows/SH-01-telegram-teclado-prueba.json');

const nodes = new Map(workflow.nodes.map(node => [node.name, node]));
const prepare = nodes.get('Preparar botones de proyectos').parameters.jsCode;
const send = nodes.get('Enviar seleccion de proyecto').parameters;
const fixture = JSON.parse(nodes.get('Simular clasificacion pendiente').parameters.jsonOutput);

function prepareItems(record) {
  const items = vm.runInNewContext(`(function () { ${prepare} })()`, {
    Buffer,
    $input: { first: () => ({ json: record }) },
  });
  return JSON.parse(JSON.stringify(items))[0].json;
}

function resolveKeyboard(json) {
  assert.match(send.inlineKeyboard, /^=\{\{[\s\S]*\}\}$/);
  const expression = send.inlineKeyboard.slice(3, -2);
  return JSON.parse(JSON.stringify(vm.runInNewContext(expression, { $json: json })));
}

test('la copia no contiene enlaces a credenciales, webhook o workflow publicado', () => {
  assert.equal(workflow.active, false);
  for (const key of ['id', 'versionId', 'meta', 'activeVersionId']) {
    assert.ok(!Object.hasOwn(workflow, key));
  }
  assert.deepEqual(workflow.pinData, {});
  assert.equal(nodes.get('Telegram Trigger').disabled, true);
  assert.deepEqual(nodes.get('If').parameters.conditions.conditions.map(condition => condition.rightValue), ['0']);
  assert.equal(nodes.get('Clasificar contenido1').parameters.workflowId.value, '');
  assert.equal(nodes.size, workflow.nodes.length);
  assert.equal(new Set(workflow.nodes.map(node => node.id)).size, nodes.size);
  for (const node of nodes.values()) {
    assert.ok(!Object.hasOwn(node, 'credentials'));
    assert.ok(!Object.hasOwn(node, 'webhookId'));
    assert.ok(!Object.hasOwn(node.parameters, 'url'));
    for (const reference of JSON.stringify(node.parameters).matchAll(/\$\('([^']+)'\)/g)) {
      assert.ok(nodes.has(reference[1]), reference[1]);
    }
  }
  for (const [source, outputs] of Object.entries(workflow.connections)) {
    assert.ok(nodes.has(source), source);
    for (const output of outputs.main.flat()) {
      assert.ok(nodes.has(output.node), output.node);
    }
  }
  assert.equal(workflow.connections['Prueba manual'].main[0][0].node, 'Simular clasificacion pendiente');
  assert.equal(workflow.connections['Simular clasificacion pendiente'].main[0][0].node, 'Preparar botones de proyectos');
  assert.equal(workflow.connections['Preparar botones de proyectos'].main[0][0].node, 'Enviar seleccion de proyecto');
});

test('conserva el orden y el texto de los tres proyectos', () => {
  assert.equal(send.replyMarkup, 'inlineKeyboard');
  assert.deepEqual(resolveKeyboard(prepareItems(fixture)), {
    rows: [
      { row: { buttons: [{ text: 'Bitácora', additionalFields: { callback_data: 'sh:tg-1000:bitacora' } }] } },
      { row: { buttons: [{ text: 'Ecoaldea Lamat', additionalFields: { callback_data: 'sh:tg-1000:lamat' } }] } },
      { row: { buttons: [{ text: 'QuasarPunk', additionalFields: { callback_data: 'sh:tg-1000:quasarpunk' } }] } },
    ],
  });
});

test('conserva varios botones en una misma fila', () => {
  const buttons = [
    { text: 'A', callback_data: 'sh:tg-1000:a' },
    { text: 'B', callback_data: 'sh:tg-1000:b' },
  ];
  const keyboard = resolveKeyboard({ reply_markup: { inline_keyboard: [buttons] } });
  assert.equal(keyboard.rows.length, 1);
  assert.equal(keyboard.rows[0].row.buttons.length, 2);
});

test('rechaza un catálogo vacío antes de enviar', () => {
  const record = structuredClone(fixture);
  record.clarification.options = [];
  assert.throws(() => prepareItems(record), /No hay proyectos disponibles/);
});

test('acepta 64 bytes y rechaza 65 tanto en ASCII como en UTF-8 multibyte', () => {
  const record = structuredClone(fixture);
  const byteBudget = 64 - Buffer.byteLength(`sh:${record.content_id}:`, 'utf8');
  for (const projectId of ['a'.repeat(byteBudget), 'é'.repeat(Math.floor(byteBudget / 2)) + 'a'.repeat(byteBudget % 2)]) {
    record.clarification.options = [{ project_id: projectId, name: 'Proyecto ficticio' }];
    const callback = prepareItems(record).reply_markup.inline_keyboard[0][0].callback_data;
    assert.equal(Buffer.byteLength(callback, 'utf8'), 64);
    record.clarification.options[0].project_id += 'a';
    assert.throws(() => prepareItems(record), /entre 1 y 64 bytes UTF-8/);
  }
});
