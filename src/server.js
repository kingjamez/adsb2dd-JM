import express from 'express';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {parseStoredConfigInput} from './core/config.js';
import {createRuntimeManager} from './runtime/manager.js';
import {
  createConfig,
  deleteConfig,
  getConfig,
  listConfigs,
  updateConfig
} from './store/config-store.js';

const app = express();
const port = process.env.PORT || 3000;
const startTime = Date.now();
const runtimeManager = createRuntimeManager();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiDir = path.join(__dirname, 'ui');

app.use(express.json());
app.use(express.static(uiDir));

app.get('/api/health', (req, res) => {
  const status = runtimeManager.getStatus();
  const hasErrors = status.configs.some((config) => config.last_error !== null);

  return res.json({
    ok: true,
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    active_configs: status.active_configs,
    has_errors: hasErrors
  });
});

app.get('/api/dd', async (req, res) => {
  console.log(req.originalUrl);

  const result = await runtimeManager.ensureConfig(req.query);
  if (!result.ok) {
    return res.status(result.status).json(result.body);
  }

  return res.json(result.state.out);
});

app.get('/api/status', (req, res) => {
  const status = runtimeManager.getStatus();

  res.json({
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    active_configs: status.active_configs,
    configs: status.configs
  });
});

app.get('/api/configs', async (req, res) => {
  return res.json(await listConfigs());
});

app.post('/api/configs', async (req, res) => {
  const config = parseStoredConfigInput(req.body);
  if (!config) {
    return res.status(400).json({error: 'Invalid config payload.'});
  }

  return res.status(201).json(await createConfig(config));
});

app.get('/api/configs/:id', async (req, res) => {
  const config = await getConfig(req.params.id);
  if (!config) {
    return res.status(404).json({error: 'Config not found.'});
  }

  return res.json(config);
});

app.put('/api/configs/:id', async (req, res) => {
  const existing = await getConfig(req.params.id);
  if (!existing) {
    return res.status(404).json({error: 'Config not found.'});
  }

  const nextConfig = parseStoredConfigInput({...existing, ...req.body});
  if (!nextConfig) {
    return res.status(400).json({error: 'Invalid config payload.'});
  }

  return res.json(await updateConfig(req.params.id, nextConfig));
});

app.delete('/api/configs/:id', async (req, res) => {
  const deleted = await deleteConfig(req.params.id);
  runtimeManager.stopStoredConfig(req.params.id);
  if (!deleted) {
    return res.status(404).json({error: 'Config not found.'});
  }

  return res.status(204).end();
});

app.post('/api/configs/:id/start', async (req, res) => {
  const config = await getConfig(req.params.id);
  if (!config) {
    return res.status(404).json({error: 'Config not found.'});
  }

  const result = await runtimeManager.startStoredConfig(config);
  if (!result.ok) {
    return res.status(result.status).json(result.body);
  }

  return res.json({
    config_id: config.id,
    status: 'running'
  });
});

app.post('/api/configs/:id/stop', async (req, res) => {
  const config = await getConfig(req.params.id);
  if (!config) {
    return res.status(404).json({error: 'Config not found.'});
  }

  runtimeManager.stopStoredConfig(config.id);
  return res.json({
    config_id: config.id,
    status: 'idle'
  });
});

app.get('/api/configs/:id/runtime', async (req, res) => {
  const config = await getConfig(req.params.id);
  if (!config) {
    return res.status(404).json({error: 'Config not found.'});
  }

  const runtime = runtimeManager.getRuntimeByConfigId(config.id);
  if (!runtime) {
    return res.json({
      config_id: config.id,
      status: 'idle',
      last_fetch_at: null,
      last_process_at: null,
      warm_samples_ready: false,
      aircraft_count: 0,
      doppler_ready_count: 0,
      last_error: null
    });
  }

  return res.json(runtime);
});

app.get('/api/configs/:id/output', async (req, res) => {
  const config = await getConfig(req.params.id);
  if (!config) {
    return res.status(404).json({error: 'Config not found.'});
  }

  return res.json(runtimeManager.getOutputByConfigId(config.id) ?? {});
});

app.get('/', (req, res) => {
  return res.sendFile(path.join(uiDir, 'index.html'));
});

app.listen(port, '::', () => {
  console.log(`Server is running on port ${port}`);
});

runtimeManager.schedule();

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received.');
  process.exit(0);
});
