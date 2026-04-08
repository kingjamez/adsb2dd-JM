# adsb2dd

Lightweight API server that converts ADS-B aircraft positions into bistatic delay-Doppler coordinates for passive radar systems like [blah2](https://github.com/30hours/blah2).

Fork of [30hours/adsb2dd](https://github.com/30hours/adsb2dd) — stripped to API-only (no web frontend).

## Features

- Converts ADS-B data from a [tar1090](https://github.com/wiedehopf/tar1090) server to delay-Doppler coordinates given receiver/transmitter positions and radar center frequency.
- JSON output with bistatic delay (km), Doppler (Hz), and Doppler quality metadata per aircraft.
- Smoothed Doppler via moving median filter (k=10 samples).
- Supports multiple simultaneous receiver/transmitter geometries.
- Health check endpoint at `/api/status`.

## Quick Start (Docker)

```bash
git clone https://github.com/kingjamez/adsb2dd-JM.git /opt/adsb2dd-JM
cd /opt/adsb2dd-JM
sudo docker compose up -d
```

The API is available at `http://localhost:3000/api/dd`.

For bare-metal deployment (no Docker), see the `bare-metal` branch.

## API

### GET /api/dd

Returns operator-friendly delay-Doppler coordinates for all tracked aircraft.

**Parameters:**
- `rx` — receiver lat,lon,alt (e.g. `38.877,-77.399,50`)
- `tx` — transmitter lat,lon,alt (e.g. `38.999,-77.057,750`)
- `fc` — center frequency in MHz (e.g. `101.1`)
- `server` — tar1090 URL (e.g. `http://192.168.1.10/tar1090`)

**Example:**
```
GET /api/dd?rx=38.877,-77.399,50&tx=38.999,-77.057,750&fc=101.1&server=http://192.168.1.10/tar1090
```

**Response:**
```json
{
  "a86ab5": {
    "timestamp": 1700000000,
    "flight": "UAL947",
    "delay": 12.345,
    "doppler": -23.456,
    "doppler_raw": -24.018,
    "doppler_status": "ready",
    "doppler_sample_count": 8,
    "doppler_window_seconds": 7.234
  }
}
```

The first call to a new set of parameters returns `{}` while the processing loop initializes. Subsequent calls return computed data.

When Doppler is still warming up or invalid, the API returns `"doppler": null` instead of omitting the field or forcing it to `0`. Use `doppler_status` to distinguish `insufficient_samples`, `insufficient_time_window`, `invalid_timestamps`, `invalid_numeric_state`, and `ready`.

### GET /api/labels

Returns a recorder-oriented truth-data snapshot for downstream passive-radar capture pipelines using the same query parameters as `/api/dd`.

Key differences from `/api/dd`:
- Includes `training_label_ready` and `training_label_tier` (`gold`, `silver`, `reject`).
- Includes timing metadata needed for radar alignment: `source_position_time`, `source_frame_time`, `position_age_seconds`, and `message_age_seconds`.
- Includes aircraft kinematics and identity metadata when available: position, altitude, speed, track, vertical rate, squawk, category, registration, and aircraft type code.
- Uses `source_position_time = aircraft.json now - seen_pos`, matching dump1090 / tar1090 semantics.

Example:
```json
{
  "schema_version": 1,
  "generated_at": 1700000001.123,
  "source_frame_time": 1700000000.917,
  "last_process_at": 1700000001.101,
  "truth_time_basis": "Per-aircraft source_position_time = aircraft.json now - seen_pos.",
  "config": {
    "server": "http://192.168.1.10/tar1090",
    "fc_mhz": 101.1,
    "rx": {"latitude": 38.877, "longitude": -77.399, "altitude_m": 50},
    "tx": {"latitude": 38.999, "longitude": -77.057, "altitude_m": 750},
    "bistatic_baseline_km": 31.02217
  },
  "label_stats": {
    "track_count": 1,
    "training_label_ready_count": 1,
    "gold_count": 1,
    "silver_count": 0,
    "reject_count": 0
  },
  "labels": [
    {
      "track_id": "a86ab5",
      "hex": "a86ab5",
      "callsign": "UAL947",
      "training_label_ready": true,
      "training_label_tier": "gold",
      "source_position_time": 1700000000.456,
      "source_frame_time": 1700000000.917,
      "position_age_seconds": 0.461,
      "message_age_seconds": 0.212,
      "delay_km": 12.345,
      "doppler_hz": -23.456,
      "doppler_raw_hz": -24.018,
      "doppler_status": "ready",
      "doppler_sample_count": 8,
      "doppler_window_seconds": 7.234,
      "lat_deg": 38.901234,
      "lon_deg": -77.123456,
      "altitude_ft": 12000,
      "altitude_m": 3657.6,
      "ground_track_deg": 84.2,
      "ground_speed_kt": 245.3,
      "ground_speed_mps": 126.194
    }
  ]
}
```

### GET /api/status

Returns uptime, active configurations, and sample aircraft data.

## How It Works

- Fetches aircraft positions from tar1090's `/data/aircraft.json` endpoint every second.
- Converts lat/lon/alt to ECEF coordinates.
- Computes bistatic delay: `d(rx,target) + d(tx,target) - d(rx,tx)`.
- Computes bistatic Doppler as the smoothed rate-of-change of delay using a moving median filter.
- Inactive request sets are dropped after 30 seconds without an API call.

## License

[MIT](https://choosealicense.com/licenses/mit/)
