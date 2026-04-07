import {lla2ecef, norm, ft2m} from '../node/geometry.js';
import {isValidNumber} from '../node/validate.js';
import {computeDopplerHz} from './doppler.js';

export function isValidTar1090Payload(json) {
  return json && isValidNumber(json.now) && Array.isArray(json.aircraft);
}

export function processAircraftFrame(state, json, options) {
  removeStaleAircraft(state, options.stalePlaneSeconds);

  for (const aircraft of json.aircraft) {
    if (!isValidAircraft(aircraft)) {
      continue;
    }

    const hexCode = aircraft.hex;
    ensureAircraftState(state, hexCode);

    state.out[hexCode].timestamp = json.now + aircraft.seen_pos;
    state.out[hexCode].flight = aircraft.flight;

    if (isUnchangedPosition(state.proc[hexCode], aircraft)) {
      continue;
    }

    state.proc[hexCode].lat = aircraft.lat;
    state.proc[hexCode].lon = aircraft.lon;
    state.proc[hexCode].alt = aircraft.alt_geom;

    const tar = lla2ecef(aircraft.lat, aircraft.lon, ft2m(aircraft.alt_geom));
    const dRxTar = norm([
      state.ecefRx.x - tar.x,
      state.ecefRx.y - tar.y,
      state.ecefRx.z - tar.z
    ]);
    const dTxTar = norm([
      state.ecefTx.x - tar.x,
      state.ecefTx.y - tar.y,
      state.ecefTx.z - tar.z
    ]);
    const delay = dRxTar + dTxTar - state.dRxTx;

    state.out[hexCode].delay = limitDigits(delay/1000, 5);
    state.proc[hexCode].delays.push(delay);
    state.proc[hexCode].timestamps.push(json.now + aircraft.seen_pos);

    if (state.proc[hexCode].delays.length >= 2) {
      const dopplerResult = computeDopplerHz(
        state.proc[hexCode].delays,
        state.proc[hexCode].timestamps,
        state.fc,
        {
          minSamples: options.minDopplerSamples,
          minWindowSeconds: options.minDopplerWindowSeconds,
          smoothWindow: options.dopplerSmooth
        }
      );

      state.proc[hexCode].dopplerStatus = dopplerResult.status;
      if (dopplerResult.doppler === undefined) {
        delete(state.out[hexCode].doppler);
      } else {
        state.out[hexCode].doppler = limitDigits(dopplerResult.doppler, 5);
      }
    }

    if (state.proc[hexCode].delays.length > options.maxDelayArray) {
      state.proc[hexCode].delays.shift();
      state.proc[hexCode].timestamps.shift();
    }
  }
}

function removeStaleAircraft(state, stalePlaneSeconds) {
  for (const aircraft in state.out) {
    if (Date.now()/1000 - state.out[aircraft].timestamp > stalePlaneSeconds) {
      delete(state.out[aircraft]);
      delete(state.proc[aircraft]);
    }
  }
}

function ensureAircraftState(state, hexCode) {
  if (!(hexCode in state.out)) {
    state.out[hexCode] = {};
    state.proc[hexCode] = {
      delays: [],
      timestamps: []
    };
  }
}

function isValidAircraft(aircraft) {
  return aircraft !== null &&
    typeof aircraft === 'object' &&
    typeof aircraft.hex === 'string' &&
    aircraft.hex.length > 0 &&
    isValidNumber(aircraft.lat) &&
    isValidNumber(aircraft.lon) &&
    isValidNumber(aircraft.alt_geom) &&
    isValidNumber(aircraft.seen_pos) &&
    aircraft.flight !== undefined;
}

function isUnchangedPosition(procState, aircraft) {
  return procState.lat === aircraft.lat &&
    procState.lon === aircraft.lon &&
    procState.alt === aircraft.alt_geom;
}

function limitDigits(number, digits) {
  if (Number.isInteger(number)) {
    return number;
  }

  return number.toFixed(digits);
}
