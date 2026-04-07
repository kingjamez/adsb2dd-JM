import {checkTar1090, getTar1090} from '../node/tar1090.js';
import {
  buildApiUrl,
  buildConfigKey,
  createConfigState,
  parseConfigFromQuery,
  runtimeConfigFromStoredConfig
} from '../core/config.js';
import {isValidTar1090Payload, processAircraftFrame} from '../core/engine.js';

const defaultOptions = {
  updateMs: 1000,
  maxActiveConfigs: 10,
  staleConfigSeconds: 30,
  stalePlaneSeconds: 5,
  maxDelayArray: 10,
  dopplerSmooth: 10,
  minDopplerSamples: 4,
  minDopplerWindowSeconds: 3
};

export function createRuntimeManager(customOptions = {}) {
  const options = {...defaultOptions, ...customOptions};
  const configs = {};
  const configIds = {};

  function getStateByConfigId(configId) {
    const key = configIds[configId];
    if (!key) {
      return null;
    }

    return configs[key] ?? null;
  }

  async function ensureConfig(query) {
    const config = parseConfigFromQuery(query);
    if (!config) {
      return {ok: false, status: 400, body: {error: 'Invalid parameters.'}};
    }

    const key = buildConfigKey(config);
    if (key in configs) {
      configs[key].lastApiCall = Date.now()/1000;
      return {ok: true, key, state: configs[key]};
    }

    if (Object.keys(configs).length >= options.maxActiveConfigs) {
      return {ok: false, status: 400, body: {error: 'Exceeded max API requests.'}};
    }

    const apiUrl = buildApiUrl(config);
    const isServerValid = await checkTar1090(apiUrl);
    if (!isServerValid) {
      return {ok: false, status: 500, body: {error: 'Error checking tar1090 validity.'}};
    }

    const state = createConfigState(config);
    configs[key] = state;
    return {ok: true, key, state};
  }

  async function startStoredConfig(savedConfig) {
    const config = runtimeConfigFromStoredConfig(savedConfig);
    if (!config) {
      return {ok: false, status: 400, body: {error: 'Invalid stored config.'}};
    }

    const key = buildConfigKey(config);
    let state = configs[key];
    if (!state) {
      if (Object.keys(configs).length >= options.maxActiveConfigs) {
        return {ok: false, status: 400, body: {error: 'Exceeded max API requests.'}};
      }

      const apiUrl = buildApiUrl(config);
      const isServerValid = await checkTar1090(apiUrl);
      if (!isServerValid) {
        return {ok: false, status: 500, body: {error: 'Error checking tar1090 validity.'}};
      }

      state = createConfigState(config);
      configs[key] = state;
    }

    state.configId = savedConfig.id;
    state.pinned = true;
    state.lastApiCall = Date.now()/1000;
    configIds[savedConfig.id] = key;
    return {ok: true, state};
  }

  function stopStoredConfig(configId) {
    const key = configIds[configId];
    if (!key || !(key in configs)) {
      return false;
    }

    delete configs[key];
    delete configIds[configId];
    return true;
  }

  function getRuntimeByConfigId(configId) {
    const state = getStateByConfigId(configId);
    if (!state) {
      return null;
    }

    const aircraft = Object.keys(state.out || {});
    return {
      config_id: configId,
      status: state.lastError ? 'error' : state.lastProcessAt ? 'running' : 'warming',
      last_fetch_at: state.lastSourceNow,
      last_process_at: state.lastProcessAt,
      warm_samples_ready: aircraft.some((hex) => state.out[hex].doppler !== undefined),
      aircraft_count: aircraft.length,
      doppler_ready_count: aircraft.filter((hex) => state.out[hex].doppler !== undefined).length,
      last_error: state.lastError
    };
  }

  function getOutputByConfigId(configId) {
    const state = getStateByConfigId(configId);
    return state ? state.out : null;
  }

  function getStatus() {
    const statusConfigs = Object.entries(configs).map(([key, value]) => {
      const aircraft = Object.keys(value.out || {});
      return {
        query: key,
        server: value.server,
        fc: value.fc,
        rx: [value.rxLat, value.rxLon, value.rxAlt],
        tx: [value.txLat, value.txLon, value.txAlt],
        aircraft_count: aircraft.length,
        doppler_ready_count: aircraft.filter((hex) => value.out[hex].doppler !== undefined).length,
        last_api_call: value.lastApiCall,
        last_source_now: value.lastSourceNow,
        last_process_at: value.lastProcessAt,
        last_error: value.lastError,
        sample_aircraft: aircraft.length > 0
          ? {hex: aircraft[0], ...value.out[aircraft[0]]}
          : null
      };
    });

    return {
      active_configs: statusConfigs.length,
      configs: statusConfigs
    };
  }

  async function processAll() {
    for (const [key, value] of Object.entries(configs)) {
      if (!value.pinned && Date.now()/1000 - value.lastApiCall > options.staleConfigSeconds) {
        if (value.configId) {
          delete configIds[value.configId];
        }
        delete configs[key];
        continue;
      }

      const json = await getTar1090(value.apiUrl);
      if (!isValidTar1090Payload(json)) {
        value.lastError = 'Failed to fetch valid tar1090 data.';
        continue;
      }

      if (json.now === value.lastSourceNow) {
        continue;
      }

      value.lastError = null;
      value.lastSourceNow = json.now;
      processAircraftFrame(value, json, options);
      value.lastProcessAt = Date.now()/1000;
    }
  }

  function schedule() {
    setTimeout(async () => {
      await processAll();
      schedule();
    }, options.updateMs);
  }

  return {
    ensureConfig,
    startStoredConfig,
    stopStoredConfig,
    getRuntimeByConfigId,
    getOutputByConfigId,
    getStatus,
    schedule
  };
}
