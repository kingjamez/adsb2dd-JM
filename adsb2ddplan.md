# Roadmap

Constraint added:
- Do not return Doppler until sample count and time spacing meet a defined accuracy threshold.
- Prefer omission over low-confidence output.
- Expose readiness/confidence in runtime/status APIs.

## Build Order

1. Stabilize current behavior
- Fix request param validation before parsing.
- Canonicalize config key; stop using raw `req.originalUrl`.
- Fix config expiry logic.
- Fix aircraft field validation.
- Fix unchanged-position detection.
- Guard tar1090 fetch failures/null payloads.
- Define Doppler readiness rule:
  - minimum valid samples
  - minimum elapsed time window
  - monotonic timestamps
  - finite derivative only
- Output rule:
  - always allow valid delay
  - omit `doppler` until ready
  - include `doppler_status: warming|ready|invalid` internally, optionally in status API

2. Extract core engine
- Move pure math and filtering out of server.
- Separate:
  - config normalization
  - source payload validation
  - aircraft state update
  - delay computation
  - Doppler computation/readiness
  - output shaping

3. Add persistent configs
- Disk JSON store for configs.
- CRUD API.
- Runtime manager maps saved config -> active run state.

4. Add runtime/status layer
- Rich `/api/status`
- `/api/health`
- per-config runtime endpoint
- bounded optional request log

5. Add minimal UI
- health page
- config list/edit/start/stop
- on-demand request/response inspector
- no heavy visuals

6. Add replay
- fixture format
- replay adapter using same engine
- baseline compare
- advanced-only UI/API entry

7. Pi Zero pass
- profile CPU/mem
- cap polling/log buffers/state
- remove nonessential background work

## Module Layout

- `src/server.js`
  - Express bootstrap only
- `src/api/routes/health.js`
- `src/api/routes/status.js`
- `src/api/routes/configs.js`
- `src/api/routes/runtime.js`
- `src/api/routes/replay.js`
- `src/api/routes/requests.js`

- `src/core/config.js`
  - parse/normalize/canonicalize config
- `src/core/validate.js`
  - input + payload validation
- `src/core/geometry.js`
- `src/core/delay.js`
- `src/core/doppler.js`
  - readiness gating here
- `src/core/engine.js`
  - pure frame -> state/result update
- `src/core/output.js`
  - omit low-confidence fields

- `src/runtime/manager.js`
  - active runs, polling, state
- `src/runtime/state.js`
  - per-config aircraft histories
- `src/runtime/request-log.js`
  - bounded ring buffer

- `src/adapters/tar1090-live.js`
- `src/adapters/tar1090-replay.js`

- `src/store/config-store.js`
  - JSON-backed persistence

- `src/ui/`
  - static minimal frontend

- `fixtures/`
  - replay datasets
- `tests/`
  - unit/integration/regression

## Doppler Gate Spec

Required before returning `doppler`:
- `samples >= MIN_DOPPLER_SAMPLES`
- `time_window_s >= MIN_DOPPLER_WINDOW_S`
- timestamps strictly increasing
- all delay samples finite
- computed Doppler finite

Behavior:
- if gate fails: return aircraft without `doppler`
- status/runtime should show why:
  - `insufficient_samples`
  - `insufficient_time_window`
  - `invalid_timestamps`
  - `invalid_numeric_state`

Optional later:
- add `doppler_confidence`, but not required initially

## Endpoint Contracts

`GET /api/health`
- returns:
  - `ok`
  - `uptime_seconds`
  - `active_configs`
  - `has_errors`

`GET /api/status`
- returns:
  - service summary
  - per-config:
    - `config_id`
    - `status`
    - `last_fetch_at`
    - `last_process_at`
    - `aircraft_count`
    - `doppler_ready_count`
    - `last_error`
    - `sample_output`

`GET /api/configs`
- list saved configs

`POST /api/configs`
- create config

`GET /api/configs/:id`
- config detail

`PUT /api/configs/:id`
- update config

`DELETE /api/configs/:id`
- delete config

`POST /api/configs/:id/start`
- begin live polling/run

`POST /api/configs/:id/stop`
- stop run

`GET /api/configs/:id/runtime`
- run state:
  - `status`
  - `last_fetch_at`
  - `last_process_at`
  - `warm_samples_ready`
  - `last_error`

`GET /api/configs/:id/output`
- current aircraft output
- omit low-confidence `doppler`

`GET /api/dd`
- compatibility route
- normalize params -> canonical config
- share runtime state if identical

`GET /api/requests`
- recent bounded request summaries
- disabled unless explicitly enabled

`POST /api/requests/logging`
- enable/disable request logging

`GET /api/replay/fixtures`
- list fixtures

`POST /api/replay/:fixtureId/run`
- run replay for selected config or embedded fixture config

`GET /api/replay/:fixtureId/status`
- replay result, validation result, diff summary

## Data Shapes

`Config`
- `id`
- `name`
- `enabled`
- `server_url`
- `rx:{lat,lon,alt_m}`
- `tx:{lat,lon,alt_m}`
- `fc_mhz`
- `notes`
- `created_at`
- `updated_at`

`RunState`
- `config_id`
- `status`
- `last_fetch_at`
- `last_process_at`
- `last_source_now`
- `aircraft_count`
- `doppler_ready_count`
- `last_error`

`AircraftOutput`
- `timestamp`
- `flight`
- `delay`
- `doppler` optional

## Tests

Unit:
- geometry
- delay
- Doppler smoothing
- Doppler readiness gate
- config normalization
- payload validation

Integration:
- config CRUD
- start/stop
- status/runtime
- `/api/dd` compatibility
- fetch failure handling

Regression:
- replay fixtures
- baseline outputs
- verify Doppler omission before readiness
- verify Doppler appears after readiness

## Done Criteria

- direct API still works
- saved configs work
- health UI works
- request inspection is opt-in
- replay works for refactors
- low-confidence Doppler never returned
- bounded CPU/memory on Pi Zero
