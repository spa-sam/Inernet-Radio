// keymap.js — which action a key press maps to. Pure, so it is unit-tested.

// Decide what a key press should do. Pure (no DOM writes) so it can be tested.
// `ctx` describes the focused element: { typing, interactive }.
export function actionForKey(e, ctx) {
    if (e.ctrlKey || e.metaKey || e.altKey) return null;
    if (ctx.typing) return null;
    switch (e.key) {
        case 'm': case 'M': return 'mute';
        case 'n': case 'N': return 'next';
        case 'p': case 'P': return 'prev';
        case 'f': case 'F': return 'favorite';
        case '/': return 'search';
        default: break;
    }
    if (ctx.interactive) return null;
    switch (e.key) {
        case ' ': return 'play';
        case 'ArrowUp': return 'volume-up';
        case 'ArrowDown': return 'volume-down';
        case 'ArrowRight': return 'next';
        case 'ArrowLeft': return 'prev';
        default: return null;
    }
}
