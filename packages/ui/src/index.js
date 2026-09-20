const paths = {
    brush: 'm14 4 6 6M4 20l5-1L21 7l-4-4L5 15l-1 5Z', eraser: 'm15 3 6 6-11 11H5l-3-3L15 3ZM8 11l6 6M11 20h11', drop: 'M12 3s-7 8-7 12a7 7 0 0 0 14 0c0-4-7-12-7-12Z', cursor: 'm4 3 6 18 3-8 8-3L4 3Z', layers: 'm12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5', plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', chevron: 'm8 5 7 7-7 7', down: 'm5 9 7 7 7-7', check: 'm5 12 4 4L19 6', close: 'm6 6 12 12M6 18 18 6', eye: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z', eyeOff: 'm3 3 18 18M10 5h2c7 0 10 7 10 7a17 17 0 0 1-3 4M6 6a22 22 0 0 0-4 6s3 7 10 7a12 12 0 0 0 5-1', trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7', copy: 'M9 8h11v13H9V8ZM15 8V3H4v13h5', undo: 'M3 10h11a6 6 0 0 1 0 12M3 10l6-6M3 10l6 6', redo: 'M21 10H10a6 6 0 0 0 0 12M21 10l-6-6M21 10l-6 6', download: 'M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6', upload: 'M12 15V3M7 8l5-5 5 5M4 15v6h16v-6', folder: 'M3 6h7l2 3h9v12H3V6Z', save: 'M4 3h13l4 4v14H3V3h1ZM7 3v6h10V3M7 21v-8h10v8', cube: 'm12 2 10 5v10l-10 5-10-5V7l10-5Zm0 10v10M2 7l10 5 10-5M7 4l10 5', grid: 'M3 3h7v7H3V3ZM14 3h7v7h-7V3ZM3 14h7v7H3v-7ZM14 14h7v7h-7v-7', search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6', sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1', camera: 'M3 7h4l2-3h6l2 3h4v14H3V7ZM12 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', rotate: 'M3 10a9 9 0 1 1 0 4M3 3v7h7', move: 'M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4M18 8l4 4-4 4', mask: 'M3 4h18v10a9 9 0 0 1-18 0V4ZM12 4v19', settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6', bolt: 'm13 2-9 12h7l-1 8L21 9h-8l0-7Z', more: 'M5 11h1v1H5v-1ZM11 11h1v1h-1v-1ZM17 11h1v1h-1v-1Z', split: 'M3 4h18v16H3V4ZM14 4v16', image: 'M3 3h18v18H3V3Zm0 14 6-6 4 4 3-3 5 5M16 6h1v1h-1V6Z', text: 'M4 4h16M12 4v16M8 20h8', help: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM9 8a3 3 0 1 1 5 2c-2 1-2 2-2 4M12 17h.01', file: 'M5 2h9l5 5v15H5V2ZM14 2v6h5M8 13h8M8 17h8', play: 'm7 3 15 9-15 9V3Z', pause: 'M7 4v16M17 4v16', arrowUp: 'm6 14 6-6 6 6', arrowDown: 'm6 10 6 6 6-6', lock: 'M5 10h14v11H5V10ZM8 10V6a4 4 0 0 1 8 0v4', pipette: 'm16 3 5 5M5 15l11-11 4 4L9 19H5v-4ZM3 21l2-2', terminal: 'm4 6 5 6-5 6M12 18h8', heart: 'M12 21 3 12a6 6 0 0 1 9-8 6 6 0 0 1 9 8l-9 9Z', symmetry: 'M12 2v20M8 5 2 12l6 7V5ZM16 5l6 7-6 7V5Z'
};
export const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function icon(name, size = 18) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.cube}"/></svg>`;
}
export const $ = (selector, root = document) => root.querySelector(selector);
export function button(id, label, glyph, cls = '') {
    return `<button id="${id}" class="${cls}" title="${escapeHTML(label)}" aria-label="${escapeHTML(label)}">${icon(glyph)}<span>${escapeHTML(label)}</span></button>`;
}
export function toast(message, type = 'info') {
    let host = $('#toasts');
    if (!host) {
        host = document.createElement('div');
        host.id = 'toasts';
        host.setAttribute('aria-live', 'polite');
        document.body.append(host);
    }
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = icon(type === 'error' ? 'close' : 'check') + '<span>' + escapeHTML(message) + '</span>';
    host.append(el);
    setTimeout(() => el.remove(), type === 'error' ? 8000 : 4000);
}
export function modal(title, body, { wide = false } = {}) {
    const previous = document.activeElement, dialog = document.createElement('dialog');
    dialog.className = 'modal' + (wide ? ' wide' : '');
    dialog.innerHTML = `<div class="modal-title"><h2>${escapeHTML(title)}</h2><button class="icon-btn close-modal" title="Close" aria-label="Close">${icon('close')}</button></div><div class="modal-body">${body}</div>`;
    document.body.append(dialog);
    const close = () => {
        dialog.close();
        dialog.remove();
        previous?.focus?.();
    };
    $('.close-modal', dialog).onclick = close;
    dialog.addEventListener('click', e => {
        if (e.target === dialog) {
            const r = dialog.getBoundingClientRect();
            if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
                close();
        }
    });
    dialog.addEventListener('cancel', e => {
        e.preventDefault();
        close();
    });
    dialog.showModal();
    return { element: dialog, close };
}
export class CommandRegistry {
    constructor() {
        this.commands = new Map();
    }
    register(id, label, run, shortcut = '') {
        this.commands.set(id, { id, label, run, shortcut });
        return this;
    }
    execute(id) {
        return this.commands.get(id)?.run();
    }
    palette() {
        const m = modal('Command palette', `<input class="palette-search" placeholder="Search actions…" autofocus aria-label="Search commands"><div class="command-list"></div>`);
        const input = $('input', m.element), list = $('.command-list', m.element);
        const render = () => {
            list.replaceChildren();
            for (const c of this.commands.values()) {
                if (!c.label.toLowerCase().includes(input.value.toLowerCase()))
                    continue;
                const b = document.createElement('button');
                b.innerHTML = `<span>${escapeHTML(c.label)}</span><kbd>${escapeHTML(c.shortcut)}</kbd>`;
                b.onclick = () => {
                    m.close();
                    c.run();
                };
                list.append(b);
            }
        };
        input.oninput = render;
        input.onkeydown = e => {
            if (e.key === 'Enter')
                list.querySelector('button')?.click();
        };
        render();
    }
}
export function installSplitter(handle, { target, property, min, max, invert = false, storageKey }) {
    let start, value, saved;
    try {
        saved = Number(localStorage.getItem(storageKey));
    }
    catch {
        saved = 0;
    }
    if (saved >= min && saved <= max)
        target.style.setProperty(property, saved + 'px');
    handle.addEventListener('pointerdown', e => {
        e.preventDefault();
        start = e.clientX;
        value = parseFloat(getComputedStyle(target).getPropertyValue(property));
        handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', e => {
        if (!handle.hasPointerCapture(e.pointerId))
            return;
        const n = Math.max(min, Math.min(max, value + (e.clientX - start) * (invert ? -1 : 1)));
        target.style.setProperty(property, n + 'px');
    });
    handle.addEventListener('pointerup', e => {
        if (handle.hasPointerCapture(e.pointerId))
            handle.releasePointerCapture(e.pointerId);
        try {
            localStorage.setItem(storageKey, parseFloat(getComputedStyle(target).getPropertyValue(property)));
        }
        catch {
        }
    });
}
