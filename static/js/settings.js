// ─── Settings Page ───────────────────────────────────────────────────────────

let allSettingsModels = [];

function init_settings() {
    loadConfig();
    loadHealthInfo();
    loadModels();
    bindSettingsEvents();

    // Init Autohide setting UI
    const autohideToggle = document.getElementById('set-autohide');
    if (autohideToggle) {
        autohideToggle.checked = localStorage.getItem('nim_autohide_sidebar') === 'true';
    }
}

async function loadConfig() {
    try {
        const resp = await fetch('/api/config');
        const cfg = await resp.json();
        document.getElementById('set-temperature').value = cfg.default_temperature || 1.0;
        document.getElementById('set-max-tokens').value = cfg.default_max_tokens || 1024;
        document.getElementById('set-top-p').value = cfg.default_top_p || 0.95;
    } catch (e) {
        console.error('Failed to load config:', e);
    }
}

async function loadHealthInfo() {
    try {
        const resp = await fetch('/api/health');
        const data = await resp.json();
        document.getElementById('set-version').textContent = data.version || '—';
        document.getElementById('set-uptime').textContent = data.uptime || '—';
    } catch {}
}

async function loadModels() {
    const select = document.getElementById('set-model-select');
    const refreshBtn = document.getElementById('btn-refresh-models');
    refreshBtn.disabled = true;

    try {
        const [modelsResp, healthResp] = await Promise.all([
            fetch('/v1/models'),
            fetch('/api/health')
        ]);
        const modelsData = await modelsResp.json();
        const healthData = await healthResp.json();

        if (modelsData.data) {
            allSettingsModels = modelsData.data;
            renderModelSelect(allSettingsModels, healthData.current_model);
        }
    } catch (e) {
        select.innerHTML = '<option>Error loading models</option>';
    } finally {
        refreshBtn.disabled = false;
    }
}

function renderModelSelect(models, activeModel, filter = '') {
    const select = document.getElementById('set-model-select');
    select.innerHTML = '';
    const filtered = models.filter(m => m.id.toLowerCase().includes(filter.toLowerCase()));
    
    const groups = {};
    filtered.forEach(m => {
        const vendor = m.id.includes('/') ? m.id.split('/')[0] : 'Other';
        if (!groups[vendor]) groups[vendor] = [];
        groups[vendor].push(m);
    });

    const sortedVendors = Object.keys(groups).sort((a, b) => {
        if (a === 'Other') return 1;
        if (b === 'Other') return -1;
        return a.localeCompare(b);
    });

    sortedVendors.forEach(vendor => {
        const groupEl = document.createElement('optgroup');
        groupEl.label = vendor.charAt(0).toUpperCase() + vendor.slice(1);
        
        groups[vendor].forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.id.includes('/') ? m.id.split('/').slice(1).join('/') : m.id;
            if (m.id === activeModel) opt.selected = true;
            groupEl.appendChild(opt);
        });
        select.appendChild(groupEl);
    });
}

function showFeedback(elementId, message, type = 'success') {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = `<div class="save-feedback ${type}">${type === 'success' ? '✓' : '✗'} ${message}</div>`;
    setTimeout(() => { el.innerHTML = ''; }, 3000);
}

function bindSettingsEvents() {
    // Autohide Toggle
    const autohideToggle = document.getElementById('set-autohide');
    if (autohideToggle) {
        autohideToggle.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            localStorage.setItem('nim_autohide_sidebar', isEnabled);
            const appShell = document.querySelector('.app-shell');
            if (appShell) {
                if (isEnabled) appShell.classList.add('autohide-enabled');
                else appShell.classList.remove('autohide-enabled');
            }
        });
    }

    // Save API Key
    document.getElementById('btn-save-key').addEventListener('click', async () => {
        const key = document.getElementById('set-api-key').value.trim();
        if (!key) return showFeedback('key-feedback', 'Please enter a key', 'error');

        try {
            const resp = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nvidia_api_key: key })
            });
            const data = await resp.json();
            if (data.status === 'success') {
                showFeedback('key-feedback', 'API key saved to .env');
                document.getElementById('set-api-key').value = '';
                loadModels();
            }
        } catch {
            showFeedback('key-feedback', 'Failed to save', 'error');
        }
    });

    // Model search filter
    document.getElementById('set-model-search').addEventListener('input', (e) => {
        fetch('/api/health').then(r => r.json()).then(h => {
            renderModelSelect(allSettingsModels, h.current_model, e.target.value);
        });
    });

    // Model change
    document.getElementById('set-model-select').addEventListener('change', async (e) => {
        try {
            await fetch('/v1/update_model', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: e.target.value })
            });
            showFeedback('model-feedback', `Model set to ${e.target.value.split('/').pop()}`);
        } catch {
            showFeedback('model-feedback', 'Failed to update model', 'error');
        }
    });

    // Refresh models
    document.getElementById('btn-refresh-models').addEventListener('click', loadModels);

    // Save defaults
    document.getElementById('btn-save-defaults').addEventListener('click', async () => {
        const temp = parseFloat(document.getElementById('set-temperature').value);
        const maxTokens = parseInt(document.getElementById('set-max-tokens').value);
        const topP = parseFloat(document.getElementById('set-top-p').value);

        try {
            const resp = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    default_temperature: temp,
                    default_max_tokens: maxTokens,
                    default_top_p: topP
                })
            });
            const data = await resp.json();
            if (data.status === 'success') {
                showFeedback('defaults-feedback', 'Defaults saved to .env');
            }
        } catch {
            showFeedback('defaults-feedback', 'Failed to save', 'error');
        }
    });

    // Purge
    document.getElementById('btn-purge').addEventListener('click', async () => {
        if (!confirm('Are you sure you want to delete ALL usage history? This cannot be undone.')) return;
        try {
            const resp = await fetch('/api/usage/purge', { method: 'DELETE' });
            const data = await resp.json();
            showFeedback('purge-feedback', `Purged ${data.deleted} records`);
        } catch {
            showFeedback('purge-feedback', 'Failed to purge', 'error');
        }
    });
}
