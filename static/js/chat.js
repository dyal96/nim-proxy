// ─── Chat Page — Enhanced ────────────────────────────────────────────────────

const md = window.markdownit({
    highlight: (str) => '<pre class="hljs"><code>' + window.markdownit().utils.escapeHtml(str) + '</code></pre>'
});

let chatHistory = [];
let attachedContext = "";
let allChatModels = [];
let savedChats = JSON.parse(localStorage.getItem('nim_chats') || '[]');
let activeChatId = null;

function getCapabilityBadges(id) {
    const badges = [];
    const lower = id.toLowerCase();
    if (lower.includes('instruct')) badges.push('<span class="model-badge badge-instruct" style="font-size:9px">Instruct</span>');
    if (lower.includes('vision') || lower.includes('multimodal')) badges.push('<span class="model-badge badge-vision" style="font-size:9px">Vision</span>');
    if (lower.includes('coder') || lower.includes('coding')) badges.push('<span class="model-badge badge-coder" style="font-size:9px">Coder</span>');
    if (lower.includes('chat')) badges.push('<span class="model-badge badge-chat" style="font-size:9px">Chat</span>');
    return badges.join('');
}

function init_chat() {
    const form = document.getElementById('chat-form');
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');
    const clearBtn = document.getElementById('chat-clear-btn');
    const messagesArea = document.getElementById('chat-messages');
    const attachBar = document.getElementById('chat-attachments');
    const fileInput = document.getElementById('chat-file-input');
    const folderInput = document.getElementById('chat-folder-input');

    loadActiveModel();
    loadModelsForSwitcher();
    renderChatHistory();

    // Auto-resize textarea
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = input.scrollHeight + 'px';
        sendBtn.disabled = !input.value.trim();
    });

    // Enter to send
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            form.dispatchEvent(new Event('submit'));
        }
    });

    // Attachments
    document.getElementById('btn-attach-file').addEventListener('click', () => fileInput.click());
    document.getElementById('btn-attach-folder').addEventListener('click', () => folderInput.click());

    function handleFiles(files) {
        attachedContext = "CONTEXT FROM ATTACHED FILES:\n\n";
        attachBar.innerHTML = '';
        Array.from(files).forEach(file => {
            const badge = document.createElement('div');
            badge.className = 'attach-badge';
            badge.innerHTML = `<i data-lucide="file-text"></i> <span>${file.name}</span>`;
            attachBar.appendChild(badge);
            const reader = new FileReader();
            reader.onload = (e) => { attachedContext += `--- FILE: ${file.name} ---\n${e.target.result}\n\n`; };
            reader.readAsText(file);
        });
        lucide.createIcons();
    }

    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
    folderInput.addEventListener('change', (e) => handleFiles(e.target.files));

    // Clear chat
    clearBtn.addEventListener('click', () => {
        messagesArea.innerHTML = '';
        chatHistory = [];
        addChatMessage('assistant', 'Chat cleared. How can I help you?');
    });

    // History panel toggle
    document.getElementById('chat-history-toggle').addEventListener('click', () => {
        document.getElementById('chat-history-panel').classList.toggle('open');
    });
    document.getElementById('chat-history-close').addEventListener('click', () => {
        document.getElementById('chat-history-panel').classList.remove('open');
    });
    document.getElementById('new-chat-btn').addEventListener('click', () => {
        saveCurrentChat();
        activeChatId = null;
        chatHistory = [];
        messagesArea.innerHTML = '';
        addChatMessage('assistant', 'New chat started. How can I help you?');
        document.getElementById('chat-history-panel').classList.remove('open');
    });

    // Model switcher
    const pillBtn = document.getElementById('model-pill-btn');
    const dropdown = document.getElementById('model-dropdown');
    pillBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
        if (dropdown.classList.contains('open')) {
            document.getElementById('quick-model-search').focus();
        }
    });
    document.addEventListener('click', () => dropdown.classList.remove('open'));
    dropdown.addEventListener('click', (e) => e.stopPropagation());

    document.getElementById('quick-model-search').addEventListener('input', (e) => {
        renderModelList(e.target.value);
    });

    // Submit
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;

        input.value = '';
        input.style.height = 'auto';
        sendBtn.disabled = true;

        const finalMessage = attachedContext ? `${attachedContext}\n\nUSER MESSAGE:\n${text}` : text;
        addChatMessage('user', text);
        chatHistory.push({ role: 'user', content: finalMessage });

        attachedContext = "";
        attachBar.innerHTML = "";

        const assistantContent = addChatMessage('assistant', '', true);
        let fullResponse = '';
        let finalUsage = null;
        const streamStart = performance.now();
        let tokenCount = 0;
        let isError = false;

        try {
            const response = await fetch('/v1/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: "claude-3-5-sonnet-20240620",
                    messages: chatHistory,
                    max_tokens: 1024,
                    stream: true
                })
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done || isError) break;

                const chunk = decoder.decode(value);
                for (const line of chunk.split('\n')) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.substring(6));
                            
                            if (data.type === 'error') {
                                assistantContent.innerHTML = `<div class="error-msg" style="color:var(--danger); background:rgba(239,68,68,0.1); padding:12px; border-radius:var(--radius); border:1px solid rgba(239,68,68,0.2); margin-top:8px;"><i data-lucide="alert-circle" style="width:14px; vertical-align:middle; margin-right:4px;"></i> ${data.error.message}</div>`;
                                lucide.createIcons();
                                isError = true;
                                break;
                            }

                            if (data.type === 'content_block_delta') {
                                const text = data.delta.text || data.delta.thinking || '';
                                if (text) {
                                    fullResponse += text;
                                    tokenCount++;
                                    assistantContent.innerHTML = md.render(fullResponse);
                                    // Add copy buttons to code blocks
                                    assistantContent.querySelectorAll('pre').forEach(pre => {
                                        if (!pre.querySelector('.code-copy-btn')) {
                                            const btn = document.createElement('button');
                                            btn.className = 'code-copy-btn';
                                            btn.innerHTML = '<i data-lucide="copy"></i>';
                                            btn.title = 'Copy code';
                                            btn.onclick = () => {
                                                App.copyToClipboard(pre.textContent);
                                            };
                                            pre.style.position = 'relative';
                                            pre.appendChild(btn);
                                        }
                                    });
                                    messagesArea.scrollTop = messagesArea.scrollHeight;
                                }
                            } else if (data.type === 'message_delta' && data.usage) {
                                finalUsage = data.usage;
                            }
                        } catch {}
                    }
                }
            }

            const streamEnd = performance.now();
            const responseTime = ((streamEnd - streamStart) / 1000).toFixed(1);
            const outTokens = finalUsage ? finalUsage.output_tokens : tokenCount;
            const tokensPerSec = outTokens > 0 && responseTime > 0 ? (outTokens / parseFloat(responseTime)).toFixed(1) : '—';

            chatHistory.push({ role: 'assistant', content: fullResponse });
            assistantContent.parentElement.classList.remove('loading');

            // Stats tag with token speed + response time
            const tag = document.createElement('div');
            tag.className = 'usage-tag';
            let statsText = '';
            if (finalUsage) {
                statsText = `In: ${finalUsage.input_tokens} | Out: ${finalUsage.output_tokens}`;
            }
            statsText += ` | ${tokensPerSec} tok/s | ${responseTime}s`;
            tag.innerHTML = statsText;

            // Copy full response button
            const copyBtn = document.createElement('button');
            copyBtn.className = 'msg-copy-btn';
            copyBtn.innerHTML = '<i data-lucide="copy"></i> Copy';
            copyBtn.onclick = () => App.copyToClipboard(fullResponse);

            const footer = document.createElement('div');
            footer.className = 'msg-footer';
            footer.appendChild(tag);
            footer.appendChild(copyBtn);
            assistantContent.appendChild(footer);

            lucide.createIcons();
            saveCurrentChat();

        } catch (error) {
            console.error(error);
            assistantContent.innerHTML = `<span style="color:var(--danger)">Error: Could not connect to proxy.</span>`;
            assistantContent.parentElement.classList.remove('loading');
        }
    });
}

// ─── Model Switcher ──────────────────────────────────────────────────────────

async function loadActiveModel() {
    try {
        const resp = await fetch('/api/health');
        const d = await resp.json();
        const el = document.getElementById('chat-active-model');
        if (el) {
            const m = d.current_model || '—';
            el.textContent = m.includes('/') ? m.split('/').pop() : m;
        }
    } catch {}
}

async function loadModelsForSwitcher() {
    try {
        const resp = await fetch('/v1/models');
        const data = await resp.json();
        if (data.data) {
            allChatModels = data.data;
            renderModelList('');
        }
    } catch {}
}

function renderModelList(filter) {
    const list = document.getElementById('quick-model-list');
    const filtered = allChatModels.filter(m => m.id.toLowerCase().includes(filter.toLowerCase()));

    if (filtered.length === 0) {
        list.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:13px">No models found</div>';
        return;
    }

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

    list.innerHTML = sortedVendors.map(vendor => {
        const vendorName = vendor.charAt(0).toUpperCase() + vendor.slice(1);
        const optionsHtml = groups[vendor].map(m => {
            const short = m.id.includes('/') ? m.id.split('/').slice(1).join('/') : m.id;
            return `<div class="model-option" data-model="${m.id}" title="${m.id}">
                <div style="display:flex; flex-direction:column; gap:2px; flex:1;">
                    <span class="model-option-name">${short}</span>
                    <div style="display:flex; align-items:center; gap:4px;">
                        <span class="model-option-id" style="font-size:10px; color:var(--text-muted)">${m.id.split('/')[0] || ''}</span>
                        ${getCapabilityBadges(m.id)}
                    </div>
                </div>
            </div>`;
        }).join('');
        
        return `
            <div class="model-group-header">${vendorName}</div>
            ${optionsHtml}
        `;
    }).join('');

    list.querySelectorAll('.model-option').forEach(opt => {
        opt.addEventListener('click', async () => {
            const model = opt.dataset.model;
            try {
                await fetch('/v1/update_model', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model })
                });
                const el = document.getElementById('chat-active-model');
                if (el) el.textContent = model.includes('/') ? model.split('/').pop() : model;
                document.getElementById('model-dropdown').classList.remove('open');
                App.showToast(`Model: ${model.split('/').pop()}`);
            } catch {}
        });
    });
}

// ─── Chat History (localStorage) ─────────────────────────────────────────────

function saveCurrentChat() {
    if (chatHistory.length < 2) return; // Need at least 1 exchange

    const firstUserMsg = chatHistory.find(m => m.role === 'user');
    const title = firstUserMsg ? firstUserMsg.content.substring(0, 50).replace(/\n/g, ' ') : 'Untitled';

    if (activeChatId) {
        const idx = savedChats.findIndex(c => c.id === activeChatId);
        if (idx >= 0) {
            savedChats[idx].messages = chatHistory;
            savedChats[idx].updated = Date.now();
        }
    } else {
        activeChatId = 'chat_' + Date.now();
        savedChats.unshift({
            id: activeChatId,
            title: title,
            messages: chatHistory,
            created: Date.now(),
            updated: Date.now()
        });
    }

    // Keep last 20 chats
    if (savedChats.length > 20) savedChats = savedChats.slice(0, 20);
    localStorage.setItem('nim_chats', JSON.stringify(savedChats));
    renderChatHistory();
}

function renderChatHistory() {
    const list = document.getElementById('chat-history-list');
    if (!list) return;

    if (savedChats.length === 0) {
        list.innerHTML = '<div class="empty-state" style="padding:24px"><p>No saved chats</p></div>';
        return;
    }

    list.innerHTML = savedChats.map(c => {
        const time = new Date(c.updated).toLocaleDateString([], { month: 'short', day: 'numeric' });
        const isActive = c.id === activeChatId;
        return `<div class="chat-history-item ${isActive ? 'active' : ''}" data-chat-id="${c.id}">
            <div class="chat-history-title">${c.title.replace(/</g, '&lt;')}...</div>
            <div class="chat-history-meta">${time} · ${c.messages.length} msgs</div>
        </div>`;
    }).join('');

    list.querySelectorAll('.chat-history-item').forEach(item => {
        item.addEventListener('click', () => {
            const id = item.dataset.chatId;
            loadChat(id);
        });
    });
}

function loadChat(id) {
    const chat = savedChats.find(c => c.id === id);
    if (!chat) return;

    saveCurrentChat();
    activeChatId = id;
    chatHistory = [...chat.messages];

    const messagesArea = document.getElementById('chat-messages');
    messagesArea.innerHTML = '';

    chatHistory.forEach(msg => {
        addChatMessage(msg.role, msg.content);
    });

    document.getElementById('chat-history-panel').classList.remove('open');
    renderChatHistory();
}

// ─── Message Rendering ──────────────────────────────────────────────────────

function addChatMessage(role, text, isLoading = false) {
    const messagesArea = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    if (isLoading) msgDiv.classList.add('loading');

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.innerHTML = `<i data-lucide="${role === 'assistant' ? 'bot' : 'user'}"></i>`;

    const content = document.createElement('div');
    content.className = 'msg-content';
    if (text) content.innerHTML = md.render(text);

    msgDiv.appendChild(avatar);
    msgDiv.appendChild(content);
    messagesArea.appendChild(msgDiv);
    messagesArea.scrollTop = messagesArea.scrollHeight;
    lucide.createIcons();
    return content;
}
