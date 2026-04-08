import {lla2ecef, norm, ft2m} from '../node/geometry.js';
import {isValidNumber} from '../node/validate.js';
import {computeDopplerHz} from './doppler.js';

export function isValidTar1090Payload(json) {
  return json && isValidNumber(json.now) && Array.isArray(json.aircraft);
}

export function processAircraftFrame(state, json, options) {
  removeStaleAircraft(state, options.stalePlaneSeconds);

  for (const aircraft of json.aircraft) {
    const normalized = normalizeAircraft(aircraft, json.now);
    if (!normalized) {
      continue;
    }

    const hexCode = normalized.hex;
    ensureAircraftState(state, hexCode);

    writeAircraftMetadata(state.out[hexCode], normalized);
    state.proc[hexCode].lat = normalized.lat;
    state.proc[hexCode].lon = normalized.lon;
    state.proc[hexCode].alt = normalized.altitudeFeet;

    const tar = lla2ecef(normalized.lat, normalized.lon, normalized.altitudeMeters);
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

    state.out[hexCode].delay = roundDigits(delay/1000, 5);
    const latestTimestamp = state.proc[hexCode].timestamps.at(-1);
    const sampleAdvanced = latestTimestamp === undefined ||
      normalized.positionTimestamp > latestTimestamp;
    state.out[hexCode].position_sample_advanced = sampleAdvanced;

    if (sampleAdvanced) {
      state.proc[hexCode].delays.push(delay);
      state.proc[hexCode].timestamps.push(normalized.positionTimestamp);

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
        state.out[hexCode].doppler = roundNullableDigits(dopplerResult.doppler, 5);
        state.out[hexCode].doppler_raw = roundNullableDigits(dopplerResult.dopplerRaw, 5);
        state.out[hexCode].doppler_status = dopplerResult.status;
        state.out[hexCode].doppler_sample_count = dopplerResult.sampleCount;
        state.out[hexCode].doppler_window_seconds = roundDigits(dopplerResult.windowSeconds, 3);
      } else {
        state.proc[hexCode].dopplerStatus = 'insufficient_samples';
        state.out[hexCode].doppler = null;
        state.out[hexCode].doppler_raw = null;
        state.out[hexCode].doppler_status = 'insufficient_samples';
        state.out[hexCode].doppler_sample_count = state.proc[hexCode].delays.length;
        state.out[hexCode].doppler_window_seconds = 0;
      }
    }

    applyTrainingLabelAssessment(state.out[hexCode]);

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

function normalizeAircraft(aircraft, sourceNow) {
  if (aircraft === null || typeof aircraft !== 'object') {
    return null;
  }

  const altitude = getFirstValidNumber(aircraft, ['alt_geom', 'alt_baro', 'altitude']);
  if (typeof aircraft.hex !== 'string' ||
    aircraft.hex.length === 0 ||
    !isValidNumber(aircraft.lat) ||
    !isValidNumber(aircraft.lon) ||
    !isValidNumber(aircraft.seen_pos) ||
    altitude.value === null) {
    return null;
  }

  const groundSpeed = getFirstValidNumber(aircraft, ['gs', 'speed']);
  const verticalRate = getFirstValidNumber(aircraft, ['geom_rate', 'baro_rate', 'vert_rate']);
  const groundTrack = getFirstValidNumber(aircraft, ['track']);
  const positionAgeSeconds = Number(aircraft.seen_pos);

  return {
    hex: aircraft.hex,
    flight: normalizeString(aircraft.flight),
    lat: Number(aircraft.lat),
    lon: Number(aircraft.lon),
    altitudeFeet: altitude.value,
    altitudeMeters: ft2m(altitude.value),
    altitudeSource: altitude.source,
    sourceFrameTime: Number(sourceNow),
    positionTimestamp: Number(sourceNow) - positionAgeSeconds,
    positionAgeSeconds,
    messageAgeSeconds: getOptionalNumber(aircraft.seen),
    groundTrackDeg: groundTrack.value,
    groundTrackSource: groundTrack.source,
    groundSpeedKt: groundSpeed.value,
    groundSpeedSource: groundSpeed.source,
    verticalRateFpm: verticalRate.value,
    verticalRateSource: verticalRate.source,
    squawk: normalizeString(aircraft.squawk),
    category: normalizeString(aircraft.category),
    emergency: normalizeString(aircraft.emergency),
    registration: normalizeString(aircraft.r),
    aircraftTypeCode: normalizeString(aircraft.t),
    messageCount: getOptionalNumber(aircraft.messages)
  };
}

function writeAircraftMetadata(target, aircraft) {
  target.hex = aircraft.hex;
  target.timestamp = roundDigits(aircraft.positionTimestamp, 3);
  target.source_frame_time = roundDigits(aircraft.sourceFrameTime, 3);
  target.position_age_seconds = roundDigits(aircraft.positionAgeSeconds, 3);
  target.message_age_seconds = roundNullableDigits(aircraft.messageAgeSeconds, 3);
  target.flight = aircraft.flight;
  target.lat = aircraft.lat;
  target.lon = aircraft.lon;
  target.altitude_ft = aircraft.altitudeFeet;
  target.altitude_m = roundDigits(aircraft.altitudeMeters, 3);
  target.altitude_source = aircraft.altitudeSource;
  target.ground_track_deg = roundNullableDigits(aircraft.groundTrackDeg, 3);
  target.ground_track_source = aircraft.groundTrackSource;
  target.ground_speed_kt = roundNullableDigits(aircraft.groundSpeedKt, 3);
  target.ground_speed_mps = roundNullableDigits(knotsToMetersPerSecond(aircraft.groundSpeedKt), 3);
  target.ground_speed_source = aircraft.groundSpeedSource;
  target.vertical_rate_fpm = roundNullableDigits(aircraft.verticalRateFpm, 3);
  target.vertical_rate_mps = roundNullableDigits(feetPerMinuteToMetersPerSecond(aircraft.verticalRateFpm), 3);
  target.vertical_rate_source = aircraft.verticalRateSource;
  target.squawk = aircraft.squawk;
  target.category = aircraft.category;
  target.emergency = aircraft.emergency;
  target.registration = aircraft.registration;
  target.aircraft_type_code = aircraft.aircraftTypeCode;
  target.message_count = aircraft.messageCount;
}

function applyTrainingLabelAssessment(target) {
  const messageAge = target.message_age_seconds;
  const gold = target.doppler_status === 'ready' &&
    target.doppler_sample_count >= 6 &&
    target.doppler_window_seconds >= 5 &&
    target.position_age_seconds <= 0.75 &&
    isFreshEnough(messageAge, 0.75);
  const silver = target.doppler_status === 'ready' &&
    target.doppler_sample_count >= 4 &&
    target.doppler_window_seconds >= 3 &&
    target.position_age_seconds <= 1.5 &&
    isFreshEnough(messageAge, 1.5);

  target.training_label_tier = gold ? 'gold' : silver ? 'silver' : 'reject';
  target.training_label_ready = target.training_label_tier !== 'reject';
}

function isFreshEnough(value, maxAgeSeconds) {
  return value === null || value <= maxAgeSeconds;
}

function getFirstValidNumber(aircraft, keys) {
  for (const key of keys) {
    if (isValidNumber(aircraft[key])) {
      return {value: Number(aircraft[key]), source: key};
    }
  }

  return {value: null, source: null};
}

function getOptionalNumber(value) {
  return isValidNumber(value) ? Number(value) : null;
}

function normalizeString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function knotsToMetersPerSecond(knots) {
  if (!Number.isFinite(knots)) {
    return null;
  }

  return knots * 0.514444;
}

function feetPerMinuteToMetersPerSecond(feetPerMinute) {
  if (!Number.isFinite(feetPerMinute)) {
    return null;
  }

  return feetPerMinute * 0.3048 / 60;
}

function roundNullableDigits(number, digits) {
  if (number === null || number === undefined) {
    return null;
  }

  return roundDigits(number, digits);
}

function roundDigits(number, digits) {
  if (!Number.isFinite(number)) {
    return null;
  }

  if (Number.isInteger(number)) {
    return number;
  }

  return Number(number.toFixed(digits));
}
