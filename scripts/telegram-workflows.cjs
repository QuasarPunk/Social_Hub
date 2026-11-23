const sh01 = require('../workflows/SH-01-telegram-integrado.json');
const sh02 = require('../workflows/SH-02-clasificacion-integrada.json');

function integratedDrafts({ credential, entryId, classificationId, relayUrl }) {
  const entry = { ...structuredClone(sh01), id: entryId };
  const classification = { ...structuredClone(sh02), id: classificationId };
  entry.nodes.find(node => node.type === 'n8n-nodes-base.webhook').credentials = { httpHeaderAuth: credential };
  entry.nodes.find(node => node.type === 'n8n-nodes-base.executeWorkflow').parameters.workflowId.value = classificationId;
  const request = classification.nodes.find(node => node.type === 'n8n-nodes-base.httpRequest');
  request.credentials = { httpHeaderAuth: credential };
  if (relayUrl) request.parameters.url = relayUrl + '/classify';
  return [classification, entry];
}

module.exports = { integratedDrafts };
