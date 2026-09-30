// placeholders.js — the empty / loading messages that fill a list container.
// One helper instead of a dozen hand-written `innerHTML = '<div class=…>'`.

import { t } from './i18n.js';

// A single centred hint line ("No stations found", "Failed to load …").
// `action`, when given as { label, onClick }, adds a button (e.g. "Retry").
export function showEmpty(container, text, action = null) {
    if (!container) return;
    const hint = document.createElement('div');
    hint.className = 'loading-hint';
    hint.textContent = t(text);
    if (action) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hint-action';
        btn.textContent = t(action.label);
        btn.addEventListener('click', action.onClick);
        hint.append(document.createElement('br'), btn);
    }
    container.replaceChildren(hint);
}

// Skeleton rows while a list loads. The visible shimmer is decorative; the
// message is kept for screen readers.
export function showLoading(container, text, rows = 6) {
    if (!container) return;
    const wrap = document.createElement('div');
    wrap.className = 'skeleton-list';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-busy', 'true');

    const label = document.createElement('span');
    label.className = 'sr-only';
    label.textContent = t(text);
    wrap.appendChild(label);

    for (let i = 0; i < rows; i++) {
        const row = document.createElement('div');
        row.className = 'skeleton-row';
        row.setAttribute('aria-hidden', 'true');
        row.innerHTML = '<span class="skeleton-logo"></span><span class="skeleton-lines"><i></i><i></i></span>';
        wrap.appendChild(row);
    }
    container.replaceChildren(wrap);
}
