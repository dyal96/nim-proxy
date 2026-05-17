function init_benchmark() {
    const filterInput = document.getElementById('bench-filter');
    const refreshBtn = document.getElementById('btn-refresh-benchmark');
    const runBtn = document.getElementById('btn-run-benchmark');
    const runSelBtn = document.getElementById('btn-run-selected');
    const stopBtn = document.getElementById('btn-stop-benchmark');
    const clearBtn = document.getElementById('btn-clear-history');
    const tbody = document.getElementById('benchmark-tbody');
    const selectAll = document.getElementById('bench-select-all');
    
    let isRunning = false;
    let allModels = [];
    let history = JSON.parse(localStorage.getItem('nim_benchmark_history') || '{}');
    
    let sortCol = 'id';
    let sortAsc = true;
    let currentFilter = '';

    async function fetchModels() {
        try {
            const resp = await fetch('/v1/models');
            const data = await resp.json();
            if (data.data) {
                allModels = data.data.map(m => m.id);
                renderTable();
            }
        } catch (e) {
            App.showToast('Failed to fetch models for benchmark', 'error');
        }
    }

    function saveHistory() {
        localStorage.setItem('nim_benchmark_history', JSON.stringify(history));
    }

    function sortModels() {
        let filtered = allModels;
        if (currentFilter) {
            filtered = allModels.filter(m => m.toLowerCase().includes(currentFilter.toLowerCase()));
        }
        return filtered.sort((a, b) => {
            const ha = history[a] || {};
            const hb = history[b] || {};
            
            let valA, valB;
            if (sortCol === 'id') { valA = a; valB = b; }
            else if (sortCol === 'ttft') { valA = ha.ttft || 999999; valB = hb.ttft || 999999; }
            else if (sortCol === 'tps') { valA = ha.tps || -1; valB = hb.tps || -1; }
            else if (sortCol === 'latency') { valA = ha.latency || 999999; valB = hb.latency || 999999; }
            else if (sortCol === 'status') { valA = ha.status || 'Pending'; valB = hb.status || 'Pending'; }

            if (valA < valB) return sortAsc ? -1 : 1;
            if (valA > valB) return sortAsc ? 1 : -1;
            return 0;
        });
    }

    function getCapabilityBadges(id) {
        const badges = [];
        const lower = id.toLowerCase();
        if (lower.includes('instruct')) badges.push('<span class="model-badge badge-instruct">Instruct</span>');
        if (lower.includes('vision') || lower.includes('multimodal')) badges.push('<span class="model-badge badge-vision">Vision</span>');
        if (lower.includes('coder') || lower.includes('coding')) badges.push('<span class="model-badge badge-coder">Coder</span>');
        if (lower.includes('chat')) badges.push('<span class="model-badge badge-chat">Chat</span>');
        if (badges.length === 0) badges.push('<span class="model-badge badge-custom">Base</span>');
        return badges.join('');
    }

    function renderTable() {
        if (allModels.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 40px; color: var(--danger);">No models found. Check proxy configuration.</td></tr>`;
            return;
        }

        const sorted = sortModels();
        tbody.innerHTML = '';
        
        sorted.forEach(id => {
            const tr = document.createElement('tr');
            tr.id = `bench-${id.replace(/[^a-zA-Z0-9]/g, '-')}`;
            tr.dataset.model = id;
            
            const h = history[id] || {};
            const ttft = h.ttft ? App.formatLatency(h.ttft) : '-';
            const tps = h.tps ? (typeof h.tps === 'number' ? h.tps.toFixed(1) : h.tps) : '-';
            const lat = h.latency ? App.formatLatency(h.latency) : '-';
            
            let statusHtml = `<span class="source-badge" style="background:rgba(245,158,11,0.1); color:var(--warning); border-color:rgba(245,158,11,0.2);">Pending</span>`;
            if (h.status === 'Done') statusHtml = `<span class="source-badge" style="background:rgba(16,185,129,0.1); color:var(--success); border-color:rgba(16,185,129,0.2);">Done</span>`;
            if (h.status === 'Failed') statusHtml = `<span class="source-badge" style="background:rgba(239,68,68,0.1); color:var(--danger); border-color:rgba(239,68,68,0.2);">Failed</span>`;

            tr.innerHTML = `
                <td style="text-align:center;"><input type="checkbox" class="bench-checkbox" value="${id}"></td>
                <td><div style="display:flex; align-items:center; gap:8px;">
                    <i data-lucide="box" style="width:14px; color:var(--text-muted)"></i> 
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <span style="font-family:var(--font-mono); font-size:12px; font-weight:600;">${id.split('/').pop()}</span>
                        <div style="display:flex; align-items:center; gap:4px;">
                            <span style="font-size:10px; color:var(--text-muted)">${id.split('/')[0] || ''}</span>
                            ${getCapabilityBadges(id)}
                        </div>
                    </div>
                    <i data-lucide="copy" class="bench-copy-icon" data-model="${id}" style="width:14px; color:var(--text-muted); cursor:pointer; margin-left:auto;" title="Copy Model ID"></i>
                </div></td>
                <td class="col-ttft" style="font-family:var(--font-mono); color:${h.ttft ? 'var(--text-primary)' : 'var(--text-muted)'}">${ttft}</td>
                <td class="col-tps" style="font-family:var(--font-mono); color:${h.tps ? 'var(--text-primary)' : 'var(--text-muted)'}">${tps}</td>
                <td class="col-lat" style="font-family:var(--font-mono); color:${h.latency ? 'var(--text-primary)' : 'var(--text-muted)'}">${lat}</td>
                <td class="col-status">${statusHtml}</td>
            `;
            tbody.appendChild(tr);
        });
        lucide.createIcons();

        document.querySelectorAll('.bench-copy-icon').forEach(icon => {
            icon.addEventListener('click', (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(icon.dataset.model);
                App.showToast('Copied ' + icon.dataset.model, 'success');
            });
        });
    }

    document.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.sort;
            if (sortCol === col) {
                sortAsc = !sortAsc;
            } else {
                sortCol = col;
                sortAsc = true;
            }
            renderTable();
        });
    });

    selectAll.addEventListener('change', (e) => {
        document.querySelectorAll('.bench-checkbox').forEach(cb => cb.checked = e.target.checked);
    });

    clearBtn.addEventListener('click', () => {
        if (confirm("Clear all benchmark history?")) {
            history = {};
            saveHistory();
            renderTable();
        }
    });

    if (filterInput) {
        filterInput.addEventListener('input', (e) => {
            currentFilter = e.target.value;
            renderTable();
        });
    }

    refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        await fetchModels();
        refreshBtn.disabled = false;
        lucide.createIcons();
    });

    async function runBenchmarkForModels(modelsToRun) {
        if (isRunning) return;
        isRunning = true;
        runBtn.disabled = true;
        runSelBtn.disabled = true;
        stopBtn.disabled = false;
        
        for (const id of modelsToRun) {
            if (!isRunning) break;
            
            const trId = `bench-${id.replace(/[^a-zA-Z0-9]/g, '-')}`;
            const row = document.getElementById(trId);
            if (!row) continue;

            const stCol = row.querySelector('.col-status');
            stCol.innerHTML = `<span class="source-badge" style="background:rgba(56,189,248,0.1); color:var(--accent); border-color:rgba(56,189,248,0.2);">Testing...</span>`;

            let ttft = 0;
            let latency = 0;
            let tps = 0;

            try {
                const response = await fetch('/v1/messages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: id,
                        messages: [{role: 'user', content: 'Say "Benchmark Successful" in one short sentence.'}],
                        max_tokens: 50,
                        stream: true
                    })
                });

                if (!response.ok) throw new Error('API Error');

                const reader = response.body.getReader();
                const decoder = new TextDecoder();

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ') && line.length > 6) {
                            try {
                                const data = JSON.parse(line.substring(6));
                                if (data.type === 'message_delta' && data.metrics) {
                                    ttft = data.metrics.ttft_ms;
                                    latency = data.metrics.latency_ms;
                                    tps = data.metrics.tps;
                                }
                            } catch (e) {}
                        }
                    }
                }

                history[id] = { ttft, tps, latency, status: 'Done' };
                saveHistory();

                row.querySelector('.col-ttft').textContent = App.formatLatency(ttft);
                row.querySelector('.col-ttft').style.color = 'var(--text-primary)';
                row.querySelector('.col-tps').textContent = typeof tps === 'number' ? tps.toFixed(1) : tps;
                row.querySelector('.col-tps').style.color = 'var(--text-primary)';
                row.querySelector('.col-lat').textContent = App.formatLatency(latency);
                row.querySelector('.col-lat').style.color = 'var(--text-primary)';
                stCol.innerHTML = `<span class="source-badge" style="background:rgba(16,185,129,0.1); color:var(--success); border-color:rgba(16,185,129,0.2);">Done</span>`;
            } catch (e) {
                history[id] = history[id] || {};
                history[id].status = 'Failed';
                saveHistory();
                stCol.innerHTML = `<span class="source-badge" style="background:rgba(239,68,68,0.1); color:var(--danger); border-color:rgba(239,68,68,0.2);">Failed</span>`;
            }
        }

        isRunning = false;
        runBtn.disabled = false;
        runSelBtn.disabled = false;
        stopBtn.disabled = true;
    }

    runBtn.addEventListener('click', async () => {
        if (allModels.length === 0) await fetchModels();
        if (allModels.length === 0) return;
        runBenchmarkForModels(allModels);
    });

    runSelBtn.addEventListener('click', async () => {
        if (allModels.length === 0) return;
        const selected = Array.from(document.querySelectorAll('.bench-checkbox:checked')).map(cb => cb.value);
        if (selected.length === 0) {
            App.showToast('Select at least one model', 'error');
            return;
        }
        runBenchmarkForModels(selected);
    });

    stopBtn.addEventListener('click', () => {
        isRunning = false;
        runBtn.disabled = false;
        runSelBtn.disabled = false;
        stopBtn.disabled = true;
    });

    // Fetch models on load
    fetchModels();
}
