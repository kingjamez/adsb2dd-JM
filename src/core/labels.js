function roundNullable(number, digits) {
  if (!Number.isFinite(number)) {
    return null;
  }

  if (Number.isInteger(number)) {
    return number;
  }

  return Number(number.toFixed(digits));
}

function buildRecorderLabel(hex, aircraft) {
  return {
    track_id: hex,
    hex,
    callsign: aircraft.flight ?? null,
    training_label_ready: aircraft.training_label_ready === true,
    training_label_tier: aircraft.training_label_tier ?? 'reject',
    source_position_time: aircraft.timestamp ?? null,
    source_frame_time: aircraft.source_frame_time ?? null,
    position_age_seconds: aircraft.position_age_seconds ?? null,
    message_age_seconds: aircraft.message_age_seconds ?? null,
    delay_km: aircraft.delay ?? null,
    doppler_hz: aircraft.doppler ?? null,
    doppler_raw_hz: aircraft.doppler_raw ?? null,
    doppler_status: aircraft.doppler_status ?? null,
    doppler_sample_count: aircraft.doppler_sample_count ?? null,
    doppler_window_seconds: aircraft.doppler_window_seconds ?? null,
    lat_deg: aircraft.lat ?? null,
    lon_deg: aircraft.lon ?? null,
    altitude_ft: aircraft.altitude_ft ?? null,
    altitude_m: aircraft.altitude_m ?? null,
    altitude_source: aircraft.altitude_source ?? null,
    ground_track_deg: aircraft.ground_track_deg ?? null,
    ground_track_source: aircraft.ground_track_source ?? null,
    ground_speed_kt: aircraft.ground_speed_kt ?? null,
    ground_speed_mps: aircraft.ground_speed_mps ?? null,
    ground_speed_source: aircraft.ground_speed_source ?? null,
    vertical_rate_fpm: aircraft.vertical_rate_fpm ?? null,
    vertical_rate_mps: aircraft.vertical_rate_mps ?? null,
    vertical_rate_source: aircraft.vertical_rate_source ?? null,
    squawk: aircraft.squawk ?? null,
    category: aircraft.category ?? null,
    emergency: aircraft.emergency ?? null,
    registration: aircraft.registration ?? null,
    aircraft_type_code: aircraft.aircraft_type_code ?? null,
    message_count: aircraft.message_count ?? null
  };
}

function compareLabels(a, b) {
  const tierRank = {
    gold: 0,
    silver: 1,
    reject: 2
  };

  return (tierRank[a.training_label_tier] ?? 3) - (tierRank[b.training_label_tier] ?? 3) ||
    ((a.position_age_seconds ?? Number.POSITIVE_INFINITY) - (b.position_age_seconds ?? Number.POSITIVE_INFINITY)) ||
    a.hex.localeCompare(b.hex);
}

export function buildRecorderSnapshot(state) {
  const labels = Object.entries(state.out || {})
    .map(([hex, aircraft]) => buildRecorderLabel(hex, aircraft))
    .sort(compareLabels);

  return {
    schema_version: 1,
    generated_at: roundNullable(Date.now()/1000, 3),
    source_frame_time: roundNullable(state.lastSourceNow, 3),
    last_process_at: roundNullable(state.lastProcessAt, 3),
    truth_time_basis: 'Per-aircraft source_position_time = aircraft.json now - seen_pos.',
    config: {
      server: state.server,
      fc_mhz: state.fc,
      rx: {
        latitude: state.rxLat,
        longitude: state.rxLon,
        altitude_m: state.rxAlt
      },
      tx: {
        latitude: state.txLat,
        longitude: state.txLon,
        altitude_m: state.txAlt
      },
      bistatic_baseline_km: roundNullable(state.dRxTx / 1000, 5)
    },
    label_stats: {
      track_count: labels.length,
      training_label_ready_count: labels.filter((label) => label.training_label_ready).length,
      gold_count: labels.filter((label) => label.training_label_tier === 'gold').length,
      silver_count: labels.filter((label) => label.training_label_tier === 'silver').length,
      reject_count: labels.filter((label) => label.training_label_tier === 'reject').length
    },
    labels
  };
}
