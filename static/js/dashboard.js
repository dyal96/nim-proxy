// ─── Dashboard — Usage Analytics ─────────────────────────────────────────────

let tokenChart = null;
let modelChart = null;
let currentPeriod = '24h';

function init_dashboard() {
    bindPeriodTabs();
    loadDashboard(currentPeriod);
}

function bindPeriodTabs() {
    document.querySelectorAll('.period-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.period-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentPeriod = tab.dataset.period;
            loadDashboard(currentPeriod);
        });
    });
}

async function loadDashboard(period) {
    try {
        const [summaryResp, usageResp, healthResp] = await Promise.all([
            fetch(`/api/usage/summary?period=${period}`),
            fetch(`/api/usage?period=${period}&limit=15`),
            fetch('/api/health')
        ]);

        const summary = await summaryResp.json();
        const usage = await usageResp.json();
        const health = await healthResp.json();

        renderStats(summary, health);
        renderTokenChart(summary.timeline);
        renderModelChart(summary.by_model);
        renderRecentTable(usage.data);
    } catch (e) {
        console.error('Dashboard load error:', e);
    }
}

function renderStats(summary, health) {
    const el = (id) => document.getElementById(id);
    el('stat-requests').textContent = App.formatNumber(summary.total_requests);
    el('stat-tokens').textContent = App.formatNumber(summary.total_tokens);
    el('stat-tokens-detail').textContent = `In: ${App.formatNumber(summary.total_input_tokens)} / Out: ${App.formatNumber(summary.total_output_tokens)}`;
    el('stat-latency').textContent = App.formatLatency(summary.avg_latency_ms);

    const modelName = health.current_model || '—';
    el('stat-model').textContent = modelName.includes('/') ? modelName.split('/').pop() : modelName;
}

function renderTokenChart(timeline) {
    const ctx = document.getElementById('chart-tokens');
    if (!ctx) return;

    if (tokenChart) tokenChart.destroy();

    const labels = timeline.map(t => {
        const d = new Date(t.hour.replace(' ', 'T') + 'Z');
        if (currentPeriod === '7d' || currentPeriod === '30d' || currentPeriod === 'all') {
            return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    });
    const data = timeline.map(t => t.tokens);

    tokenChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Tokens',
                data,
                borderColor: 'rgba(56, 189, 248, 1)',
                backgroundColor: 'rgba(56, 189, 248, 0.08)',
                fill: true,
                tension: 0.4,
                pointRadius: 2,
                pointHoverRadius: 5,
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1e293b',
                    borderColor: 'rgba(56,189,248,0.3)',
                    borderWidth: 1,
                    titleFont: { family: 'Outfit' },
                    bodyFont: { family: 'Plus Jakarta Sans' },
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(51,65,85,0.3)' },
                    ticks: { color: '#64748b', font: { size: 11 } }
                },
                y: {
                    grid: { color: 'rgba(51,65,85,0.3)' },
                    ticks: { color: '#64748b', font: { size: 11 } },
                    beginAtZero: true,
                }
            }
        }
    });
}

function renderModelChart(byModel) {
    const ctx = document.getElementById('chart-models');
    if (!ctx) return;

    if (modelChart) modelChart.destroy();

    if (!byModel || byModel.length === 0) {
        modelChart = new Chart(ctx, {
            type: 'doughnut',
            data: { labels: ['No data'], datasets: [{ data: [1], backgroundColor: ['#334155'] }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
        return;
    }

    const colors = ['#38bdf8', '#818cf8', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];
    const labels = byModel.map(m => m.model ? m.model.split('/').pop() : 'Unknown');
    const data = byModel.map(m => m.tokens || 0);

    modelChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors.slice(0, labels.length),
                borderColor: '#0a0e1a',
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#94a3b8',
                        font: { size: 11, family: 'Plus Jakarta Sans' },
                        padding: 12,
                        usePointStyle: true,
                        pointStyleWidth: 8,
                    }
                },
                tooltip: {
                    backgroundColor: '#1e293b',
                    borderColor: 'rgba(56,189,248,0.3)',
                    borderWidth: 1,
                }
            }
        }
    });
}

function renderRecentTable(rows) {
    const tbody = document.getElementById('recent-tbody');
    if (!tbody) return;

    if (!rows || rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No activity recorded yet. Send a message to get started!</td></tr>';
        return;
    }

    tbody.innerHTML = rows.map(r => {
        const time = new Date(r.timestamp + 'Z').toLocaleString([], {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const model = r.model ? r.model.split('/').pop() : '—';
        return `<tr>
            <td>${time}</td>
            <td style="color:var(--accent)">${model}</td>
            <td>${App.formatNumber(r.input_tokens)} / ${App.formatNumber(r.output_tokens)}</td>
            <td>${App.formatLatency(r.latency_ms)}</td>
            <td><span class="source-badge">${r.source}</span></td>
        </tr>`;
    }).join('');
}
