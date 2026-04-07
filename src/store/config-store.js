import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const dataDir = path.resolve(process.cwd(), '..', 'data');
const configFile = path.join(dataDir, 'configs.json');

export async function listConfigs() {
  const configs = await readConfigs();
  return configs.sort((a, b) => a.name.localeCompare(b.name) || a.created_at.localeCompare(b.created_at));
}

export async function getConfig(id) {
  const configs = await readConfigs();
  return configs.find((config) => config.id === id) ?? null;
}

export async function createConfig(input) {
  const configs = await readConfigs();
  const now = new Date().toISOString();
  const config = {
    ...input,
    id: randomUUID(),
    created_at: now,
    updated_at: now
  };

  configs.push(config);
  await writeConfigs(configs);
  return config;
}

export async function updateConfig(id, input) {
  const configs = await readConfigs();
  const index = configs.findIndex((config) => config.id === id);
  if (index === -1) {
    return null;
  }

  const updatedConfig = {
    ...configs[index],
    ...input,
    id,
    created_at: configs[index].created_at,
    updated_at: new Date().toISOString()
  };
  configs[index] = updatedConfig;
  await writeConfigs(configs);
  return updatedConfig;
}

export async function deleteConfig(id) {
  const configs = await readConfigs();
  const nextConfigs = configs.filter((config) => config.id !== id);
  if (nextConfigs.length === configs.length) {
    return false;
  }

  await writeConfigs(nextConfigs);
  return true;
}

async function readConfigs() {
  await ensureStore();

  try {
    const raw = await readFile(configFile, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeConfigs(configs) {
  await ensureStore();
  await writeFile(configFile, JSON.stringify(configs, null, 2) + '\n', 'utf8');
}

async function ensureStore() {
  await mkdir(dataDir, {recursive: true});
}
