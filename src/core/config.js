import {lla2ecef, norm} from '../node/geometry.js';
import {isValidNumber} from '../node/validate.js';

export function parseConfigFromQuery(query) {
  return normalizeRuntimeConfig({
    server: query.server,
    rx: parseCoordinateParam(query.rx),
    tx: parseCoordinateParam(query.tx),
    fc: Number(query.fc)
  });
}

export function parseStoredConfigInput(input) {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const normalized = normalizeRuntimeConfig({
    server: input.server_url,
    rx: normalizePosition(input.rx),
    tx: normalizePosition(input.tx),
    fc: Number(input.fc_mhz)
  });
  if (!normalized) {
    return null;
  }

  return {
    name: typeof input.name === 'string' ? input.name.trim() : '',
    enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    server_url: normalized.server,
    rx: buildStoredPosition(normalized.rx),
    tx: buildStoredPosition(normalized.tx),
    fc_mhz: normalized.fc,
    notes: typeof input.notes === 'string' ? input.notes : ''
  };
}

export function runtimeConfigFromStoredConfig(config) {
  return normalizeRuntimeConfig({
    server: config.server_url,
    rx: normalizePosition(config.rx),
    tx: normalizePosition(config.tx),
    fc: Number(config.fc_mhz)
  });
}

export function buildConfigKey(config) {
  return JSON.stringify({
    server: config.server,
    rx: config.rx,
    tx: config.tx,
    fc: config.fc
  });
}

export function buildApiUrl(config) {
  return config.server + '/data/aircraft.json';
}

export function createConfigState(config) {
  const [rxLat, rxLon, rxAlt] = config.rx;
  const [txLat, txLon, txAlt] = config.tx;
  const ecefRx = lla2ecef(rxLat, rxLon, rxAlt);
  const ecefTx = lla2ecef(txLat, txLon, txAlt);

  return {
    rxLat,
    rxLon,
    rxAlt,
    txLat,
    txLon,
    txAlt,
    fc: config.fc,
    server: config.server,
    apiUrl: buildApiUrl(config),
    out: {},
    proc: {},
    lastApiCall: Date.now()/1000,
    lastSourceNow: null,
    lastProcessAt: null,
    lastError: null,
    ecefRx,
    ecefTx,
    dRxTx: norm([ecefRx.x - ecefTx.x, ecefRx.y - ecefTx.y, ecefRx.z - ecefTx.z])
  };
}

function parseCoordinateParam(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 3 || !parts.every(isValidNumber)) {
    return null;
  }

  return parts;
}

function normalizeRuntimeConfig(config) {
  if (!isValidConfig(config.server, config.rx, config.tx, config.fc)) {
    return null;
  }

  return {
    server: config.server,
    rx: config.rx,
    tx: config.tx,
    fc: config.fc
  };
}

function isValidConfig(server, rx, tx, fc) {
  return typeof server === 'string' &&
    server.trim().length > 0 &&
    Array.isArray(rx) &&
    Array.isArray(tx) &&
    isValidNumber(fc);
}

function normalizePosition(position) {
  if (!position || typeof position !== 'object') {
    return null;
  }

  const latitude = Number(position.latitude);
  const longitude = Number(position.longitude);
  const altitude = Number(position.altitude);
  if (![latitude, longitude, altitude].every(isValidNumber)) {
    return null;
  }

  return [latitude, longitude, altitude];
}

function buildStoredPosition(position) {
  return {
    latitude: position[0],
    longitude: position[1],
    altitude: position[2]
  };
}
