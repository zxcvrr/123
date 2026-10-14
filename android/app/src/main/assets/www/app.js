/* DeepSeek 手机小 App
 * 纯前端：浏览器直接调用 https://api.deepseek.com（官方支持 CORS，无需代理）。
 * API Key 只保存在你自己的设备上，除了 api.deepseek.com 不会发给任何第三方。
 */
'use strict';

const API_BASE = 'https://api.deepseek.com';

const MODELS = [
  { id: 'deepseek-flash', label: 'deepseek-flash —— 快、便宜（日常首选）' },
  { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro —— 更强、更贵' },
];

const EFFORTS = [
  { id: 'low', label: 'low —— 省 token' },
  { id: 'high', label: 'high —— 默认' },
  { id: 'max', label: 'max —— 最用力' },
];

const DEFAULT_SETTINGS = {
  model: 'deepseek-flash',
  thinking: 'enabled',
  effort: 'high',
  system: '',
  temperature: '',
  maxTokens: '',
  rememberKey: true,
};

const LS = {
  settings: 'dsk.settings',
  chats: 'dsk.chats',
  current: 'dsk.current',
  key: 'dsk.key',
};
const SS_KEY = 'dsk.key.session';

/* ── 状态 ──────────────────────────────────────────────── */

let settings = { ...DEFAULT_SETTINGS };
let chats = [];
let currentId = null;
let abortCtrl = null;
let sending = false;

const $ = (id) => document.getElementById(id);
const el = {
  messages: $('messages'),
  input: $('input'),
  send: $('send'),
  title: $('title'),
  drawer: $('drawer'),
  drawerList: $('drawerList'),
  backdrop: $('backdrop'),
  sheet: $('sheet'),
  toast: $('toast'),
};

/* ── 本地存取 ──────────────────────────────────────────── */

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    toast('本地存储写入失败（可能空间已满）：' + err.message);
    return false;
  }
}

function loadAll() {
  const stored = readJSON(LS.settings, {});
  delete stored.apiKey; // 历史版本可能把 Key 混进过设置对象，顺手清掉
  settings = { ...DEFAULT_SETTINGS, ...stored };
  // Key 可能只存在本次会话（不勾选“记住”时）
  settings.apiKey = sessionStorage.getItem(SS_KEY) || localStorage.getItem(LS.key) || '';
  chats = readJSON(LS.chats, []);
  if (!Array.isArray(chats)) chats = [];
  currentId = localStorage.getItem(LS.current);
  if (!chats.some((c) => c.id === currentId)) currentId = chats[0]?.id ?? null;
}

function saveSettings() {
  // 注意：settings 里带着 apiKey，绝不能整体落盘 —— 否则“不记住 Key”就失效了
  const { apiKey, ...rest } = settings;
  writeJSON(LS.settings, rest);
  if (settings.rememberKey && apiKey) {
    localStorage.setItem(LS.key, apiKey);
    sessionStorage.removeItem(SS_KEY);
  } else if (apiKey) {
    sessionStorage.setItem(SS_KEY, apiKey);
    localStorage.removeItem(LS.key);
  } else {
    localStorage.removeItem(LS.key);
    sessionStorage.removeItem(SS_KEY);
  }
}

function currentChat() {
  return chats.find((c) => c.id === currentId) ?? null;
}

function saveChats() {
  writeJSON(LS.chats, chats);
  if (currentId) localStorage.setItem(LS.current, currentId);
  else localStorage.removeItem(LS.current);
}

/* ── 工具 ──────────────────────────────────────────────── */

let toastTimer = null;
function toast(text) {
  el.toast.textContent = text;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2600);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** 极简 Markdown → HTML。先转义再替换，链接只允许 http(s)，避免 XSS。 */
function renderMarkdown(src) {
  let text = String(src ?? '');
  // 流式输出时补全未闭合的围栏，让代码块边写边正常显示
  const fences = (text.match(/```/g) || []).length;
  if (fences % 2 === 1) text += '\n```';

  const blocks = [];
  const re = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) blocks.push({ code: false, value: text.slice(last, m.index) });
    blocks.push({ code: true, lang: m[1].trim(), value: m[2] });
    last = re.lastIndex;
  }
  if (last < text.length) blocks.push({ code: false, value: text.slice(last) });

  return blocks.map((b) => {
    if (b.code) {
      return '<div class="codeblock"><div class="codebar"><span>' +
        escapeHtml(b.lang || 'code') +
        '</span><button type="button" class="copy">复制</button></div><pre><code>' +
        escapeHtml(b.value.replace(/\n$/, '')) + '</code></pre></div>';
    }
    return renderTextBlocks(b.value);
  }).join('');
}

function inlineMd(s) {
  let out = escapeHtml(s);
  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  out = out.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_all, label, url) => '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>'
  );
  return out.replace(/\n/g, '<br>');
}

function renderTextBlocks(value) {
  const lines = value.split('\n');
  const out = [];
  let list = null; // 'ul' | 'ol'
  let buf = [];

  const flushList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
  const flushPara = () => { if (buf.length) { out.push('<p>' + inlineMd(buf.join('\n')) + '</p>'); buf = []; } };

  for (const line of lines) {
    const t = line.trim();
    if (t === '') { flushPara(); flushList(); continue; }

    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) {
      flushPara(); flushList();
      const lvl = Math.min(h[1].length + 1, 6);
      out.push('<h' + lvl + '>' + inlineMd(h[2]) + '</h' + lvl + '>');
      continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(t)) { flushPara(); flushList(); out.push('<hr>'); continue; }

    const q = /^>\s?(.*)$/.exec(t);
    if (q) { flushPara(); flushList(); out.push('<blockquote>' + inlineMd(q[1]) + '</blockquote>'); continue; }

    const ul = /^[-*+]\s+(.*)$/.exec(t);
    if (ul) {
      flushPara();
      if (list !== 'ul') { flushList(); out.push('<ul>'); list = 'ul'; }
      out.push('<li>' + inlineMd(ul[1]) + '</li>');
      continue;
    }
    const ol = /^\d+[.)]\s+(.*)$/.exec(t);
    if (ol) {
      flushPara();
      if (list !== 'ol') { flushList(); out.push('<ol>'); list = 'ol'; }
      out.push('<li>' + inlineMd(ol[1]) + '</li>');
      continue;
    }
    flushList();
    buf.push(line);
  }
  flushPara();
  flushList();
  return out.join('');
}

function fmtTokens(n) {
  if (typeof n !== 'number') return '';
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
}

/* ── 渲染 ──────────────────────────────────────────────── */

function renderAll() {
  renderChatList();
  renderMessages();
}

function renderChatList() {
  if (!chats.length) {
    el.drawerList.innerHTML = '<div class="chat-item"><span class="name">还没有会话</span></div>';
    return;
  }
  el.drawerList.innerHTML = chats.map((c) =>
    '<div class="chat-item' + (c.id === currentId ? ' active' : '') + '" data-id="' + c.id + '">' +
    '<span class="name">' + escapeHtml(c.title || '新会话') + '</span>' +
    '<button type="button" class="del" data-del="' + c.id + '" aria-label="删除">✕</button></div>'
  ).join('');
}

function renderMessages() {
  const chat = currentChat();
  el.title.textContent = chat ? (chat.title || '新会话') : 'DeepSeek';

  if (!chat || chat.messages.length === 0) {
    el.messages.innerHTML =
      '<div class="empty"><h2>DeepSeek 小助手</h2>' +
      '<p>先在右上角 ⚙ 填入 API Key，然后直接提问。</p>' +
      '<p style="margin-top:14px">Key 在 <code>platform.deepseek.com</code> 申请，按量计费。</p></div>';
    return;
  }

  el.messages.innerHTML = '';
  for (const msg of chat.messages) {
    el.messages.appendChild(buildMessageEl(msg, chat));
  }
  scrollToBottom(true);
}

function buildMessageEl(msg, chat) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (msg.role === 'user' ? 'user' : 'assistant') + (msg.error ? ' error' : '');

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (msg.role === 'assistant' && msg.reasoning) {
    const d = document.createElement('details');
    d.className = 'think';
    d.open = !!msg.streaming;
    d.innerHTML = '<summary>💭 思考过程</summary><div class="think-body"></div>';
    d.querySelector('.think-body').textContent = msg.reasoning;
    bubble.appendChild(d);
  }

  const body = document.createElement('div');
  body.className = 'body';
  if (msg.role === 'user') body.textContent = msg.content;
  else body.innerHTML = renderMarkdown(msg.content);
  if (msg.streaming) body.classList.add('cursor');
  bubble.appendChild(body);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const bits = [];
  if (msg.usage) {
    bits.push('↑' + fmtTokens(msg.usage.prompt_tokens) + ' ↓' + fmtTokens(msg.usage.completion_tokens));
    if (msg.usage.prompt_cache_hit_tokens) bits.push('缓存 ' + fmtTokens(msg.usage.prompt_cache_hit_tokens));
    const rt = msg.usage.completion_tokens_details && msg.usage.completion_tokens_details.reasoning_tokens;
    if (rt) bits.push('思考 ' + fmtTokens(rt));
  }
  meta.innerHTML = bits.map((b) => '<span>' + escapeHtml(b) + '</span>').join('');
  if (msg.role === 'assistant' && !msg.streaming) {
    meta.insertAdjacentHTML('beforeend', '<button type="button" class="act" data-copy="' + msg.id + '">复制</button>');
    if (msg.error) {
      meta.insertAdjacentHTML('beforeend', '<button type="button" class="act" data-retry="1">重试</button>');
    } else if (chat && chat.messages[chat.messages.length - 1].id === msg.id) {
      meta.insertAdjacentHTML('beforeend', '<button type="button" class="act" data-regen="1">重新生成</button>');
    }
  }
  bubble.appendChild(meta);
  wrap.appendChild(bubble);
  return wrap;
}

let pinned = true;
function scrollToBottom(force) {
  if (!force && !pinned) return;
  el.messages.scrollTop = el.messages.scrollHeight;
}

el.messages.addEventListener('scroll', () => {
  const gap = el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight;
  pinned = gap < 80;
});

/* ── 调用 API ──────────────────────────────────────────── */

function apiKey() {
  return (settings.apiKey || '').trim();
}

function buildRequestBody(messages) {
  const body = {
    model: settings.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (settings.thinking === 'disabled') {
    body.thinking = { type: 'disabled' };
  } else {
    body.thinking = { type: 'enabled' };
    body.reasoning_effort = settings.effort || 'high';
  }
  const temp = Number(settings.temperature);
  if (settings.temperature !== '' && Number.isFinite(temp)) body.temperature = temp;
  const maxTok = Number(settings.maxTokens);
  if (settings.maxTokens !== '' && Number.isFinite(maxTok) && maxTok > 0) body.max_tokens = Math.floor(maxTok);
  return body;
}

function explainError(status, text) {
  const map = {
    400: '请求格式错误（400）',
    401: '认证失败（401）：API Key 不正确或已被禁用',
    402: '余额不足（402）：请到 platform.deepseek.com 充值',
    422: '参数错误（422）',
    429: '请求过于频繁（429）：稍后再试',
    500: '服务器内部故障（500）',
    503: '服务器繁忙（503）：稍后再试',
  };
  const head = map[status] || ('请求失败（' + status + '）');
  let detail = text || '';
  try {
    const j = JSON.parse(text);
    if (j && j.error && j.error.message) detail = j.error.message;
  } catch { /* 原样展示 */ }
  return detail ? head + '\n' + detail : head;
}

/**
 * 流式调用 /chat/completions。
 * @param {Array} messages 发送给模型的消息
 * @param {(evt: {type: 'reasoning'|'content'|'usage', value?: string, usage?: object}) => void} onEvent
 * @param {AbortSignal} signal
 */
async function streamChat(messages, onEvent, signal) {
  const res = await fetch(API_BASE + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey(),
    },
    body: JSON.stringify(buildRequestBody(messages)),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(explainError(res.status, text));
    err.status = res.status;
    throw err;
  }
  if (!res.body) throw new Error('浏览器不支持流式响应（缺少 ReadableStream）');

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        continue; // 半包/心跳，忽略
      }
      if (json.usage) onEvent({ type: 'usage', usage: json.usage });
      const delta = json.choices && json.choices[0] && json.choices[0].delta;
      if (!delta) continue;
      if (delta.reasoning_content) onEvent({ type: 'reasoning', value: delta.reasoning_content });
      if (delta.content) onEvent({ type: 'content', value: delta.content });
    }
  }
}

/* ── 发送流程 ──────────────────────────────────────────── */

function ensureChat() {
  let chat = currentChat();
  if (!chat) {
    chat = { id: uid(), title: '', createdAt: Date.now(), messages: [] };
    chats.unshift(chat);
    currentId = chat.id;
  }
  return chat;
}

async function send(text) {
  if (sending) return;
  const value = (text ?? el.input.value).trim();
  if (!value) return;
  if (!apiKey()) {
    toast('请先在 ⚙ 设置里填入 API Key');
    openSheet();
    return;
  }

  const chat = ensureChat();
  chat.messages.push({ id: uid(), role: 'user', content: value });
  if (!chat.title) chat.title = value.slice(0, 24);
  el.input.value = '';
  autoGrow();
  saveChats();
  renderChatList();
  renderMessages();
  scrollToBottom(true);

  await runCompletion(chat);
}

/** 按当前会话内容请求模型，并把流式结果写进最后一条 assistant 消息。 */
async function runCompletion(chat) {
  const history = [{ role: 'system', content: settings.system || 'You are a helpful assistant.' }]
    .concat(chat.messages
      .filter((m) => !m.error && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({ role: m.role, content: m.content })));

  const reply = { id: uid(), role: 'assistant', content: '', reasoning: '', usage: null, streaming: true };
  chat.messages.push(reply);
  renderMessages();
  scrollToBottom(true);

  setSending(true);
  abortCtrl = new AbortController();

  let node = el.messages.lastElementChild;
  let pending = false;
  const paint = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (node) {
        const body = node.querySelector('.body');
        if (body) body.innerHTML = renderMarkdown(reply.content);
        const thinkBody = node.querySelector('.think-body');
        if (thinkBody) thinkBody.textContent = reply.reasoning;
        if (reply.content && node.querySelector('.think')) node.querySelector('.think').open = false;
        scrollToBottom();
      }
    });
  };

  try {
    await streamChat(history, (evt) => {
      if (evt.type === 'reasoning') {
        if (!reply.reasoning) {
          // 第一条思维链内容到达时插入折叠块
          const bubble = node && node.querySelector('.bubble');
          if (bubble && !bubble.querySelector('.think')) {
            const d = document.createElement('details');
            d.className = 'think';
            d.open = true;
            d.innerHTML = '<summary>💭 思考过程</summary><div class="think-body"></div>';
            bubble.insertBefore(d, bubble.firstChild);
          }
        }
        reply.reasoning += evt.value;
        paint();
      } else if (evt.type === 'content') {
        reply.content += evt.value;
        paint();
      } else if (evt.type === 'usage') {
        reply.usage = evt.usage;
      }
    }, abortCtrl.signal);

    reply.streaming = false;
    if (!reply.content && reply.reasoning) reply.content = '（只返回了思考内容，没有正文）';
  } catch (err) {
    reply.streaming = false;
    if (err.name === 'AbortError') {
      reply.content += reply.content ? '\n\n（已停止）' : '（已停止）';
    } else {
      reply.error = true;
      const note = '⚠️ ' + (err.message || String(err));
      // 已经流出来的部分不要丢，把错误接在后面
      reply.content = reply.content ? reply.content + '\n\n' + note : note;
    }
  } finally {
    setSending(false);
    abortCtrl = null;
    saveChats();
    renderMessages();
    scrollToBottom();
  }
}

function setSending(on) {
  sending = on;
  el.send.textContent = on ? '停止' : '发送';
  el.send.classList.toggle('stop', on);
}

function stop() {
  if (abortCtrl) abortCtrl.abort();
}

/* ── 余额 ──────────────────────────────────────────────── */

async function checkBalance() {
  if (!apiKey()) { toast('请先填入 API Key'); openSheet(); return; }
  toast('查询中…');
  try {
    const res = await fetch(API_BASE + '/user/balance', {
      headers: { Authorization: 'Bearer ' + apiKey() },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(explainError(res.status, text));
    const j = JSON.parse(text);
    const info = (j.balance_infos || [])[0];
    if (!info) throw new Error('返回中没有余额信息');
    toast('余额 ' + info.total_balance + ' ' + info.currency +
      '（赠金 ' + info.granted_balance + ' / 充值 ' + info.topped_up_balance + '）');
  } catch (err) {
    toast('查询失败：' + (err.message || String(err)));
  }
}

/* ── 界面事件 ──────────────────────────────────────────── */

function autoGrow() {
  el.input.style.height = 'auto';
  el.input.style.height = Math.min(el.input.scrollHeight, Math.round(window.innerHeight * 0.38)) + 'px';
}

function openDrawer() { el.drawer.classList.add('open'); el.backdrop.classList.add('open'); }
function closeDrawer() { el.drawer.classList.remove('open'); el.backdrop.classList.remove('open'); }
function openSheet() { fillSettingsForm(); el.sheet.classList.add('open'); el.backdrop.classList.add('open'); }
function closeSheet() { el.sheet.classList.remove('open'); el.backdrop.classList.remove('open'); }

el.backdrop.addEventListener('click', () => { closeDrawer(); closeSheet(); });

el.send.addEventListener('click', () => (sending ? stop() : send()));

el.input.addEventListener('input', autoGrow);
el.input.addEventListener('keydown', (e) => {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (e.key === 'Enter' && !e.shiftKey && !coarse && !sending) {
    e.preventDefault();
    send();
  }
});

$('menuBtn').addEventListener('click', openDrawer);
$('settingsBtn').addEventListener('click', openSheet);
$('balanceBtn').addEventListener('click', checkBalance);
$('newChatBtn').addEventListener('click', () => {
  const chat = { id: uid(), title: '', createdAt: Date.now(), messages: [] };
  chats.unshift(chat);
  currentId = chat.id;
  saveChats();
  renderAll();
  closeDrawer();
  el.input.focus();
});

el.drawerList.addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    const id = del.getAttribute('data-del');
    chats = chats.filter((c) => c.id !== id);
    if (currentId === id) currentId = chats[0]?.id ?? null;
    saveChats();
    renderAll();
    return;
  }
  const item = e.target.closest('[data-id]');
  if (item) {
    currentId = item.getAttribute('data-id');
    saveChats();
    renderAll();
    closeDrawer();
  }
});

el.messages.addEventListener('click', async (e) => {
  const copyBtn = e.target.closest('.codebar .copy');
  if (copyBtn) {
    const code = copyBtn.closest('.codeblock')?.querySelector('code');
    if (code) {
      await copyText(code.textContent || '');
      copyBtn.textContent = '已复制';
      setTimeout(() => { copyBtn.textContent = '复制'; }, 1400);
    }
    return;
  }
  const msgBtn = e.target.closest('[data-copy]');
  if (msgBtn) {
    const chat = currentChat();
    const msg = chat?.messages.find((m) => m.id === msgBtn.getAttribute('data-copy'));
    if (msg) { await copyText(msg.content); toast('已复制'); }
    return;
  }
  if (e.target.closest('[data-retry]')) {
    const chat = currentChat();
    if (!chat || sending) return;
    if (chat.messages[chat.messages.length - 1]?.error) chat.messages.pop();
    await runCompletion(chat);
    return;
  }
  if (e.target.closest('[data-regen]')) {
    const chat = currentChat();
    if (!chat || sending) return;
    // 去掉最后一条 assistant，再重新生成
    while (chat.messages.length && chat.messages[chat.messages.length - 1].role === 'assistant') {
      chat.messages.pop();
    }
    await runCompletion(chat);
  }
});

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // 非安全上下文（http 局域网）下 Clipboard API 不可用，退回旧接口
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* 忽略 */ }
    ta.remove();
  }
}

/* ── 设置面板 ──────────────────────────────────────────── */

function fillSettingsForm() {
  $('fKey').value = settings.apiKey || '';
  $('fRemember').checked = !!settings.rememberKey;
  const modelSel = $('fModel');
  modelSel.innerHTML = MODELS.map((m) =>
    '<option value="' + m.id + '">' + escapeHtml(m.label) + '</option>').join('');
  modelSel.value = settings.model;
  $('fThinking').value = settings.thinking;
  const effortSel = $('fEffort');
  effortSel.innerHTML = EFFORTS.map((x) =>
    '<option value="' + x.id + '">' + escapeHtml(x.label) + '</option>').join('');
  effortSel.value = settings.effort;
  $('fSystem').value = settings.system || '';
  $('fTemp').value = settings.temperature;
  $('fMax').value = settings.maxTokens;
}

$('saveSettings').addEventListener('click', () => {
  settings.apiKey = $('fKey').value.trim();
  settings.rememberKey = $('fRemember').checked;
  settings.model = $('fModel').value;
  settings.thinking = $('fThinking').value;
  settings.effort = $('fEffort').value;
  settings.system = $('fSystem').value;
  settings.temperature = $('fTemp').value.trim();
  settings.maxTokens = $('fMax').value.trim();
  saveSettings();
  closeSheet();
  toast('已保存');
});

$('clearKey').addEventListener('click', () => {
  settings.apiKey = '';
  $('fKey').value = '';
  saveSettings();
  toast('已清除本机保存的 Key');
});

$('exportBtn').addEventListener('click', () => {
  const chat = currentChat();
  if (!chat || !chat.messages.length) { toast('当前会话为空'); return; }
  const md = ['# ' + (chat.title || '会话'), ''].concat(
    chat.messages.map((m) => {
      const who = m.role === 'user' ? '我' : 'DeepSeek';
      const think = m.reasoning ? '> 思考：' + m.reasoning.replace(/\n/g, '\n> ') + '\n\n' : '';
      return '## ' + who + '\n\n' + think + m.content + '\n';
    })
  ).join('\n');
  const name = (chat.title || 'deepseek-chat').replace(/[\\/:*?"<>|]/g, '_') + '.md';

  // 安卓壳里 WebView 不支持下 blob 下载，改走原生分享面板（保存到文件 / 发给自己都行）
  if (window.AndroidSave && typeof window.AndroidSave.share === 'function') {
    window.AndroidSave.share(name, md);
    toast('已打开分享面板');
    return;
  }

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});

$('wipeBtn').addEventListener('click', () => {
  if (!confirm('清空全部会话与本机保存的设置？此操作不可恢复。')) return;
  chats = [];
  currentId = null;
  localStorage.removeItem(LS.chats);
  localStorage.removeItem(LS.current);
  localStorage.removeItem(LS.settings);
  localStorage.removeItem(LS.key);
  sessionStorage.removeItem(SS_KEY);
  settings = { ...DEFAULT_SETTINGS, apiKey: '' };
  renderAll();
  fillSettingsForm();
  toast('已清空');
});

/* ── 启动 ──────────────────────────────────────────────── */

loadAll();
renderAll();
autoGrow();

// 离线壳：只在 https / localhost 下注册，局域网 http 打开时浏览器会直接拒绝，忽略即可
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* 忽略 */ });
}
