// app.js — Sharkly chat client. STATELESS BACKEND.
// History lives in the browser (localStorage) and is sent with every request.

import { marked } from 'https://esm.sh/marked@13.0.3';
import DOMPurify from 'https://esm.sh/dompurify@3.1.6';

// Markdown config: GFM, no raw HTML, autolinks
marked.setOptions({ gfm: true, breaks: true });

const HISTORY_KEY = 'sharkly:history';

/** @type {Array<{role: string, content: string}>} */
let history = loadHistory();

const $ = (id) => document.getElementById(id);
const chatEl = $('chat');
const welcomeEl = $('welcome');
const suggestionsEl = $('suggestions');
const composerEl = $('composer');
const inputEl = $('input');
const sendBtn = $('send-btn');
const resetBtn = $('reset-btn');
const modelEl = $('model-name');
const toolsEl = $('tools-count');

// Buy confirmation modal
const cmBackdrop = $('confirm-backdrop');
const cmToken = $('cm-token');
const cmSerial = $('cm-serial');
const cmPrice = $('cm-price');
const cmCommission = $('cm-commission');
const cmTotal = $('cm-total');
const cmOperator = $('cm-operator');
const cmCancel = $('cm-cancel');
const cmConfirm = $('cm-confirm');

// Listing confirmation modal
const lmBackdrop = $('list-backdrop');
const lmToken = $('lm-token');
const lmSerial = $('lm-serial');
const lmPrice = $('lm-price');
const lmSeller = $('lm-seller');
const lmApproval = $('lm-approval');
const lmCancel = $('lm-cancel');
const lmConfirm = $('lm-confirm');

// Unlisting confirmation modal
const umBackdrop = $('unlist-backdrop');
const umToken = $('um-token');
const umSerial = $('um-serial');
const umSeller = $('um-seller');
const umApproval = $('um-approval');
const umCancel = $('um-cancel');
const umConfirm = $('um-confirm');

// Wallet pill
const walletPill = $('wallet-pill');
const walletAccount = $('wallet-account');
const walletBalance = $('wallet-balance');

// Sidebar nav
const navAnalytics = $('nav-analytics');
const navWallet = $('nav-wallet');

// Analytics modal
const analyticsBackdrop = $('analytics-backdrop');
const analyticsBody = $('analytics-body');
const analyticsSub = $('analytics-sub');
const analyticsRefresh = $('analytics-refresh');
const analyticsClose = $('analytics-close');

/** Operator/network metadata fetched once at boot. */
let agentInfo = null;

// ─── History persistence ───────────────────────────────────────────
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* quota or private mode — ignore */
  }
}
function clearHistory() {
  history = [];
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {}
}

// ─── Agent info ────────────────────────────────────────────────────
async function loadInfo() {
  try {
    const res = await fetch('/api/info');
    const info = await res.json();
    agentInfo = info;
    modelEl.textContent = info.model.replace(/^anthropic\//, '');
    toolsEl.textContent = info.toolsCount;
    document.title = `Sharkly — ${info.tagline}`;
    renderSuggestions(info.suggestions ?? []);
  } catch (err) {
    console.error('Failed to load info:', err);
    modelEl.textContent = 'error';
  }
}

function renderSuggestions(prompts) {
  suggestionsEl.innerHTML = '';
  for (const p of prompts) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'suggestion';
    btn.textContent = p;
    btn.addEventListener('click', () => {
      inputEl.value = p;
      autoresize();
      updateSendState();
      send();
    });
    suggestionsEl.appendChild(btn);
  }
}

// ─── Rendering helpers ─────────────────────────────────────────────
function renderMarkdown(text) {
  // marked → DOMPurify → safe HTML string
  return DOMPurify.sanitize(marked.parse(String(text)), {
    USE_PROFILES: { html: true },
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function iconRef(id) {
  return `<svg class="avatar-icon" aria-hidden="true"><use href="#${id}"/></svg>`;
}

function hideWelcome() {
  if (welcomeEl && !welcomeEl.hidden) {
    welcomeEl.hidden = true;
    welcomeEl.style.display = 'none';
  }
}
function showWelcome() {
  if (welcomeEl) {
    welcomeEl.hidden = false;
    welcomeEl.style.display = '';
  }
}
function scrollToBottom() {
  requestAnimationFrame(() => {
    chatEl.scrollTop = chatEl.scrollHeight;
  });
}

function addUserMessage(text) {
  hideWelcome();
  const msg = document.createElement('div');
  msg.className = 'msg user';
  msg.innerHTML = `
    <div class="bubble">${escapeHtml(text)}</div>
    <div class="avatar avatar-user">${iconRef('i-user')}</div>
  `;
  chatEl.appendChild(msg);
  scrollToBottom();
}

function addAgentMessage(text, toolCalls = []) {
  const msg = document.createElement('div');
  msg.className = 'msg agent';
  const chips = toolCalls.length
    ? `<div class="tool-chips">${toolCalls
        .map((t) => `<span class="tool-chip">${escapeHtml(t)}</span>`)
        .join('')}</div>`
    : '';
  msg.innerHTML = `
    <div class="avatar avatar-agent">${iconRef('i-shark')}</div>
    <div class="msg-body">
      <div class="bubble markdown">${renderMarkdown(text)}</div>
      ${chips}
    </div>
  `;
  chatEl.appendChild(msg);
  scrollToBottom();
}

function addErrorMessage(text) {
  const msg = document.createElement('div');
  msg.className = 'msg agent error';
  msg.innerHTML = `
    <div class="avatar avatar-error">${iconRef('i-alert')}</div>
    <div class="msg-body"><div class="bubble">${escapeHtml(text)}</div></div>
  `;
  chatEl.appendChild(msg);
  scrollToBottom();
}

function addThinking() {
  const msg = document.createElement('div');
  msg.className = 'msg agent thinking';
  msg.id = 'thinking';
  msg.innerHTML = `
    <div class="avatar avatar-agent">${iconRef('i-shark')}</div>
    <div class="msg-body">
      <div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div>
    </div>
  `;
  chatEl.appendChild(msg);
  scrollToBottom();
}

function removeThinking() {
  document.getElementById('thinking')?.remove();
}

// Rebuild UI from persisted history on first paint
function rehydrate() {
  if (history.length === 0) return;
  hideWelcome();
  for (const m of history) {
    if (m.role === 'user') addUserMessage(m.content);
    else if (m.role === 'assistant') addAgentMessage(m.content);
  }
}

// ─── Send ──────────────────────────────────────────────────────────
async function send() {
  const message = inputEl.value.trim();
  if (!message) return;

  addUserMessage(message);
  history.push({ role: 'user', content: message });
  saveHistory();

  inputEl.value = '';
  autoresize();
  updateSendState();
  addThinking();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: history }),
    });

    removeThinking();

    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      addErrorMessage(`Error: ${error}`);
      history.pop();
      saveHistory();
      return;
    }

    const { reply, toolCalls, pendingConfirmation, pendingListConfirmation, pendingUnlistConfirmation } =
      await res.json();
    history.push({ role: 'assistant', content: reply });
    saveHistory();
    addAgentMessage(reply, toolCalls);

    console.log('[chat reply]', {
      hasBuy: !!pendingConfirmation,
      hasList: !!pendingListConfirmation,
      hasUnlist: !!pendingUnlistConfirmation,
      lmBackdropExists: !!lmBackdrop,
      umBackdropExists: !!umBackdrop,
    });

    if (pendingConfirmation) openConfirmModal(pendingConfirmation);
    else if (pendingListConfirmation) openListModal(pendingListConfirmation);
    else if (pendingUnlistConfirmation) openUnlistModal(pendingUnlistConfirmation);
  } catch (err) {
    removeThinking();
    addErrorMessage(`Network error: ${err?.message ?? err}`);
    history.pop();
    saveHistory();
  }
}

// ─── Buy confirmation modal ────────────────────────────────────────
let pendingForConfirm = null;

function fmtHbar(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return `${Number(n).toLocaleString()} HBAR`;
}

function openConfirmModal(p) {
  pendingForConfirm = p;
  cmToken.textContent = p.token;
  cmSerial.textContent = `#${p.serial}`;
  cmPrice.textContent = fmtHbar(p.price);

  // Commission is taken FROM the price (split: seller + affiliate + SentX).
  // The buyer pays exactly the listed price, no extras.
  const commissionPct = p.totalCommissionPct ?? p.totalCommission;
  const commissionHbar =
    typeof p.totalCommissionHbar === 'number'
      ? p.totalCommissionHbar
      : commissionPct != null && p.commissionDenominator
        ? (Number(p.price) * Number(commissionPct)) / Number(p.commissionDenominator)
        : 0;
  cmCommission.textContent =
    commissionPct != null
      ? `${commissionPct}% (~${commissionHbar.toFixed(4)} HBAR, taken from price)`
      : `${commissionHbar.toFixed(4)} HBAR (taken from price)`;

  // Total = price (commission is already inside, NOT on top).
  const total = Number(p.price ?? 0);
  cmTotal.innerHTML = `<strong>${fmtHbar(total)}</strong>`;

  cmOperator.textContent = p.buyerAccountId || agentInfo?.operatorAccountId || '—';
  cmCancel.disabled = false;
  cmConfirm.disabled = false;
  cmConfirm.textContent = 'Confirm & sign';
  cmBackdrop.hidden = false;
}

function closeConfirmModal() {
  cmBackdrop.hidden = true;
  pendingForConfirm = null;
}

function appendPurchaseResult(targetMsgFinder, html, cls) {
  // Append below the last agent message
  const all = chatEl.querySelectorAll('.msg.agent:not(.thinking)');
  const last = all[all.length - 1];
  if (!last) return;
  const body = last.querySelector('.msg-body') || last;
  const note = document.createElement('div');
  note.className = `purchase-result ${cls}`;
  note.innerHTML = html;
  body.appendChild(note);
  scrollToBottom();
}

async function executePurchase() {
  if (!pendingForConfirm) return;
  const p = pendingForConfirm;
  cmCancel.disabled = true;
  cmConfirm.disabled = true;
  cmConfirm.textContent = 'Signing…';

  try {
    const res = await fetch('/api/execute-purchase', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pendingId: p.pendingId }),
    });
    const data = await res.json();
    closeConfirmModal();

    if (!res.ok || !data.success) {
      appendPurchaseResult(
        null,
        `Purchase failed: ${escapeHtml(data?.error ?? `HTTP ${res.status}`)}`,
        'failed',
      );
      return;
    }
    const link = `<a href="${escapeHtml(data.hashscanUrl)}" target="_blank" rel="noopener">${escapeHtml(data.transactionId)}</a>`;
    let html = `Bought ${escapeHtml(p.token)} #${escapeHtml(p.serial)}. View on HashScan: ${link}`;
    if (data.associate && data.associate.hashscanUrl) {
      const assocLink = `<a href="${escapeHtml(data.associate.hashscanUrl)}" target="_blank" rel="noopener">${escapeHtml(data.associate.transactionId)}</a>`;
      html = `Token ${escapeHtml(p.token)} auto-associated (${assocLink}).<br>` + html;
    }
    appendPurchaseResult(null, html, 'success');
    loadWallet(); // refresh balance after successful purchase
  } catch (err) {
    closeConfirmModal();
    appendPurchaseResult(null, `Network error: ${escapeHtml(err?.message ?? String(err))}`, 'failed');
  }
}

cmCancel.addEventListener('click', closeConfirmModal);
cmConfirm.addEventListener('click', executePurchase);
cmBackdrop.addEventListener('click', (e) => {
  if (e.target === cmBackdrop) closeConfirmModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !cmBackdrop.hidden) closeConfirmModal();
});

// ─── Listing confirmation modal ────────────────────────────────────
let pendingForListConfirm = null;

function openListModal(p) {
  pendingForListConfirm = p;
  lmToken.textContent = p.token;
  lmSerial.textContent = `#${p.serial}`;
  lmPrice.innerHTML = `<strong>${fmtHbar(p.price)}</strong>`;
  lmSeller.textContent = p.sellerAccountId || agentInfo?.operatorAccountId || '—';
  lmApproval.textContent = p.skipOnChainApprove
    ? 'Already approved (no signing needed)'
    : 'Yes (one-time approval)';
  lmCancel.disabled = false;
  lmConfirm.disabled = false;
  lmConfirm.textContent = p.skipOnChainApprove ? 'Confirm listing' : 'Confirm & sign';
  lmBackdrop.hidden = false;
}

function closeListModal() {
  lmBackdrop.hidden = true;
  pendingForListConfirm = null;
}

async function executeListing() {
  if (!pendingForListConfirm) return;
  const p = pendingForListConfirm;
  lmCancel.disabled = true;
  lmConfirm.disabled = true;
  lmConfirm.textContent = p.skipOnChainApprove ? 'Listing…' : 'Signing…';

  try {
    const res = await fetch('/api/execute-listing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pendingListingId: p.pendingListingId }),
    });
    const data = await res.json();
    closeListModal();

    if (!res.ok || !data.success) {
      appendPurchaseResult(
        null,
        `Listing failed: ${escapeHtml(data?.error ?? `HTTP ${res.status}`)}`,
        'failed',
      );
      return;
    }
    const link = data.hashscanUrl
      ? `<a href="${escapeHtml(data.hashscanUrl)}" target="_blank" rel="noopener">${escapeHtml(data.transactionId)}</a>`
      : 'no on-chain tx needed';
    appendPurchaseResult(
      null,
      `Listed ${escapeHtml(p.token)} #${escapeHtml(p.serial)} for ${escapeHtml(String(p.price))} HBAR. Approval: ${link}`,
      'success',
    );
    loadWallet();
  } catch (err) {
    closeListModal();
    appendPurchaseResult(null, `Network error: ${escapeHtml(err?.message ?? String(err))}`, 'failed');
  }
}

lmCancel.addEventListener('click', closeListModal);
lmConfirm.addEventListener('click', executeListing);
lmBackdrop.addEventListener('click', (e) => {
  if (e.target === lmBackdrop) closeListModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !lmBackdrop.hidden) closeListModal();
});

// ─── Unlisting confirmation modal ──────────────────────────────────
let pendingForUnlistConfirm = null;

function openUnlistModal(p) {
  pendingForUnlistConfirm = p;
  umToken.textContent = p.token;
  umSerial.textContent = `#${p.serial}`;
  umSeller.textContent = p.sellerAccountId || agentInfo?.operatorAccountId || '—';
  umApproval.textContent = p.skipOnChainApprove ? 'Not required' : 'Yes (one Hedera transaction)';
  umCancel.disabled = false;
  umConfirm.disabled = false;
  umConfirm.textContent = p.skipOnChainApprove ? 'Confirm unlist' : 'Confirm & sign';
  umBackdrop.hidden = false;
}

function closeUnlistModal() {
  umBackdrop.hidden = true;
  pendingForUnlistConfirm = null;
}

async function executeUnlisting() {
  if (!pendingForUnlistConfirm) return;
  const p = pendingForUnlistConfirm;
  umCancel.disabled = true;
  umConfirm.disabled = true;
  umConfirm.textContent = p.skipOnChainApprove ? 'Unlisting…' : 'Signing…';

  try {
    const res = await fetch('/api/execute-unlisting', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pendingUnlistingId: p.pendingUnlistingId }),
    });
    const data = await res.json();
    closeUnlistModal();

    if (!res.ok || !data.success) {
      appendPurchaseResult(
        null,
        `Unlist failed: ${escapeHtml(data?.error ?? `HTTP ${res.status}`)}`,
        'failed',
      );
      return;
    }
    const link = data.hashscanUrl
      ? `<a href="${escapeHtml(data.hashscanUrl)}" target="_blank" rel="noopener">${escapeHtml(data.transactionId)}</a>`
      : 'no on-chain tx needed';
    appendPurchaseResult(
      null,
      `Unlisted ${escapeHtml(p.token)} #${escapeHtml(p.serial)}. Tx: ${link}`,
      'success',
    );
    loadWallet();
  } catch (err) {
    closeUnlistModal();
    appendPurchaseResult(null, `Network error: ${escapeHtml(err?.message ?? String(err))}`, 'failed');
  }
}

umCancel.addEventListener('click', closeUnlistModal);
umConfirm.addEventListener('click', executeUnlisting);
umBackdrop.addEventListener('click', (e) => {
  if (e.target === umBackdrop) closeUnlistModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !umBackdrop.hidden) closeUnlistModal();
});

// ─── Reset ─────────────────────────────────────────────────────────
function reset() {
  clearHistory();
  chatEl.innerHTML = '';
  chatEl.appendChild(welcomeEl);
  showWelcome();
}

// ─── Composer behavior ─────────────────────────────────────────────
function autoresize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
}
function updateSendState() {
  sendBtn.disabled = inputEl.value.trim().length === 0;
}

inputEl.addEventListener('input', () => {
  autoresize();
  updateSendState();
});
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
composerEl.addEventListener('submit', (e) => {
  e.preventDefault();
  send();
});
resetBtn.addEventListener('click', reset);

// ─── Analytics (NFT history) ───────────────────────────────────────
function openAnalytics() {
  analyticsBackdrop.hidden = false;
  loadAnalytics();
}
function closeAnalytics() {
  analyticsBackdrop.hidden = true;
}

function renderAnalyticsItems(items) {
  if (!items || items.length === 0) {
    analyticsBody.innerHTML = `
      <div class="analytics-empty">
        No NFT transactions found for this account yet.<br>
        Buy or receive an NFT and it will appear here.
      </div>`;
    return;
  }
  const list = document.createElement('div');
  list.className = 'analytics-list';
  for (const it of items) {
    const date = new Date(it.dateISO).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    const row = document.createElement('div');
    row.className = 'analytics-row';
    const typeLabel = it.type === 'buy' ? 'Bought' : 'Sold';
    const counterLabel = it.type === 'buy' ? 'from' : 'to';
    row.innerHTML = `
      <span class="analytics-type ${it.type}">${typeLabel}</span>
      <div class="analytics-main">
        <span class="analytics-token"><strong>${escapeHtml(it.token)}</strong> · #${escapeHtml(String(it.serial))}</span>
        <span class="analytics-meta">
          <span>${escapeHtml(date)}</span>
          <span>·</span>
          <span>${counterLabel} ${escapeHtml(it.counterparty || '?')}</span>
          ${it.viaSharkly ? '<span class="analytics-via-sharkly">via Sharkly</span>' : ''}
        </span>
      </div>
      <div class="analytics-side">
        <span class="analytics-amount">${it.hbarAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} HBAR</span>
        <a class="analytics-link" href="${escapeHtml(it.hashscanUrl)}" target="_blank" rel="noopener">HashScan →</a>
      </div>
    `;
    list.appendChild(row);
  }
  analyticsBody.innerHTML = '';
  analyticsBody.appendChild(list);
}

async function loadAnalytics() {
  analyticsBody.innerHTML = `<div class="analytics-empty">Loading…</div>`;
  try {
    const res = await fetch('/api/history?limit=50');
    const data = await res.json();
    analyticsSub.textContent = `${data.count ?? 0} NFT transaction(s) on ${data.network ?? 'mainnet'} for ${data.accountId ?? ''}`;
    if (!res.ok) {
      analyticsBody.innerHTML = `<div class="analytics-empty">Error: ${escapeHtml(data.error ?? 'unknown')}</div>`;
      return;
    }
    renderAnalyticsItems(data.items);
  } catch (err) {
    analyticsBody.innerHTML = `<div class="analytics-empty">Network error: ${escapeHtml(err?.message ?? String(err))}</div>`;
  }
}

navAnalytics.addEventListener('click', openAnalytics);
analyticsClose.addEventListener('click', closeAnalytics);
analyticsRefresh.addEventListener('click', loadAnalytics);
analyticsBackdrop.addEventListener('click', (e) => {
  if (e.target === analyticsBackdrop) closeAnalytics();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !analyticsBackdrop.hidden) closeAnalytics();
});

// ─── Wallet pill (live balance) ────────────────────────────────────
function classifyBalance(hbar) {
  if (hbar < 5) return 'low';
  if (hbar < 20) return 'mid';
  return 'ok';
}

async function loadWallet() {
  try {
    const res = await fetch('/api/wallet');
    const w = await res.json();
    if (w.accountId) {
      walletAccount.textContent = w.accountId;
      walletPill.href = w.hashscanUrl || '#';
      if (navWallet) navWallet.href = w.hashscanUrl || '#';
    }
    if (typeof w.balanceHbar === 'number') {
      const bal = w.balanceHbar;
      const formatted =
        bal >= 1000
          ? bal.toLocaleString(undefined, { maximumFractionDigits: 0 })
          : bal.toLocaleString(undefined, { maximumFractionDigits: 2 });
      walletBalance.textContent = `${formatted} HBAR`;
      walletBalance.className = `wallet-balance ${classifyBalance(bal)}`;
      if (w.network && w.network !== 'mainnet') {
        walletBalance.classList.add('testnet');
      }
      walletPill.title = `Account ${w.accountId} · ${bal} HBAR · ${w.network} · click for HashScan`;
    } else if (w.error) {
      walletBalance.textContent = 'unreachable';
      walletBalance.className = 'wallet-balance low';
    }
  } catch (err) {
    walletBalance.textContent = 'offline';
    walletBalance.className = 'wallet-balance low';
  }
}

// ─── Boot ──────────────────────────────────────────────────────────
loadInfo();
loadWallet();
rehydrate();
updateSendState();

// Refresh wallet balance every 30s + after each successful purchase
setInterval(loadWallet, 30_000);
