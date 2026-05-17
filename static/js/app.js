// ─── NIM Control Center — SPA Router & Shared Utils ──────────────────────────

const App = {
    currentPage: null,
    pageScripts: {},

    async init() {
        lucide.createIcons();
        this.initTheme();
        this.initAutohide();
        this.bindNav();
        window.addEventListener('hashchange', () => this.route());
        this.route();
        this.checkHealth();
        setInterval(() => this.checkHealth(), 30000);
    },

    initTheme() {
        const saved = localStorage.getItem('nim_theme');
        const theme = saved || 'light';
        
        if (theme === 'light') document.body.classList.add('light');
        else document.body.classList.remove('light');
        
        const btn = document.getElementById('theme-toggle');
        if (btn) {
            const icon = btn.querySelector('i');
            if (icon) {
                icon.setAttribute('data-lucide', theme === 'light' ? 'sun' : 'moon');
                lucide.createIcons();
            }
            
            btn.addEventListener('click', () => {
                document.body.classList.toggle('light');
                const isLight = document.body.classList.contains('light');
                localStorage.setItem('nim_theme', isLight ? 'light' : 'dark');
                if (icon) {
                    icon.setAttribute('data-lucide', isLight ? 'sun' : 'moon');
                    lucide.createIcons();
                }
            });
        }
    },

    initAutohide() {
        const autohide = localStorage.getItem('nim_autohide_sidebar') === 'true';
        if (autohide) {
            document.querySelector('.app-shell').classList.add('autohide-enabled');
        }
    },

    bindNav() {
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
                link.classList.add('active');
            });
        });
    },

    async route() {
        const hash = window.location.hash || '#/';
        const path = hash.replace('#/', '').replace('#', '') || 'dashboard';
        const pageMap = {
            '': 'dashboard', 'dashboard': 'dashboard',
            'chat': 'chat', 'settings': 'settings', 'ide-configs': 'ide-configs', 'benchmark': 'benchmark', 'help': 'help'
        };
        const page = pageMap[path] || 'dashboard';

        // Update active nav
        document.querySelectorAll('.nav-link').forEach(l => {
            l.classList.toggle('active', l.dataset.page === page);
        });

        await this.loadPage(page);
    },

    async loadPage(page) {
        const main = document.getElementById('main-content');
        const loader = document.getElementById('page-loader');
        if (loader) loader.classList.remove('hidden');

        try {
            const resp = await fetch(`/static/pages/${page}.html`);
            if (!resp.ok) throw new Error('Page not found');
            const html = await resp.text();
            main.innerHTML = html;

            // Load page-specific script
            const script = document.createElement('script');
            script.src = `/static/js/${page}.js`;
            script.onload = () => {
                lucide.createIcons();
                if (window[`init_${page.replace('-', '_')}`]) {
                    window[`init_${page.replace('-', '_')}`]();
                }
            };
            document.body.appendChild(script);
            this.currentPage = page;
        } catch (e) {
            main.innerHTML = `<div class="page"><div class="empty-state"><i data-lucide="alert-circle"></i><p>Failed to load page: ${page}</p></div></div>`;
            lucide.createIcons();
        }
    },

    async checkHealth() {
        try {
            const resp = await fetch('/api/health');
            const data = await resp.json();
            const dot = document.querySelector('.status-dot');
            const text = document.querySelector('.status-text');
            if (dot) {
                dot.style.background = data.status === 'ok' ? 'var(--success)' : 'var(--danger)';
                dot.style.boxShadow = data.status === 'ok'
                    ? '0 0 8px rgba(16,185,129,0.5)'
                    : '0 0 8px rgba(239,68,68,0.5)';
            }
            if (text) text.textContent = data.status === 'ok' ? 'Online' : 'Offline';
        } catch {
            const dot = document.querySelector('.status-dot');
            const text = document.querySelector('.status-text');
            if (dot) { dot.style.background = 'var(--danger)'; }
            if (text) text.textContent = 'Offline';
        }
    },

    showToast(message, type = 'success') {
        const existing = document.querySelector('.copy-toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.className = 'copy-toast';
        toast.style.background = type === 'success' ? 'var(--success)' : 'var(--danger)';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2200);
    },

    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.showToast('Copied to clipboard!');
        } catch {
            this.showToast('Failed to copy', 'error');
        }
    },

    formatNumber(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return n.toString();
    },

    formatLatency(ms) {
        if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
        return Math.round(ms) + 'ms';
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
