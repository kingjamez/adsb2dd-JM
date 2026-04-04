import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

// --- Load recorder config (simple flat YAML) ---
const recorderConfigPath = process.argv[2] || path.join(
  path.dirname(new URL(import.meta.url).pathname), 'config.yaml');

function parseSimpleYaml(text) {
  const result = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([\w_]+):\s*(.+)$/);
    if (!match) continue;
    let [, key, value] = match;
    value = value.replace(/^["']|["']$/g, '').trim();
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (/^\d+$/.test(value)) value = parseInt(value);
    else if (/^\d+\.\d+$/.test(value)) value = parseFloat(value);
    result[key] = value;
  }
  return result;
}

const recorderConfig = parseSimpleYaml(fs.readFileSync(recorderConfigPath, 'utf8'));

// --- Load blah2 config.yml (full nested YAML) ---
const blah2ConfigPath = recorderConfig.blah2_config_path || '/opt/blah2/config/config.yml';
if (!fs.existsSync(blah2ConfigPath)) {
  console.error(`ERROR: blah2 config not found at ${blah2ConfigPath}`);
  console.error('Set blah2_config_path in recorder config.yaml');
  process.exit(1);
}

function parseBlah2Config(text) {
  // Parses the blah2 config.yml structure (2-3 levels deep)
  const config = {};
  let section = null;
  let subsection = null;

  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const indent = line.search(/\S/);
    const match = line.trim().match(/^([\w_]+):\s*(.*)$/);
    if (!match) continue;
    let [, key, value] = match;
    value = value.replace(/^["']|["']$/g, '').trim();

    // Parse value types
    let parsed = value;
    if (parsed === 'true') parsed = true;
    else if (parsed === 'false') parsed = false;
    else if (parsed === '') parsed = null;
    else if (/^-?\d+$/.test(parsed)) parsed = parseInt(parsed);
    else if (/^-?\d+\.\d+$/.test(parsed)) parsed = parseFloat(parsed);
    // Skip arrays like [50, 45]
    else if (parsed.startsWith('[')) parsed = parsed;

    if (indent === 0) {
      section = key;
      subsection = null;
      if (parsed === null) {
        config[section] = {};
      } else {
        config[section] = parsed;
      }
    } else if (indent === 2 && section) {
      subsection = null;
      if (parsed === null) {
        subsection = key;
        if (!config[section]) config[section] = {};
        config[section][key] = {};
      } else {
        if (!config[section]) config[section] = {};
        config[section][key] = parsed;
        subsection = null;
      }
    } else if (indent === 4 && section && subsection) {
      if (!config[section][subsection]) config[section][subsection] = {};
      config[section][subsection][key] = parsed;
    } else if (indent === 4 && section) {
      // Sometimes indent 4 without a subsection (e.g., device options)
      config[section][key] = parsed;
    }
  }
  return config;
}

const blah2Config = parseBlah2Config(fs.readFileSync(blah2ConfigPath, 'utf8'));

// --- Derive all settings from blah2 config ---
const capture = blah2Config.capture || {};
const location = blah2Config.location || {};
const truth = blah2Config.truth?.adsb || {};
const network = blah2Config.network || {};
const process_cfg = blah2Config.process || {};
const apiPort = network.ports?.api || 3000;

// SDR type normalization
const sdrType = (capture.device?.type || 'unknown').toLowerCase()
  .replace('rspduo', 'rspduo')
  .replace('usrp', 'b210')
  .replace('hackrf', 'hackrf')
  .replace('kraken', 'cr8');

const fs_hz = capture.fs || 2000000;
const fc_hz = capture.fc || 0;
const cpi = process_cfg.data?.cpi || 0.75;

// Auto-generate source label: {illuminator}_{sdr}_{fs}
// Determine illuminator from frequency
let illuminator = 'unknown';
if (fc_hz > 170000000 && fc_hz < 230000000) illuminator = 'dtv';       // VHF DTV (AU)
else if (fc_hz > 470000000 && fc_hz < 700000000) illuminator = 'dtv';  // UHF DTV
else if (fc_hz > 87000000 && fc_hz < 108000000) illuminator = 'fm';    // FM radio
else if (fc_hz > 174000000 && fc_hz < 216000000) illuminator = 'dtv';  // VHF band III

const fsLabel = fs_hz >= 1000000 ? `${fs_hz / 1000000}mhz` : `${fs_hz / 1000}khz`;
const SOURCE_LABEL = `${illuminator}_${sdrType}_${fsLabel}`;

// URLs
const BLAH2_URL = recorderConfig.blah2_api_url || `http://localhost:${apiPort}`;

// adsb2dd URL: prefer recorder config override, else build from blah2 truth config.
// If the host resolves to localhost, auto-detect docker (49155) vs bare-metal (3000).
let ADSB2DD_BASE;
if (recorderConfig.adsb2dd_url) {
  ADSB2DD_BASE = recorderConfig.adsb2dd_url;
} else if (truth.adsb2dd) {
  ADSB2DD_BASE = `http://${truth.adsb2dd}`;
} else {
  ADSB2DD_BASE = null;
}

async function probeAdsb2dd(url, timeoutMs = 2000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${url}/api/status`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch { return false; }
}

async function autoDetectAdsb2dd() {
  if (recorderConfig.adsb2dd_url) return; // explicit override, skip detection
  const DOCKER_PORT = 49155;  // docker & docker-slim host-mapped port
  const BARE_METAL_PORT = 3000; // bare-metal default
  const candidates = [
    `http://localhost:${DOCKER_PORT}`,
    `http://localhost:${BARE_METAL_PORT}`
  ];
  for (const url of candidates) {
    if (await probeAdsb2dd(url)) {
      console.log(`  auto-detect:  found adsb2dd at ${url}`);
      ADSB2DD_BASE = url;
      return;
    }
  }
  // If blah2 config had a remote host, keep that as fallback (already set above)
  if (ADSB2DD_BASE) {
    console.log(`  auto-detect:  no local adsb2dd, using blah2 config: ${ADSB2DD_BASE}`);
  }
}

// Build the full adsb2dd query URL from blah2 geometry
// This is rebuilt after auto-detection in main()
let adsb2ddQueryUrl = null;
function buildAdsb2ddQueryUrl() {
  if (ADSB2DD_BASE && truth.enabled && location.rx && location.tx) {
    const rx = location.rx;
    const tx = location.tx;
    const fcMhz = fc_hz / 1000000;
    const tar1090Server = truth.tar1090 || 'localhost';
    adsb2ddQueryUrl = `${ADSB2DD_BASE}/api/dd` +
      `?rx=${rx.latitude},${rx.longitude},${rx.altitude}` +
      `&tx=${tx.latitude},${tx.longitude},${tx.altitude}` +
      `&fc=${fcMhz}` +
      `&server=http://${tar1090Server}`;
  } else {
    adsb2ddQueryUrl = null;
  }
}
buildAdsb2ddQueryUrl();

const OUTPUT_DIR = recorderConfig.output_dir || '/opt/blah2-training-data';
const ROTATE_HOURS = recorderConfig.session_rotate_hours || 12;
const POLL_MS = recorderConfig.poll_interval_ms || Math.round(cpi * 1000);

// --- State ---
let sessionDir = null;
let framesDir = null;
let frameSeq = 0;
let sessionStart = null;
let lastMapTimestamp = null;
let stats = { frames: 0, skipped_same: 0, adsb_failures: 0, map_failures: 0 };

// --- Helpers ---
function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function sessionDirName() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toTimeString().slice(0, 5).replace(':', '');
  return `session_${date}_${time}`;
}

async function fetchJson(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// --- Session management ---
function startNewSession() {
  const sessionName = sessionDirName();
  sessionDir = path.join(OUTPUT_DIR, SOURCE_LABEL, sessionName);
  framesDir = path.join(sessionDir, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });
  frameSeq = 0;
  sessionStart = Date.now();
  stats = { frames: 0, skipped_same: 0, adsb_failures: 0, map_failures: 0 };

  const metadata = {
    session_name: sessionName,
    source_label: SOURCE_LABEL,
    illuminator,
    sdr: sdrType,
    fs: fs_hz,
    fc: fc_hz,
    cpi,
    start_time: new Date().toISOString(),
    blah2_api_url: BLAH2_URL,
    blah2_config_path: blah2ConfigPath,
    adsb2dd_query_url: adsb2ddQueryUrl,
    poll_interval_ms: POLL_MS,
    location: {
      rx: location.rx,
      tx: location.tx
    },
    ambiguity: process_cfg.ambiguity || {},
    detection: process_cfg.detection || {},
    capture: capture,
    blah2_config_raw: blah2Config
  };
  fs.writeFileSync(path.join(sessionDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
  console.log(`[${ts()}] New session: ${sessionDir}`);
}

function shouldRotateSession() {
  if (ROTATE_HOURS <= 0) return false;
  return (Date.now() - sessionStart) > (ROTATE_HOURS * 3600 * 1000);
}

function writeSessionStats() {
  if (!sessionDir) return;
  const statsPath = path.join(sessionDir, 'stats.json');
  const elapsed_hours = ((Date.now() - sessionStart) / 3600000).toFixed(2);
  fs.writeFileSync(statsPath, JSON.stringify({
    ...stats, elapsed_hours,
    end_time: new Date().toISOString()
  }, null, 2));
  console.log(`[${ts()}] Session ended: ${stats.frames} frames in ${elapsed_hours}h (${stats.skipped_same} skipped, ${stats.map_failures} map errors, ${stats.adsb_failures} adsb errors)`);
}

// --- Main recording loop ---
async function recordFrame() {
  if (shouldRotateSession()) {
    writeSessionStats();
    startNewSession();
  }

  // Fetch map data from blah2
  const mapData = await fetchJson(`${BLAH2_URL}/api/map`);
  if (!mapData) {
    stats.map_failures++;
    return;
  }

  // Skip if map hasn't updated
  const mapTimestamp = mapData.timestamp;
  if (mapTimestamp && mapTimestamp === lastMapTimestamp) {
    stats.skipped_same++;
    return;
  }
  lastMapTimestamp = mapTimestamp;

  // Fetch ADS-B truth from adsb2dd
  let truthData = null;
  if (adsb2ddQueryUrl) {
    truthData = await fetchJson(adsb2ddQueryUrl);
    if (!truthData) stats.adsb_failures++;
  }

  // Write frame
  frameSeq++;
  const frame = {
    frame_seq: frameSeq,
    timestamp: mapTimestamp || Date.now() / 1000,
    recorded_at: new Date().toISOString(),
    source_label: SOURCE_LABEL,
    map: mapData,
    truth: truthData || {}
  };

  const framePath = path.join(framesDir, `frame_${String(frameSeq).padStart(7, '0')}.json`);
  fs.writeFileSync(framePath, JSON.stringify(frame));

  stats.frames++;
  if (stats.frames % 100 === 0) {
    const elapsed = ((Date.now() - sessionStart) / 3600000).toFixed(1);
    const truthCount = truthData ? Object.keys(truthData).length : 0;
    console.log(`[${ts()}] ${stats.frames} frames (${elapsed}h) | ${truthCount} aircraft | ${stats.map_failures} map err | ${stats.adsb_failures} adsb err`);
  }
}

// --- Startup ---
async function main() {
  console.log('blah2-recorder starting');
  console.log(`  blah2 config: ${blah2ConfigPath}`);
  console.log(`  blah2 API:    ${BLAH2_URL}`);

  // Auto-detect adsb2dd if no explicit URL configured
  if (!recorderConfig.adsb2dd_url) {
    console.log('  adsb2dd:      auto-detecting...');
    await autoDetectAdsb2dd();
    buildAdsb2ddQueryUrl();
  }

  console.log(`  adsb2dd:      ${ADSB2DD_BASE || 'disabled'}`);
  console.log(`  source:       ${SOURCE_LABEL}`);
  console.log(`  illuminator:  ${illuminator} @ ${fc_hz / 1000000} MHz`);
  console.log(`  SDR:          ${sdrType} @ ${fs_hz / 1000000} MHz sampling`);
  console.log(`  CPI:          ${cpi}s`);
  console.log(`  rx:           ${location.rx?.name || 'unnamed'} (${location.rx?.latitude}, ${location.rx?.longitude}, ${location.rx?.altitude}m)`);
  console.log(`  tx:           ${location.tx?.name || 'unnamed'} (${location.tx?.latitude}, ${location.tx?.longitude}, ${location.tx?.altitude}m)`);
  console.log(`  output:       ${OUTPUT_DIR}`);
  console.log(`  poll:         ${POLL_MS}ms`);
  console.log(`  rotate:       ${ROTATE_HOURS}h`);

  // Test blah2 connection
  const testMap = await fetchJson(`${BLAH2_URL}/api/map`);
  if (!testMap) {
    console.error(`ERROR: Cannot reach blah2 at ${BLAH2_URL}/api/map`);
    process.exit(1);
  }
  console.log(`  blah2 OK:     ${testMap.nRows || '?'}x${testMap.nCols || '?'} map`);

  // Test adsb2dd connection
  if (adsb2ddQueryUrl) {
    console.log(`  adsb2dd query: ${adsb2ddQueryUrl}`);
    const testAdsb = await fetchJson(adsb2ddQueryUrl);
    if (testAdsb !== null) {
      const n = Object.keys(testAdsb).length;
      console.log(`  adsb2dd OK:   ${n} aircraft in current truth`);
    } else {
      console.warn('  WARNING: Cannot reach adsb2dd — recording maps without truth');
    }
  } else {
    console.warn('  WARNING: ADS-B truth not configured — recording maps only');
  }

  // Start recording
  startNewSession();
  console.log('  Recording started. Ctrl+C to stop.\n');

  const interval = setInterval(recordFrame, POLL_MS);

  const shutdown = () => {
    clearInterval(interval);
    writeSessionStats();
    console.log('\nRecorder stopped.');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
