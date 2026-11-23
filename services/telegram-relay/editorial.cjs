const { randomUUID } = require('node:crypto');
const { readFileSync, readdirSync, renameSync, writeFileSync, unlinkSync, linkSync } = require('node:fs');
const { join } = require('node:path');

const slug = '[a-z0-9][a-z0-9_-]*';
const projectId = /^[a-z0-9][a-z0-9_-]{0,34}$/;
const text = value => typeof value === 'string' && value.isWellFormed() && !!value.trim();
const textList = value => Array.isArray(value) && value.every(text);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const normalize = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const escapeRegex = value => value.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');

function loadProjects(directory) {
  const projects = new Map();
  const directories = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('_'))
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));
  for (const entry of directories) {
    const profile = JSON.parse(readFileSync(join(directory, entry.name, 'profile.json'), 'utf8'));
    if (profile?.active === false) continue;
    if (profile?.active !== true || profile.schema_version !== '1.0'
      || !Number.isSafeInteger(profile.profile_version) || profile.profile_version < 1
      || profile.project_id !== entry.name || !projectId.test(entry.name)
      || !text(profile.name) || [...profile.name].length > 128 || !textList(profile.aliases)
      || !text(profile.identity?.description) || !text(profile.audience?.description)
      || !text(profile.communication?.language) || !textList(profile.communication?.tone) || !profile.communication.tone.length
      || !textList(profile.editorial?.topics) || !textList(profile.editorial?.restrictions)
      || !object(profile.platforms) || !Object.keys(profile.platforms).length
      || !Object.values(profile.platforms).every(config => typeof config?.enabled === 'boolean')) {
      throw new Error('invalid_editorial_profile');
    }
    projects.set(profile.project_id, profile);
  }
  if (!projects.size || projects.size > 100) throw new Error('invalid_catalog_size');
  return projects;
}

function classifyRecord(record, projects) {
  const instruction = normalize(record.instruction);
  const aliases = [...projects.values()].map(profile => ({
    profile, names: [...new Set([profile.project_id, profile.name, ...profile.aliases].map(normalize).filter(Boolean))],
  }));
  const prefix = instruction.match(/^([^:]+):/)?.[1].trim();
  const explicit = projects.get(prefix);
  let matches = explicit ? [{ profile: explicit }] : aliases.filter(({ names }) => names.includes(prefix));
  let method = 'explicit_prefix';
  if (!matches.length) {
    method = 'alias_match';
    matches = aliases.filter(({ names }) => names.some(alias =>
      new RegExp('(^|[^\\p{L}\\p{N}_])' + escapeRegex(alias) + '($|[^\\p{L}\\p{N}_])', 'u').test(instruction)));
  }
  const option = ({ profile }) => ({ project_id: profile.project_id, name: profile.name });
  const pending = {
    ...record,
    status: 'PENDING_CLASSIFICATION',
    classification: {
      status: matches.length > 1 ? 'AMBIGUOUS' : 'UNIDENTIFIED',
      method: matches.length ? method : null,
      candidates: matches.map(option),
    },
    clarification: { required: true, options: (matches.length ? matches : aliases).map(option) },
  };
  return matches.length === 1 ? classifiedRecord(pending, matches[0].profile, method) : pending;
}

function classifiedRecord(record, profile, method) {
  const now = new Date().toISOString();
  return {
    ...record,
    status: 'CLASSIFIED',
    classification_contract_version: '1.0',
    project_id: profile.project_id,
    project: profile.project_id,
    profile_version: profile.profile_version,
    editorial_profile: profile,
    target_platforms: Object.keys(profile.platforms).filter(name => profile.platforms[name].enabled),
    classification: { candidates: [], ...record.classification, status: 'IDENTIFIED', method, classified_at: now },
    clarification: { ...record.clarification, required: false },
    updated_at: now,
  };
}

function readRecord(directory, contentId) {
  try {
    return JSON.parse(readFileSync(join(directory, contentId + '.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

function atomicWrite(path, bytes, createOnly = false) {
  const temp = path + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600, flush: true });
    if (createOnly) linkSync(temp, path);
    else renameSync(temp, path);
  } finally {
    try {
      unlinkSync(temp);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function saveRecord(directory, record, createOnly) {
  atomicWrite(join(directory, record.content_id + '.json'), JSON.stringify(record, null, 2) + '\n', createOnly);
}

module.exports = { slug, loadProjects, classifyRecord, classifiedRecord, readRecord, saveRecord, atomicWrite };
