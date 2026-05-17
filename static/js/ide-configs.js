// ─── IDE Configs Page ────────────────────────────────────────────────────────

const IDE_META = {
    'claude-code': { icon: 'terminal', color: '#f59e0b' },
    'vscode-continue': { icon: 'code-2', color: '#38bdf8' },
    'vscode-cline': { icon: 'code-2', color: '#818cf8' },
    'crush': { icon: 'hammer', color: '#10b981' },
    'antigravity': { icon: 'rocket', color: '#ec4899' }
};

function init_ide_configs() {
    loadAllConfigs();
}

async function loadAllConfigs() {
    const grid = document.getElementById('configs-grid');

    try {
        const listResp = await fetch('/api/ide-configs');
        const listData = await listResp.json();
        const ides = listData.available || [];

        const configs = await Promise.all(
            ides.map(ide => fetch(`/api/ide-configs/${ide}`).then(r => r.json()).then(d => ({ id: ide, ...d })))
        );

        grid.innerHTML = '';
        configs.forEach(cfg => {
            grid.innerHTML += renderConfigCard(cfg);
        });

        lucide.createIcons();
        bindConfigActions();
    } catch (e) {
        grid.innerHTML = '<div class="empty-state"><i data-lucide="alert-circle"></i><p>Failed to load configs</p></div>';
        lucide.createIcons();
    }
}

function renderConfigCard(cfg) {
    const meta = IDE_META[cfg.id] || { icon: 'settings', color: '#94a3b8' };
    // Determine what code to show
    let codeContent = '';
    if (cfg.type === 'shell') {
        codeContent = cfg.powershell || '';
    } else {
        codeContent = cfg.config || '';
    }

    const escapedCode = codeContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let shellToggle = '';
    if (cfg.type === 'shell') {
        shellToggle = `
            <div style="display:flex;gap:4px;padding:12px 24px 0;">
                <button class="btn btn-sm btn-outline shell-toggle active" data-target="${cfg.id}" data-shell="powershell" style="font-size:11px">PowerShell</button>
                <button class="btn btn-sm btn-outline shell-toggle" data-target="${cfg.id}" data-shell="bash" style="font-size:11px">Bash</button>
            </div>
        `;
    }

    return `
        <div class="config-card" id="card-${cfg.id}">
            <div class="config-card-header">
                <div class="config-card-title">
                    <i data-lucide="${meta.icon}" style="color:${meta.color}"></i>
                    <h3>${cfg.name}</h3>
                </div>
                <div class="config-card-actions">
                    <button class="btn btn-outline btn-sm copy-btn" data-ide="${cfg.id}" title="Copy to clipboard">
                        <i data-lucide="copy"></i> Copy
                    </button>
                    <button class="btn btn-outline btn-sm download-btn" data-ide="${cfg.id}" data-name="${cfg.name}" title="Download file">
                        <i data-lucide="download"></i>
                    </button>
                </div>
            </div>
            ${shellToggle}
            <div class="config-card-body">
                <pre id="code-${cfg.id}">${escapedCode}</pre>
            </div>
            <div class="config-card-footer">
                <i data-lucide="info"></i>
                ${cfg.instructions || cfg.description}
            </div>
        </div>
    `;
}

function bindConfigActions() {
    // Copy buttons
    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const ide = btn.dataset.ide;
            const pre = document.getElementById(`code-${ide}`);
            if (pre) App.copyToClipboard(pre.textContent);
        });
    });

    // Download buttons
    document.querySelectorAll('.download-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const ide = btn.dataset.ide;
            const pre = document.getElementById(`code-${ide}`);
            if (!pre) return;

            const nameMap = {
                'claude-code': 'nim_claude_setup.ps1',
                'vscode-continue': 'continue_config.json',
                'vscode-cline': 'cline_settings.json',
                'crush': '.crush.json',
                'antigravity': 'antigravity_config.json'
            };

            const blob = new Blob([pre.textContent], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = nameMap[ide] || `${ide}_config.txt`;
            a.click();
            URL.revokeObjectURL(url);
            App.showToast('File downloaded!');
        });
    });

    // Shell toggle (PowerShell / Bash) for claude-code
    document.querySelectorAll('.shell-toggle').forEach(btn => {
        btn.addEventListener('click', async () => {
            const target = btn.dataset.target;
            const shell = btn.dataset.shell;

            // Update active state
            document.querySelectorAll(`.shell-toggle[data-target="${target}"]`).forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Fetch config and update code
            try {
                const resp = await fetch(`/api/ide-configs/${target}`);
                const data = await resp.json();
                const pre = document.getElementById(`code-${target}`);
                if (pre) {
                    const code = shell === 'bash' ? (data.bash || '') : (data.powershell || '');
                    pre.textContent = code;
                }
            } catch {}
        });
    });
}
