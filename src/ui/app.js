const state = {
  selectedConfigId: null
};

const healthGrid = document.querySelector('#health-grid');
const healthPill = document.querySelector('#health-pill');
const statusJson = document.querySelector('#status-json');
const configList = document.querySelector('#config-list');
const configCount = document.querySelector('#config-count');
const configForm = document.querySelector('#config-form');
const configFormMessage = document.querySelector('#config-form-message');
const runtimeTitle = document.querySelector('#runtime-title');
const runtimeJson = document.querySelector('#runtime-json');
const outputJson = document.querySelector('#output-json');
const runtimeRefresh = document.querySelector('#runtime-refresh');
const inspectorForm = document.querySelector('#inspector-form');
const inspectorJson = document.querySelector('#inspector-json');

document.querySelector('#refresh-all').addEventListener('click', () => refreshAll());
document.querySelector('#config-form-reset').addEventListener('click', () => {
  configForm.reset();
  configFormMessage.textContent = '';
});
runtimeRefresh.addEventListener('click', () => refreshSelectedConfig());

configForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  configFormMessage.textContent = 'Saving...';
  const formData = new FormData(configForm);

  const payload = {
    name: String(formData.get('name') || '').trim(),
    server_url: String(formData.get('server_url') || '').trim(),
    rx: {
      latitude: Number(formData.get('rx_latitude')),
      longitude: Number(formData.get('rx_longitude')),
      altitude: Number(formData.get('rx_altitude'))
    },
    tx: {
      latitude: Number(formData.get('tx_latitude')),
      longitude: Number(formData.get('tx_longitude')),
      altitude: Number(formData.get('tx_altitude'))
    },
    fc_mhz: Number(formData.get('fc_mhz')),
    notes: String(formData.get('notes') || ''),
    enabled: formData.get('enabled') === 'on'
  };

  const response = await api('/api/configs', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    configFormMessage.textContent = response.data?.error || 'Failed to save config.';
    return;
  }

  configFormMessage.textContent = `Saved ${response.data.name}.`;
  configForm.reset();
  const enabledInput = configForm.querySelector('input[name="enabled"]');
  if (enabledInput) {
    enabledInput.checked = true;
  }
  await refreshConfigs();
});

inspectorForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const method = inspectorForm.method.value;
  const path = inspectorForm.path.value.trim();
  const bodyText = inspectorForm.body.value.trim();
  const options = {method, headers: {}};

  if (bodyText) {
    try {
      options.body = JSON.stringify(JSON.parse(bodyText));
      options.headers['Content-Type'] = 'application/json';
    } catch (error) {
      inspectorJson.textContent = 'Invalid JSON body.';
      return;
    }
  }

  const response = await api(path, options);
  inspectorJson.textContent = pretty({
    ok: response.ok,
    status: response.status,
    data: response.data
  });
});

async function refreshAll() {
  await Promise.all([
    refreshHealth(),
    refreshStatus(),
    refreshConfigs(),
    refreshSelectedConfig()
  ]);
}

async function refreshHealth() {
  const response = await api('/api/health');
  if (!response.ok) {
    healthPill.textContent = 'Error';
    healthPill.className = 'pill error';
    healthGrid.innerHTML = '';
    return;
  }

  const data = response.data;
  healthPill.textContent = data.has_errors ? 'Attention' : 'Healthy';
  healthPill.className = `pill ${data.has_errors ? 'error' : 'ok'}`;
  healthGrid.innerHTML = [
    stat('Uptime', `${data.uptime_seconds}s`),
    stat('Active Configs', String(data.active_configs)),
    stat('Errors', data.has_errors ? 'Yes' : 'No')
  ].join('');
}

async function refreshStatus() {
  const response = await api('/api/status');
  statusJson.textContent = pretty(response.data ?? {error: 'Unavailable'});
}

async function refreshConfigs() {
  const response = await api('/api/configs');
  const configs = Array.isArray(response.data) ? response.data : [];
  configCount.textContent = `${configs.length} saved`;

  if (!configs.find((config) => config.id === state.selectedConfigId)) {
    state.selectedConfigId = configs[0]?.id ?? null;
  }

  configList.innerHTML = configs.length === 0
    ? '<p class="subtle">No saved configs.</p>'
    : configs.map((config) => renderConfigCard(config)).join('');

  for (const button of configList.querySelectorAll('[data-action]')) {
    button.addEventListener('click', handleConfigAction);
  }
}

async function refreshSelectedConfig() {
  runtimeRefresh.disabled = !state.selectedConfigId;

  if (!state.selectedConfigId) {
    runtimeTitle.textContent = 'Select a saved config.';
    runtimeJson.textContent = pretty({});
    outputJson.textContent = pretty({});
    return;
  }

  runtimeTitle.textContent = `Selected config: ${state.selectedConfigId}`;
  const [runtimeResponse, outputResponse] = await Promise.all([
    api(`/api/configs/${state.selectedConfigId}/runtime`),
    api(`/api/configs/${state.selectedConfigId}/output`)
  ]);

  runtimeJson.textContent = pretty(runtimeResponse.data ?? {});
  outputJson.textContent = pretty(outputResponse.data ?? {});
  highlightSelectedCard();
}

async function handleConfigAction(event) {
  const {action, id} = event.currentTarget.dataset;
  state.selectedConfigId = id;

  if (action === 'select') {
    await refreshSelectedConfig();
    return;
  }

  if (action === 'delete') {
    await api(`/api/configs/${id}`, {method: 'DELETE'});
    if (state.selectedConfigId === id) {
      state.selectedConfigId = null;
    }
    await refreshAll();
    return;
  }

  if (action === 'start' || action === 'stop') {
    await api(`/api/configs/${id}/${action}`, {method: 'POST'});
    await refreshAll();
  }
}

function renderConfigCard(config) {
  const selected = state.selectedConfigId === config.id ? 'selected' : '';
  return `
    <article class="config-card ${selected}">
      <h3>${escapeHtml(config.name || config.id)}</h3>
      <p class="config-meta">
        ${escapeHtml(config.server_url)}<br>
        RX ${config.rx.latitude}, ${config.rx.longitude}, ${config.rx.altitude}m<br>
        TX ${config.tx.latitude}, ${config.tx.longitude}, ${config.tx.altitude}m<br>
        ${config.fc_mhz} MHz
      </p>
      <div class="config-actions">
        <button class="button button-ghost" data-action="select" data-id="${config.id}">Inspect</button>
        <button class="button" data-action="start" data-id="${config.id}">Start</button>
        <button class="button button-ghost" data-action="stop" data-id="${config.id}">Stop</button>
        <button class="button button-ghost" data-action="delete" data-id="${config.id}">Delete</button>
      </div>
    </article>
  `;
}

function highlightSelectedCard() {
  for (const card of configList.querySelectorAll('.config-card')) {
    card.classList.toggle('selected', card.querySelector('[data-action="select"]')?.dataset.id === state.selectedConfigId);
  }
}

function stat(label, value) {
  return `
    <div class="stat">
      <span class="stat-label">${label}</span>
      <span class="stat-value">${value}</span>
    </div>
  `;
}

async function api(url, options = {}) {
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    let data = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        data = text;
      }
    }

    return {ok: response.ok, status: response.status, data};
  } catch (error) {
    return {ok: false, status: 0, data: {error: error.message}};
  }
}

function pretty(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

refreshAll();
setInterval(() => {
  refreshHealth();
  refreshStatus();
  refreshSelectedConfig();
}, 5000);
