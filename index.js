/**
 * notsosillynotsoimages — Inline Image & Video Generation for SillyTavern
 * Character references, NPC slots, video, iOS compatibility layer.
 *
 * Copyright (C) 2025-2026 aceeenvw
 * Repository: https://github.com/aceeenvw/notsosillynotsoimages
 *
 * Based on SillyImages by 0xl0cal
 * Original: https://github.com/0xl0cal/sillyimages
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: If you use or adapt any part of this code in your own project,
 * you must retain this copyright notice and provide attribution to the
 * original author (aceeenvw) in a prominent location (file header,
 * README, or UI credits).
 */

const MODULE_NAME = 'inline_image_gen';
const IIG_VERSION = '3.0.0';

// Author signature, decoded at load for the build-integrity check.
const _MI = [0x64,0x66,0x68,0x68,0x71,0x79,0x7a].map(c => String.fromCharCode(c - 3)).join('');

// Build metadata — exposed at window.__iig_build for integrity verification.
const _BM = (() => {
    const t = new Uint8Array([97, 99, 101, 101, 110, 118, 119]);
    let h = 0x811c9dc5 >>> 0;
    for (const b of t) { h ^= b; h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
    for (const c of '3.0.0') { h ^= c.charCodeAt(0); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
    return { k: String.fromCharCode(...t), h: h.toString(16).padStart(8, '0'), v: '3.0.0' };
})();
try { Object.defineProperty(window, '__iig_build', { value: _BM, writable: false, configurable: false }); } catch (_) {}

const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_MOBILE = IS_IOS || /Android|webOS|BlackBerry|Opera Mini|IEMobile/i.test(navigator.userAgent) || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
const FETCH_TIMEOUT = IS_IOS ? 180000 : 300000; // 3 min iOS, 5 min desktop
// Longer ceiling for video (renders synchronously, can take minutes).
const VIDEO_FETCH_TIMEOUT = IS_IOS ? 480000 : 600000; // 8 min iOS, 10 min desktop

// Вспомогательные функции для API Гардероба
function normalizeApiEndpoint(raw) {
    if (!raw) return '';
    return String(raw).trim().replace(/\/+$/, '').replace(/\/v1(beta)?$/i, '').replace(/\/+$/, '');
}
function sanitizeApiKey(raw) {
    return String(raw || '').replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').trim();
}
function buildAuthHeaders(apiKey, extra = {}) {
    const key = sanitizeApiKey(apiKey);
    if (!key) throw new Error('API Key не задан');
    return { 'Authorization': `Bearer ${key}`, ...extra };
}

/* ╔═══════════════════════════════════════════════════════════════╗
   ║  MODULE 1: SlayWardrobe                                       ║
   ╚═══════════════════════════════════════════════════════════════╝ */

(function initWardrobe() {
    'use strict';
    const SW = 'slay_wardrobe';

    function uid() { return Date.now().toString(36) + Math.random().toString(36).substring(2, 8); }
    function swLog(l, ...a) { (l === 'ERROR' ? console.error : l === 'WARN' ? console.warn : console.log)('[SW]', ...a); }
    function esc(t) { const d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; }

    // ── Categories & Tags ──
    const CATEGORIES = Object.freeze({
        full: 'Полный',
        top: 'Верх',
        bottom: 'Низ',
        shoes: 'Обувь',
        accessories: 'Аксессуары',
        hair: 'Причёска',
    });
    const CAT_KEYS = Object.keys(CATEGORIES);
    const TAGS = Object.freeze({
        street: 'Улица',
        home: 'Дом',
        evening: 'Вечер',
        sleep: 'Сон',
        sport: 'Спорт',
        beach: 'Пляж',
        other: 'Другое',
    });
    const TAG_KEYS = Object.keys(TAGS);

    const GENDERS = Object.freeze({ unisex: '⚥', female: '♀️', male: '♂️' });
    const GENDER_KEYS = Object.keys(GENDERS);
    const GENDER_COLORS = Object.freeze({ unisex: '#a855f7', female: '#f472b6', male: '#60a5fa' });

    // ── Defaults (v4 — global items, per-character active outfits) ──
    const swDefaults = Object.freeze({
        items: [],
        activeOutfits: {},
        maxDimension: 512,
        showFloatingBtn: false,
        autoDescribe: true,
        describeMode: 'direct',
        describeModel: '',
        describeEndpoint: '',
        describeKey: '',
        describePromptStyle: 'detailed',
        sendOutfitDescription: true,
        sendOutfitImageBot: true,
        sendOutfitImageUser: true,
        experimentalCollage: false,
        skipDescriptionWarning: false,
        // v4.1 UX additions
        modalWidth: 'normal',   // compact | normal | wide | xwide | full
        showHidden: false,      // toggle to show hidden items in grid
        tagsCollapsed: false,   // collapse the tag-filter row (funnel toggle in category row)
    });

    // Map preset -> pixel width (used as CSS var --sw-modal-width)
    const MODAL_WIDTH_MAP = Object.freeze({
        compact: '480px',
        normal: '560px',
        wide: '800px',
        xwide: '1100px',
        full: '96vw',
    });
    function swApplyModalWidth() {
        const s = swGetSettings();
        const val = MODAL_WIDTH_MAP[s.modalWidth] || MODAL_WIDTH_MAP.normal;
        document.documentElement.style.setProperty('--sw-modal-width', val);
    }

    function swGetSettings() {
        const ctx = SillyTavern.getContext();
        if (!ctx.extensionSettings[SW]) ctx.extensionSettings[SW] = structuredClone(swDefaults);
        const s = ctx.extensionSettings[SW];
        for (const k of Object.keys(swDefaults)) if (!Object.hasOwn(s, k)) s[k] = swDefaults[k];
        if (!Array.isArray(s.items)) s.items = [];
        if (!s.activeOutfits || typeof s.activeOutfits !== 'object') s.activeOutfits = {};
        swMigrate(s);
        return s;
    }
    function swSave() { SillyTavern.getContext().saveSettingsDebounced(); }

    // ── Migration from v3 (per-character wardrobes) to v4 (global items) ──
    function swMigrate(s) {
        if (!s.wardrobes) return;
        swLog('INFO', 'Migrating v3 wardrobes to v4 global items...');
        for (const charName of Object.keys(s.wardrobes)) {
            const w = s.wardrobes[charName];
            for (const type of ['bot', 'user']) {
                if (!Array.isArray(w[type])) continue;
                for (const old of w[type]) {
                    if (s.items.find(i => i.id === old.id)) continue;
                    s.items.push({
                        id: old.id,
                        name: old.name || 'Unnamed',
                        description: old.description || '',
                        imagePath: old.imagePath || '',
                        base64: old.base64 || '',
                        category: 'full',
                        tags: [],
                        addedAt: old.addedAt || Date.now(),
                    });
                }
                // Migrate active outfit references
                const oldActive = s.activeOutfits?.[charName];
                if (oldActive && (oldActive.bot === undefined || typeof oldActive.bot === 'string' || oldActive.bot === null)) {
                    const oldBotId = oldActive.bot || null;
                    const oldUserId = oldActive.user || null;
                    s.activeOutfits[charName] = swMakeCharOutfit(oldBotId, oldUserId);
                }
            }
        }
        delete s.wardrobes;
        swSave();
        swLog('INFO', 'Migration complete');
    }

    function swMakeCharOutfit(botFullId, userFullId) {
        return {
            mode: 'full',
            bot: { full: botFullId || null, top: null, bottom: null, shoes: null, accessories: null, hair: null },
            user: { full: userFullId || null, top: null, bottom: null, shoes: null, accessories: null, hair: null },
        };
    }

    function swCharName() {
        const ctx = SillyTavern.getContext();
        return (ctx.characterId !== undefined && ctx.characters?.[ctx.characterId]) ? (ctx.characters[ctx.characterId].name || '') : '';
    }

    // ── Item accessors (global) ──
    function swFindItem(id) { return swGetSettings().items.find(o => o.id === id) || null; }
    function swAddItem(item) { swGetSettings().items.push(item); swSave(); }
    function swToggleHidden(id) {
        const o = swFindItem(id); if (!o) return;
        o.hidden = !o.hidden;
        swSave();
    }
    function swToggleFavourite(id) {
        const o = swFindItem(id); if (!o) return;
        o.favourite = !o.favourite;
        swSave();
    }
    function swRemoveItem(id) {
        const s = swGetSettings();
        s.items = s.items.filter(o => o.id !== id);
        // Clear from all active outfits
        for (const cn of Object.keys(s.activeOutfits)) {
            const co = s.activeOutfits[cn];
            for (const type of ['bot', 'user']) {
                if (!co[type]) continue;
                for (const cat of CAT_KEYS) {
                    if (co[type][cat] === id) co[type][cat] = null;
                }
            }
        }
        swSave();
        swUpdatePromptInjection();
    }

    // ── Per-character active outfit ──
    function swGetCharOutfit() {
        const cn = swCharName();
        if (!cn) return null;
        const s = swGetSettings();
        if (!s.activeOutfits[cn]) s.activeOutfits[cn] = swMakeCharOutfit(null, null);
        const co = s.activeOutfits[cn];
        // Ensure structure
        if (!co.bot) co.bot = { full: null, top: null, bottom: null, shoes: null, accessories: null, hair: null };
        if (!co.user) co.user = { full: null, top: null, bottom: null, shoes: null, accessories: null, hair: null };
        if (!co.botMode) co.botMode = co.mode || 'full';
        if (!co.userMode) co.userMode = co.mode || 'full';
        return co;
    }

    function swGetSlot(type, cat) {
        const co = swGetCharOutfit();
        return co ? (co[type]?.[cat] || null) : null;
    }

    function swSetSlot(type, cat, id) {
        const cn = swCharName();
        if (!cn) { toastr.error('Персонаж не выбран', 'Гардероб'); return false; }
        const co = swGetCharOutfit();
        co[type][cat] = id;
        // Track lastWornAt per figure (bot/user) so Quick-Swap can rank by "last
        // worn on THIS figure" — users may have different relevant history for
        // bot vs user. Also keep a global lastWornAt for back-compat / general sort.
        if (id) {
            const item = swFindItem(id);
            if (item) {
                const now = Date.now();
                item.lastWornAt = now;
                if (type === 'bot') item.lastWornAtBot = now;
                else if (type === 'user') item.lastWornAtUser = now;
            }
        }
        swSave();
        return true;
    }

    // Equip a full outfit from Quick-Swap. Unlike swSetSlot this:
    //   (a) forces mode=full on the target type
    //   (b) preserves parts (top/bottom/shoes/accessories/hair) intact so the user can
    //       switch back to "по частям" in the full wardrobe modal without losing data
    //   (c) updates lastWornAt + saves + re-renders the preview popup & fab badge
    function swQuickSwapFull(type, id) {
        const co = swGetCharOutfit();
        if (!co || !co[type]) return false;
        co[type].full = id;
        co[type + 'Mode'] = 'full';
        // Mirror swSetSlot's lastWornAt bump (global + per-figure)
        const item = swFindItem(id);
        if (item) {
            const now = Date.now();
            item.lastWornAt = now;
            if (type === 'bot') item.lastWornAtBot = now;
            else if (type === 'user') item.lastWornAtUser = now;
        }
        swSave();
        swInjectFloatingBtn();       // badge refresh
        swUpdatePromptInjection();
        return true;
    }

    // Pick the "topmost worn item" for the preview thumbnail.
    //   full mode  → the full item (if any)
    //   parts mode → first non-null in priority order: top → bottom → shoes
    //                → accessories → hair
    //   nothing equipped → null
    const SW_PARTS_PRIORITY = ['top', 'bottom', 'shoes', 'accessories', 'hair'];
    function swGetTopWornItem(type) {
        const co = swGetCharOutfit();
        if (!co || !co[type]) return null;
        const mode = swGetModeFor(type);
        if (mode === 'full') {
            const id = co[type].full;
            return id ? swFindItem(id) : null;
        }
        for (const cat of SW_PARTS_PRIORITY) {
            const id = co[type][cat];
            if (id) {
                const item = swFindItem(id);
                if (item) return item;
            }
        }
        return null;
    }

    // Count how many parts are currently worn (across bot+user). Used for FAB badge.
    // A full counts as 1 (regardless of how many categories it represents).
    function swCountWornParts() {
        const co = swGetCharOutfit();
        if (!co) return 0;
        let n = 0;
        for (const type of ['bot', 'user']) {
            const mode = swGetModeFor(type);
            if (mode === 'full') {
                if (co[type]?.full) n++;
            } else {
                for (const cat of SW_PARTS_PRIORITY) if (co[type]?.[cat]) n++;
            }
        }
        return n;
    }

    // Quick-Swap ranking:
    //   1. favourites first
    //   2. then by lastWornAt DESC (most recently worn higher)
    //   3. then by name ASC
    //   hidden items are excluded entirely
    // Rank for Quick-Swap, figure-aware:
    //   1. favourites first (shared across figures — single ⭐ flag on the item)
    //   2. then by lastWornAtBot or lastWornAtUser DESC (depending on `figure`).
    //      Falls back to global lastWornAt if per-figure stamp not yet set.
    //   3. then by name ASC
    //   hidden items are excluded entirely
    function swRankForQuickSwap(items, figure = 'user') {
        const stampKey = figure === 'bot' ? 'lastWornAtBot' : 'lastWornAtUser';
        return items
            .filter(o => !o.hidden)
            .sort((a, b) => {
                const af = a.favourite ? 1 : 0, bf = b.favourite ? 1 : 0;
                if (af !== bf) return bf - af;
                const aw = a[stampKey] || a.lastWornAt || 0;
                const bw = b[stampKey] || b.lastWornAt || 0;
                if (aw !== bw) return bw - aw;
                return String(a.name || '').localeCompare(String(b.name || ''));
            });
    }

    // Group full-category items by tag. Items without any tag land under 'other'.
    // Returns { [tagKey]: Item[] } with values ranked for the target figure so
    // "last worn on THIS figure" floats up (bot and user can have different
    // relevant histories).
    function swGroupFullsByTag(figure = 'user') {
        const all = swGetSettings().items.filter(o => o.category === 'full');
        const byTag = {};
        for (const tk of TAG_KEYS) byTag[tk] = [];
        for (const item of all) {
            const tags = Array.isArray(item.tags) ? item.tags : [];
            const targetTags = tags.length ? tags.filter(t => TAG_KEYS.includes(t)) : ['other'];
            for (const tk of targetTags) {
                if (!byTag[tk]) byTag[tk] = [];
                byTag[tk].push(item);
            }
        }
        for (const tk of TAG_KEYS) byTag[tk] = swRankForQuickSwap(byTag[tk], figure);
        return byTag;
    }

    function swSetMode(mode) {
        const co = swGetCharOutfit();
        if (!co) return;
        // Per-type mode: bot and user can have different modes
        const modeKey = swTab === 'bot' ? 'botMode' : 'userMode';
        co[modeKey] = mode;
        swSave();
    }

    function swGetMode() {
        const co = swGetCharOutfit();
        if (!co) return 'full';
        return swTab === 'bot' ? (co.botMode || 'full') : (co.userMode || 'full');
    }

    function swGetModeFor(type) {
        const co = swGetCharOutfit();
        if (!co) return 'full';
        return type === 'bot' ? (co.botMode || 'full') : (co.userMode || 'full');
    }

    function swIsCatBlocked(mode, cat) {
        if (mode === 'full') return ['top', 'bottom', 'shoes'].includes(cat);
        if (mode === 'parts') return cat === 'full';
        return false;
    }

    // Accepts a File/Blob OR an already-read data: URL string. Prefer passing a
    // data URL captured at file-pick time: on Android a File is a content://
    // handle that can expire while a form modal is open — reading it later
    // fails with a bare FileReader error (the "Ошибка: read" reports).
    function swResize(src, maxDim) {
        return new Promise((res, rej) => {
            const go = (dataUrl) => { const img = new Image(); img.onload = () => { let { width: w, height: h } = img; if (w > maxDim || h > maxDim) { const s = Math.min(maxDim / w, maxDim / h); w = Math.round(w * s); h = Math.round(h * s); } const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); res({ base64: c.toDataURL('image/png').split(',')[1] }); }; img.onerror = () => rej(new Error('не удалось декодировать картинку (битый файл или формат не поддерживается)')); img.src = dataUrl; };
            if (typeof src === 'string') { go(src); return; }
            const r = new FileReader();
            r.onload = (e) => go(e.target.result);
            r.onerror = () => rej(new Error('не удалось прочитать файл — выберите его заново'));
            r.readAsDataURL(src);
        });
    }

    function swBytesToBase64(bytes) {
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(bin);
    }

    // ── Save wardrobe image to server file ──
    async function swSaveImageToFile(base64, label) {
        const ctx = SillyTavern.getContext();
        const safeName = label.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
        const filename = `wardrobe_${safeName}_${Date.now()}`;
        const response = await fetch('/api/images/upload', {
            method: 'POST', headers: ctx.getRequestHeaders(),
            body: JSON.stringify({ image: base64, format: 'png', ch_name: 'wardrobe_refs', filename })
        });
        if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
        const result = await response.json();
        swLog('INFO', `Wardrobe image saved: ${result.path}`);
        return result.path;
    }

    // ── Load wardrobe image from server path -> base64 ──
    async function swLoadImageAsBase64(path) {
        try {
            const response = await fetch(path);
            if (!response.ok) return null;
            const blob = await response.blob();
            return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (e) { swLog('WARN', `swLoadImageAsBase64 failed: ${path}`, e.message); return null; }
    }

    // ── Get outfit image src for display (path preferred, base64 fallback) ──
    function swGetOutfitSrc(outfit) {
        if (outfit.imagePath) return outfit.imagePath;
        if (outfit.base64) return `data:image/png;base64,${outfit.base64}`;
        return '';
    }

    // ── Collage builder: merge parts into one image ──
    // Get all parts images for a type (bot/user). Returns array of base64 strings.
    async function swGetPartsImages(type) {
        const co = swGetCharOutfit();
        if (!co) return [];
        const mode = swGetModeFor(type);
        if (mode !== 'parts') return [];

        const slots = ['top', 'bottom', 'shoes', 'accessories', 'hair'];
        const images = [];
        for (const cat of slots) {
            const itemId = co[type]?.[cat];
            if (!itemId) continue;
            const item = swFindItem(itemId);
            if (!item) continue;
            let b64 = null;
            if (item.imagePath) b64 = await swLoadImageAsBase64(item.imagePath);
            if (!b64 && item.base64) b64 = item.base64;
            if (b64) images.push(b64);
        }
        return images;
    }

    async function swBuildCollage(type) {
        const images = await swGetPartsImages(type);
        if (images.length < 2) return null; // 1 item = send as single ref, not collage
        const collageImages = images.slice(0, 6); // max 6

        return new Promise((resolve) => {
            const size = 512;
            const canvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(0, 0, size, size);
            const count = collageImages.length;
            let cols, rows;
            if (count <= 2) { cols = 2; rows = 1; }
            else if (count <= 4) { cols = 2; rows = 2; }
            else { cols = 3; rows = 2; }
            const cellW = Math.floor(size / cols);
            const cellH = Math.floor(size / rows);
            let loaded = 0;
            collageImages.forEach((b64, idx) => {
                const img = new Image();
                img.onload = () => {
                    const col = idx % cols; const row = Math.floor(idx / cols);
                    const x = col * cellW; const y = row * cellH;
                    const scale = Math.max(cellW / img.width, cellH / img.height);
                    const sw = cellW / scale; const sh = cellH / scale;
                    const sx = (img.width - sw) / 2; const sy = (img.height - sh) / 2;
                    ctx.drawImage(img, sx, sy, sw, sh, x, y, cellW, cellH);
                    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
                    ctx.strokeRect(x, y, cellW, cellH);
                    loaded++;
                    if (loaded === collageImages.length) {
                        const result = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
                        swLog('INFO', `Collage built: ${count} images, ${cols}x${rows}, ~${Math.round(result.length / 1024)}KB`);
                        resolve(result);
                    }
                };
                img.onerror = () => { loaded++; if (loaded === collageImages.length) resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]); };
                img.src = `data:image/png;base64,${b64}`;
            });
        });
    }

    // ── Inline styles for new v4 elements ──
    function swInjectV4Styles() {
        if (document.getElementById('sw-v4-styles')) return;
        const style = document.createElement('style');
        style.id = 'sw-v4-styles';
        style.textContent = `
            .sw-mode-switch { display:flex; gap:6px; padding:4px 12px; }
            .sw-mode-btn { padding:5px 14px; border-radius:16px; cursor:pointer; font-size:13px; border:1px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.05); color:#ccc; transition:all .2s; user-select:none; }
            .sw-mode-btn:hover { background:rgba(255,255,255,0.1); }
            .sw-mode-btn-active { background:rgba(219,112,147,0.25); color:#f0a0c0; border-color:rgba(219,112,147,0.5); }
            .sw-mode-btn-active:hover { background:rgba(219,112,147,0.35); }

            .sw-cat-tabs { display:flex; gap:4px; padding:4px 12px; flex-wrap:wrap; }
            .sw-cat-tab { position:relative; padding:4px 12px; border-radius:14px; cursor:pointer; font-size:12px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.04); color:#aaa; transition:all .2s; user-select:none; }
            .sw-cat-tab:hover { background:rgba(255,255,255,0.08); }
            .sw-cat-tab-active { background:rgba(219,112,147,0.2); color:#f0a0c0; border-color:rgba(219,112,147,0.4); }
            .sw-cat-tab-blocked { opacity:0.35; pointer-events:none; }
            .sw-cat-dot { position:absolute; top:2px; right:4px; width:6px; height:6px; border-radius:50%; background:#db7093; display:none; }
            .sw-cat-dot-visible { display:block; }
            .sw-tagfilter-toggle { margin-left:auto; display:inline-flex; align-items:center; gap:5px; padding:4px 11px; border-radius:14px; cursor:pointer; font-size:12px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.04); color:#aaa; transition:all .2s; user-select:none; }
            .sw-tagfilter-toggle:hover { background:rgba(255,255,255,0.08); color:#ccc; }
            .sw-tagfilter-toggle.sw-tagfilter-on { background:rgba(219,112,147,0.2); color:#f0a0c0; border-color:rgba(219,112,147,0.4); }
            .sw-tagfilter-badge { font-size:11px; line-height:1; padding:1px 6px; border-radius:8px; background:rgba(219,112,147,0.35); color:#fbe3ee; max-width:80px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .sw-img-missing { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; cursor:pointer; background:rgba(255,255,255,0.03); border:1px dashed rgba(244,114,182,0.4); border-radius:8px; color:#caa; text-align:center; padding:6px; box-sizing:border-box; }
            .sw-img-missing i { font-size:26px; color:rgba(244,114,182,0.7); }
            .sw-img-missing span { font-size:11px; color:#b89; line-height:1.2; }
            .sw-img-missing .sw-img-missing-hint { font-size:10px; color:rgba(244,114,182,0.85); }

            .sw-tag-filter { display:flex; gap:4px; padding:4px 12px; flex-wrap:wrap; }
            .sw-tag-chip { padding:3px 10px; border-radius:12px; cursor:pointer; font-size:11px; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.03); color:#999; transition:all .2s; user-select:none; }
            .sw-tag-chip:hover { background:rgba(255,255,255,0.07); }
            .sw-tag-chip-active { background:rgba(147,197,219,0.2); color:#a0d0f0; border-color:rgba(147,197,219,0.4); }

            .sw-current-outfit { padding:8px 12px; border-top:1px solid rgba(255,255,255,0.08); flex-shrink:0; }
            .sw-current-title { font-size:12px; color:#888; margin-bottom:6px; }
            .sw-current-slots { display:flex; gap:6px; flex-wrap:wrap; align-items:flex-start; }
            .sw-current-slot { display:flex; flex-direction:column; align-items:center; gap:2px; min-width:52px; }
            .sw-current-slot-img { width:44px; height:44px; border-radius:8px; object-fit:cover; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.2); }
            .sw-current-slot-empty { width:44px; height:44px; border-radius:8px; border:1px dashed rgba(255,255,255,0.15); background:rgba(0,0,0,0.1); display:flex; align-items:center; justify-content:center; font-size:10px; color:#555; }
            .sw-current-slot-label { font-size:10px; color:#777; text-align:center; max-width:56px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .sw-current-desc { font-size:11px; color:#999; margin-top:6px; line-height:1.4; max-height:60px; overflow-y:auto; }

            .sw-upload-modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:200000; display:flex; align-items:flex-start; justify-content:center; overflow-y:auto; -webkit-overflow-scrolling:touch; padding:20px; padding-top:10vh; }
            @media (max-width:600px) { .sw-upload-modal-overlay { align-items:flex-start; padding-top:40px; } .sw-upload-modal { max-height:calc(100dvh - 60px); overflow-y:auto; } }
            @media (max-width:600px) { .sw-edit-modal-overlay { align-items:flex-start; padding:16px; padding-top:40px; } .sw-edit-modal { max-height:calc(100dvh - 60px); overflow-y:auto; } }
            .sw-upload-modal { background:#2a2a2e; border-radius:14px; padding:20px; width:360px; max-width:90vw; max-height:80vh; overflow-y:auto; color:#ddd; box-shadow:0 8px 32px rgba(0,0,0,0.5); flex-shrink:0; }
            .sw-upload-modal h3 { margin:0 0 14px; font-size:15px; color:#f0a0c0; }
            .sw-upload-modal label { display:block; font-size:12px; color:#aaa; margin:10px 0 4px; }
            .sw-upload-modal input[type="text"] { width:100%; padding:7px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.15); background:rgba(0,0,0,0.2); color:#eee; font-size:13px; box-sizing:border-box; }
            .sw-upload-modal select { width:100%; padding:7px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.15); background:rgba(0,0,0,0.2); color:#eee; font-size:13px; box-sizing:border-box; }
            .sw-upload-tags { display:flex; flex-wrap:wrap; gap:6px; margin-top:4px; }
            .sw-upload-tag { display:flex; align-items:center; gap:3px; font-size:12px; color:#bbb; cursor:pointer; user-select:none; }
            .sw-upload-tag input { accent-color:#db7093; }
            .sw-upload-btns { display:flex; gap:8px; margin-top:16px; justify-content:flex-end; }
            .sw-upload-btn { padding:7px 18px; border-radius:10px; border:none; cursor:pointer; font-size:13px; }
            .sw-upload-btn-cancel { background:rgba(255,255,255,0.08); color:#aaa; }
            .sw-upload-btn-cancel:hover { background:rgba(255,255,255,0.14); }
            .sw-upload-btn-save { background:rgba(219,112,147,0.3); color:#f0a0c0; }
            .sw-upload-btn-save:hover { background:rgba(219,112,147,0.45); }

            .sw-edit-modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:200000; display:flex; align-items:flex-start; justify-content:center; overflow-y:auto; -webkit-overflow-scrolling:touch; padding:20px; padding-top:10vh; }
            .sw-edit-modal { background:#2a2a2e; border-radius:14px; padding:20px; width:380px; max-width:90vw; max-height:80vh; overflow-y:auto; color:#ddd; box-shadow:0 8px 32px rgba(0,0,0,0.5); flex-shrink:0; }
            .sw-edit-modal h3 { margin:0 0 14px; font-size:15px; color:#f0a0c0; }
            .sw-edit-modal label { display:block; font-size:12px; color:#aaa; margin:10px 0 4px; }
            .sw-edit-modal input[type="text"], .sw-edit-modal textarea { width:100%; padding:7px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.15); background:rgba(0,0,0,0.2); color:#eee; font-size:13px; box-sizing:border-box; }
            .sw-edit-modal textarea { min-height:60px; resize:vertical; }
            .sw-edit-modal select { width:100%; padding:7px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.15); background:rgba(0,0,0,0.2); color:#eee; font-size:13px; box-sizing:border-box; }
        `;
        document.head.appendChild(style);
    }

    // ── Modal state ──
    let swOpen = false, swTab = 'bot', swCatTab = 'full', swTagFilter = null, swForWhoFilter = null, swGenderFilter = null, swFavFilter = false;

    function swOpenModal() {
        swCloseModal();
        swInjectV4Styles();
        swApplyModalWidth();
        swOpen = true;
        const cn = swCharName();
        if (!cn) { toastr.warning('Выберите персонажа', 'Гардероб'); swOpen = false; return; }

        const ov = document.createElement('div'); ov.id = 'sw-modal-overlay';
        ov.addEventListener('click', (e) => { if (e.target === ov) swCloseModal(); });

        const co = swGetCharOutfit();
        const s = swGetSettings();
        const hiddenCount = (s.items || []).filter(o => o.hidden).length;
        const m = document.createElement('div'); m.id = 'sw-modal';
        m.innerHTML = `
            <div class="sw-modal-header">
                <span>\uD83D\uDC85 Гардероб — <b>${esc(cn)}</b>
                    <label class="sw-header-toggle ${s.showHidden ? 'sw-header-toggle-active' : ''}" id="sw-show-hidden-toggle" title="Показать скрытые">
                        <i class="fa-solid fa-eye${s.showHidden ? '' : '-slash'}"></i> Скрытые: ${hiddenCount}
                    </label>
                </span>
                <div class="sw-modal-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></div>
            </div>
            <div class="sw-tabs" id="sw-type-tabs">
                <div class="sw-tab ${swTab === 'bot' ? 'sw-tab-active' : ''}" data-tab="bot">Бот</div>
                <div class="sw-tab ${swTab === 'user' ? 'sw-tab-active' : ''}" data-tab="user">Юзер</div>
            </div>
            <div class="sw-mode-switch" id="sw-mode-switch"></div>
            <div class="sw-cat-tabs" id="sw-cat-tabs"></div>
            <div class="sw-tag-filter" id="sw-tag-filter"></div>
            <div class="sw-tag-filter" id="sw-forwho-filter"></div>
            <div class="sw-tab-content" id="sw-tab-content"></div>
            <div class="sw-current-outfit" id="sw-current-outfit"></div>`;

        ov.appendChild(m); document.body.appendChild(ov);
        m.querySelector('.sw-modal-close').addEventListener('click', swCloseModal);
        m.querySelector('#sw-show-hidden-toggle')?.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            const st = swGetSettings();
            st.showHidden = !st.showHidden;
            swSave();
            // Re-render: update toggle visual + re-filter grid
            const toggle = e.currentTarget;
            toggle.classList.toggle('sw-header-toggle-active', st.showHidden);
            toggle.querySelector('i').className = `fa-solid fa-eye${st.showHidden ? '' : '-slash'}`;
            swRender();
        });
        for (const t of m.querySelectorAll('#sw-type-tabs .sw-tab')) t.addEventListener('click', () => {
            swTab = t.dataset.tab;
            swForWhoFilter = swTab; // Auto-filter: Бот tab → show bot items, Юзер tab → show user items
            m.querySelectorAll('#sw-type-tabs .sw-tab').forEach(x => x.classList.toggle('sw-tab-active', x.dataset.tab === swTab));
            swRender();
        });
        swForWhoFilter = swTab; // Default filter to current tab
        swRender();
        document.addEventListener('keydown', swEsc);
    }
    function swEsc(e) { if (e.key === 'Escape') swCloseModal(); }
    function swCloseModal() { swOpen = false; document.getElementById('sw-modal-overlay')?.remove(); document.removeEventListener('keydown', swEsc); }

    function swRender() {
        const content = document.getElementById('sw-tab-content');
        const modeWrap = document.getElementById('sw-mode-switch');
        const catWrap = document.getElementById('sw-cat-tabs');
        const tagWrap = document.getElementById('sw-tag-filter');
        const currentWrap = document.getElementById('sw-current-outfit');
        if (!content) return;
        const cn = swCharName();
        const co = swGetCharOutfit();
        if (!co) return;
        const mode = swGetMode();

        // ── Mode switch ──
        if (modeWrap) {
            modeWrap.innerHTML = `
                <div class="sw-mode-btn ${mode === 'full' ? 'sw-mode-btn-active' : ''}" data-mode="full">\uD83D\uDC57 Полный комплект</div>
                <div class="sw-mode-btn ${mode === 'parts' ? 'sw-mode-btn-active' : ''}" data-mode="parts">\uD83E\uDDE9 По частям</div>`;
            for (const btn of modeWrap.querySelectorAll('.sw-mode-btn')) {
                btn.addEventListener('click', () => {
                    swSetMode(btn.dataset.mode);
                    swRender();
                    swUpdatePromptInjection();
                    swInjectFloatingBtn();
                });
            }
        }

        // Tag-row collapse state (persisted). Funnel toggle lives in the category
        // row; clicking it shows/hides the tag filter row to save vertical space
        // (esp. on mobile). Filtering still works while collapsed — the active
        // tag is shown as a badge on the funnel.
        const tagsCollapsed = !!swGetSettings().tagsCollapsed;
        const activeTagLabel = swTagFilter ? (TAGS[swTagFilter] || swTagFilter) : '';

        // ── Category tabs with dots ──
        if (catWrap) {
            let catHtml = '';
            for (const cat of CAT_KEYS) {
                const blocked = swIsCatBlocked(mode, cat);
                const active = swCatTab === cat;
                const equipped = !!(co[swTab]?.[cat]);
                catHtml += `<div class="sw-cat-tab ${active ? 'sw-cat-tab-active' : ''} ${blocked ? 'sw-cat-tab-blocked' : ''}" data-cat="${cat}">
                    ${esc(CATEGORIES[cat])}
                    <span class="sw-cat-dot ${equipped && !blocked ? 'sw-cat-dot-visible' : ''}"></span>
                </div>`;
            }
            // Funnel toggle, pushed to the right end of the category row. NOT a
            // .sw-cat-tab (so the category-click loop below ignores it).
            catHtml += `<div class="sw-tagfilter-toggle ${tagsCollapsed ? 'sw-tagfilter-on' : ''}" id="sw-tagfilter-toggle" title="Фильтр по тегам" role="button" aria-label="Показать/скрыть фильтр по тегам" aria-pressed="${tagsCollapsed ? 'true' : 'false'}">
                <i class="fa-solid fa-filter"></i>${tagsCollapsed && swTagFilter ? `<span class="sw-tagfilter-badge">${esc(activeTagLabel)}</span>` : ''}
            </div>`;
            catWrap.innerHTML = catHtml;
            // If current cat is blocked, switch to first available
            if (swIsCatBlocked(mode, swCatTab)) {
                swCatTab = CAT_KEYS.find(c => !swIsCatBlocked(mode, c)) || 'full';
                // Re-render cat tabs with corrected active
                swRender();
                return;
            }
            for (const tab of catWrap.querySelectorAll('.sw-cat-tab:not(.sw-cat-tab-blocked)')) {
                tab.addEventListener('click', () => {
                    swCatTab = tab.dataset.cat;
                    swRender();
                });
            }
            catWrap.querySelector('#sw-tagfilter-toggle')?.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                const s = swGetSettings();
                s.tagsCollapsed = !s.tagsCollapsed;
                swSave();
                swRender();
            });
        }

        // ── Tag filter ──
        if (tagWrap) {
            // Collapsed → hide the whole tag row (filtering still applies via swTagFilter).
            tagWrap.style.display = tagsCollapsed ? 'none' : '';
            let tagHtml = `<div class="sw-tag-chip ${swTagFilter === null ? 'sw-tag-chip-active' : ''}" data-tag="">Все</div>`;
            for (const tag of TAG_KEYS) {
                tagHtml += `<div class="sw-tag-chip ${swTagFilter === tag ? 'sw-tag-chip-active' : ''}" data-tag="${tag}">${esc(TAGS[tag])}</div>`;
            }
            tagWrap.innerHTML = tagHtml;
            for (const chip of tagWrap.querySelectorAll('.sw-tag-chip')) {
                chip.addEventListener('click', () => {
                    swTagFilter = chip.dataset.tag || null;
                    swRender();
                });
            }
        }

        // ── For who + gender filter (one row with divider) ──
        const forWhoWrap = document.getElementById('sw-forwho-filter');
        if (forWhoWrap) {
            const fwLabels = { '': 'Все', 'bot': '🤖 Бот', 'user': '👤 Юзер' };
            let fwHtml = '';
            for (const [key, label] of Object.entries(fwLabels)) {
                const active = (swForWhoFilter || '') === key;
                fwHtml += `<div class="sw-tag-chip ${active ? 'sw-tag-chip-active' : ''}" data-fw="${key}">${label}</div>`;
            }
            // Divider + gender chips
            fwHtml += `<div style="width:1px;background:rgba(255,255,255,0.1);margin:0 2px;flex-shrink:0;"></div>`;
            for (const g of GENDER_KEYS) {
                const active = (swGenderFilter || '') === g || (!swGenderFilter && g === 'unisex' && false);
                const noFilter = !swGenderFilter && g === 'unisex';
                fwHtml += `<div class="sw-tag-chip ${!swGenderFilter && g === GENDER_KEYS[0] ? '' : ''} ${swGenderFilter === g ? 'sw-tag-chip-active' : ''}" data-gender="${g}" style="${swGenderFilter === g ? 'border-color:' + GENDER_COLORS[g] + '40;color:' + GENDER_COLORS[g] + ';background:' + GENDER_COLORS[g] + '18;' : ''}">${GENDERS[g]}</div>`;
            }
            // "All genders" button
            fwHtml = fwHtml.replace('</div><div style="width:1px', `</div><div class="sw-tag-chip ${!swGenderFilter ? 'sw-tag-chip-active' : ''}" data-gender="" style="font-size:10px;">Все</div><div style="width:1px`);

            // Divider + favourites filter chip
            fwHtml += `<div style="width:1px;background:rgba(255,255,255,0.1);margin:0 2px;flex-shrink:0;"></div>`;
            fwHtml += `<div class="sw-tag-chip sw-fav-filter-chip ${swFavFilter ? 'sw-tag-chip-active' : ''}" data-fav-filter title="Показать только избранные"><i class="fa-solid fa-star" style="color:${swFavFilter ? '#fbbf24' : '#888'};"></i></div>`;

            forWhoWrap.innerHTML = fwHtml;
            for (const chip of forWhoWrap.querySelectorAll('.sw-tag-chip[data-fw]')) {
                chip.addEventListener('click', () => { swForWhoFilter = chip.dataset.fw || null; swRender(); });
            }
            for (const chip of forWhoWrap.querySelectorAll('.sw-tag-chip[data-gender]')) {
                chip.addEventListener('click', () => { swGenderFilter = chip.dataset.gender || null; swRender(); });
            }
            forWhoWrap.querySelector('[data-fav-filter]')?.addEventListener('click', () => { swFavFilter = !swFavFilter; swRender(); });
        }

        // ── Filter items by category + tag + forWho + gender + hidden ──
        const settings = swGetSettings();
        const allItems = settings.items;
        const showHidden = !!settings.showHidden;
        const filtered = allItems.filter(o => {
            if (o.category !== swCatTab) return false;
            if (swTagFilter && (!Array.isArray(o.tags) || !o.tags.includes(swTagFilter))) return false;
            if (swForWhoFilter && o.forWho && o.forWho !== 'all' && o.forWho !== swForWhoFilter) return false;
            if (swGenderFilter && (o.gender || 'unisex') !== swGenderFilter) return false;
            if (!showHidden && o.hidden) return false;
            if (swFavFilter && !o.favourite) return false;
            return true;
        });

        const equippedId = co[swTab]?.[swCatTab] || null;

        // ── Sort: equipped first → favourites → normal → hidden last ──
        filtered.sort((a, b) => {
            const aRank = (a.id === equippedId) ? 0 : (a.favourite ? 1 : (a.hidden ? 3 : 2));
            const bRank = (b.id === equippedId) ? 0 : (b.favourite ? 1 : (b.hidden ? 3 : 2));
            if (aRank !== bRank) return aRank - bRank;
            // Within same rank: newest first (by addedAt desc)
            return (b.addedAt || 0) - (a.addedAt || 0);
        });

        // ── Grid ──
        let h = '<div class="sw-outfit-grid"><div class="sw-outfit-card sw-upload-card" id="sw-upload-trigger"><div class="sw-upload-icon"><i class="fa-solid fa-plus"></i></div><span>Загрузить</span></div><div class="sw-outfit-card sw-upload-card" id="sw-import-trigger"><div class="sw-upload-icon"><i class="fa-solid fa-file-import"></i></div><span>Импорт</span></div>';
        for (const o of filtered) {
            const a = o.id === equippedId;
            const fav = !!o.favourite;
            const hid = !!o.hidden;
            const classes = ['sw-outfit-card'];
            if (a) classes.push('sw-outfit-active');
            if (fav) classes.push('sw-outfit-favourite');
            if (hid) classes.push('sw-outfit-hidden');
            const _src = swGetOutfitSrc(o);
            const _imgInner = _src
                ? `<img src="${_src}" alt="${esc(o.name)}" class="sw-outfit-img" loading="lazy">`
                : `<div class="sw-img-missing"><i class="fa-solid fa-image-slash"></i><span>картинка пропала</span><span class="sw-img-missing-hint">✏️ заменить</span></div>`;
            h += `<div class="${classes.join(' ')}" data-id="${o.id}">
                <div class="sw-outfit-img-wrap">
                    ${_imgInner}
                    ${a ? '<div class="sw-active-badge"><i class="fa-solid fa-check"></i></div>' : ''}
                    <button class="sw-corner-btn sw-corner-fav ${fav ? 'sw-corner-active' : ''}" data-act="fav" title="${fav ? 'Убрать из избранного' : 'В избранное'}"><i class="fa-${fav ? 'solid' : 'regular'} fa-star"></i></button>
                    <button class="sw-corner-btn sw-corner-hide ${hid ? 'sw-corner-active' : ''}" data-act="hide" title="${hid ? 'Показать' : 'Скрыть'}"><i class="fa-solid fa-eye${hid ? '-slash' : ''}"></i></button>
                    <div style="position:absolute;top:4px;left:4px;font-size:10px;padding:1px 5px;border-radius:6px;background:rgba(0,0,0,0.5);color:${GENDER_COLORS[o.gender || 'unisex']};">${GENDERS[o.gender || 'unisex']}</div>
                </div>
                <div class="sw-outfit-footer"><span class="sw-outfit-name" title="${esc(o.description || o.name)}">${esc(o.name)}</span>
                    <div class="sw-outfit-btns">
                        <div class="sw-btn-activate" title="${a ? 'Снять' : 'Надеть'}"><i class="fa-solid ${a ? 'fa-toggle-on' : 'fa-toggle-off'}"></i></div>
                        <div class="sw-btn-edit" title="Редактировать"><i class="fa-solid fa-pen"></i></div>
                        <div class="sw-btn-regen" title="Перегенерировать описание"><i class="fa-solid fa-robot"></i></div>
                        <div class="sw-btn-delete" title="Удалить"><i class="fa-solid fa-trash-can"></i></div>
                    </div></div></div>`;
        }
        h += '</div>';
        content.innerHTML = h;

        // Update header hidden count
        const hdrToggle = document.getElementById('sw-show-hidden-toggle');
        if (hdrToggle) {
            const hiddenCount = allItems.filter(o => o.hidden).length;
            const labelText = hdrToggle.childNodes[hdrToggle.childNodes.length - 1];
            if (labelText && labelText.nodeType === 3) labelText.textContent = ` Скрытые: ${hiddenCount}`;
        }

        // NB: wrap in arrows — a bare handler reference would receive the click
        // event as the importMode argument (truthy) and break normal upload.
        document.getElementById('sw-upload-trigger')?.addEventListener('click', () => swUpload());
        document.getElementById('sw-import-trigger')?.addEventListener('click', () => swUpload(true));
        for (const card of content.querySelectorAll('.sw-outfit-card[data-id]')) {
            const id = card.dataset.id;
            // Lost-image fallback: if the file 404s (deleted from disk), swap the
            // broken <img> for a placeholder so the card isn't just a dark void.
            const cardImg = card.querySelector('.sw-outfit-img');
            cardImg?.addEventListener('error', () => {
                const wrap = cardImg.closest('.sw-outfit-img-wrap');
                if (!wrap || wrap.querySelector('.sw-img-missing')) return;
                cardImg.remove();
                const ph = document.createElement('div');
                ph.className = 'sw-img-missing';
                ph.innerHTML = '<i class="fa-solid fa-image-slash"></i><span>картинка пропала</span><span class="sw-img-missing-hint">✏️ заменить</span>';
                ph.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); swToggle(id); });
                wrap.insertBefore(ph, wrap.firstChild);
            });
            cardImg?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); swToggle(id); });
            // Placeholder also acts as the toggle target (click = equip/unequip)
            card.querySelector('.sw-img-missing')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); swToggle(id); });
            card.querySelector('.sw-btn-activate')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); swToggle(id); });
            card.querySelector('.sw-corner-fav')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); swToggleFavourite(id); swRender(); });
            card.querySelector('.sw-corner-hide')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); swToggleHidden(id); swRender(); });
            card.querySelector('.sw-btn-edit')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); swEdit(id); });
            card.querySelector('.sw-btn-regen')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); swRegenDescription(id); });
            card.querySelector('.sw-btn-delete')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); if (confirm('Удалить?')) { swRemoveItem(id); swRender(); toastr.info('Удалён', 'Гардероб'); } });
        }

        // ── Current outfit preview ──
        swRenderCurrentOutfit(currentWrap, co, cn);
    }

    function swRenderCurrentOutfit(wrap, co, cn) {
        if (!wrap) return;
        const mode = swGetMode();
        const slots = mode === 'full' ? ['full', 'accessories', 'hair'] : ['top', 'bottom', 'shoes', 'accessories', 'hair'];
        const type = swTab;

        let slotsHtml = '';
        for (const cat of slots) {
            const itemId = co[type]?.[cat] || null;
            const item = itemId ? swFindItem(itemId) : null;
            if (item) {
                const src = swGetOutfitSrc(item);
                slotsHtml += `<div class="sw-current-slot">
                    <img src="${src}" class="sw-current-slot-img" alt="${esc(item.name)}" title="${esc(item.name)}">
                    <span class="sw-current-slot-label">${esc(CATEGORIES[cat])}</span>
                </div>`;
            } else {
                slotsHtml += `<div class="sw-current-slot">
                    <div class="sw-current-slot-empty">${esc(CATEGORIES[cat]?.[0] || '?')}</div>
                    <span class="sw-current-slot-label">${esc(CATEGORIES[cat])}</span>
                </div>`;
            }
        }

        const descText = swBuildDescription(type, cn);
        wrap.innerHTML = `
            <div class="sw-current-title">Сейчас надето (${type === 'bot' ? esc(cn) : '{{user}}'})</div>
            <div class="sw-current-slots">${slotsHtml}</div>
            ${descText ? `<div class="sw-current-desc">${esc(descText)}</div>` : ''}`;
    }

    // ── Build combined description from all active slots ──
    function swBuildDescription(type, cn) {
        const co = swGetCharOutfit();
        if (!co) return '';
        const mode = swGetModeFor(type);
        const slots = mode === 'full' ? ['full', 'accessories', 'hair'] : ['top', 'bottom', 'shoes', 'accessories', 'hair'];
        const SLOT_LABELS = { full: 'FULL', top: 'TOP', bottom: 'BOTTOM', shoes: 'SHOES', accessories: 'ACCESSORIES', hair: 'HAIR' };
        const parts = [];
        for (const cat of slots) {
            const itemId = co[type]?.[cat] || null;
            const item = itemId ? swFindItem(itemId) : null;
            if (item?.description) {
                if (item.description.trim()) parts.push(`${SLOT_LABELS[cat]}: ${item.description.trim()}`);
            }
        }
        return parts.join(' ');
    }

    // Description choice — inline in #sw-tab-content
    function swShowDescriptionModal(outfitName) {
        return new Promise((resolve) => {
            const el = swShowInline(`
                <div style="padding:10px;">
                    <div style="font-size:14px;font-weight:600;color:#f472b6;margin-bottom:6px;">💅 Описание отсутствует</div>
                    <div style="font-size:12px;color:#999;margin-bottom:14px;">«${esc(outfitName)}» — для наилучшего результата добавьте описание</div>
                    <div style="display:flex;flex-direction:column;gap:8px;">
                        <button class="sw-inline-btn" data-choice="skip" style="padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:#ddd;cursor:pointer;text-align:left;font-size:13px;"><b>Без описания</b><br><span style="font-size:11px;opacity:0.6;">Надеть как есть</span></button>
                        <button class="sw-inline-btn" data-choice="manual" style="padding:12px;border-radius:8px;border:1px solid rgba(244,114,182,0.25);background:rgba(244,114,182,0.08);color:#ddd;cursor:pointer;text-align:left;font-size:13px;"><b style="color:#f472b6;">✏️ Ввести вручную</b><br><span style="font-size:11px;opacity:0.6;">Описать аутфит своими словами</span></button>
                        <button class="sw-inline-btn" data-choice="ai" style="padding:12px;border-radius:8px;border:1px solid rgba(244,114,182,0.25);background:rgba(244,114,182,0.08);color:#ddd;cursor:pointer;text-align:left;font-size:13px;"><b style="color:#f472b6;">🤖 Сгенерировать ИИ</b><br><span style="font-size:11px;opacity:0.6;">Отправить картинку на анализ</span></button>
                    </div>
                </div>`);
            if (!el) { resolve(null); return; }
            for (const btn of el.querySelectorAll('.sw-inline-btn')) {
                btn.addEventListener('click', () => { swRestoreInline(); resolve(btn.dataset.choice); });
            }
        });
    }

    // ── Upload modal (custom, replaces browser prompts) ──
    // Render sub-forms inside #sw-tab-content, replacing the grid temporarily
    let _savedContent = null;
    function swShowInline(html) {
        const el = document.getElementById('sw-tab-content');
        if (!el) return null;
        _savedContent = el.innerHTML;
        el.innerHTML = html;
        // Hide current outfit preview and filters while sub-form is open
        const cur = document.getElementById('sw-current-outfit'); if (cur) cur.style.display = 'none';
        return el;
    }
    function swRestoreInline() {
        const el = document.getElementById('sw-tab-content');
        if (el && _savedContent !== null) { el.innerHTML = _savedContent; _savedContent = null; }
        const cur = document.getElementById('sw-current-outfit'); if (cur) cur.style.display = '';
        swRender(); // re-render to rebind events
    }

    // ── Outfit card export/import (SillyTavern-card style: PNG + tEXt chunk) ──
    // A shared outfit is a regular PNG of the clothing image with a tEXt chunk
    // keyed SW_PNG_CHUNK_KEY holding base64(UTF-8 JSON):
    //   { spec:'slay_wardrobe_item', spec_version:'1.0',
    //     item:{ name, description, category, forWho, gender, tags } }
    // Local-only fields (id, addedAt, favourite, lastWorn*, hidden) are NOT
    // exported; import mints a fresh id. The file opens as a normal image
    // anywhere — the metadata rides along invisibly, like ST character cards.
    const SW_PNG_CHUNK_KEY = 'slaywardrobe';
    const SW_CARD_SPEC = 'slay_wardrobe_item';
    const SW_PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

    const swCrcTable = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c >>> 0;
        }
        return t;
    })();
    function swCrc32(bytes, start = 0, end = bytes.length) {
        let c = 0xFFFFFFFF;
        for (let i = start; i < end; i++) c = swCrcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }
    function swB64EncodeUnicode(str) {
        const bytes = new TextEncoder().encode(str);
        let bin = '';
        const CHUNK = 0x8000; // avoid call-stack overflow on large arrays
        for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        return btoa(bin);
    }
    function swB64DecodeUnicode(b64) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder().decode(bytes);
    }
    function swIsPng(bytes) {
        if (!bytes || bytes.length < 8) return false;
        for (let i = 0; i < 8; i++) if (bytes[i] !== SW_PNG_SIG[i]) return false;
        return true;
    }
    // Walk PNG chunks; cb(type, dataStart, dataLen, chunkStart, chunkEnd) — return true to stop.
    function swPngWalkChunks(bytes, cb) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let off = 8;
        while (off + 8 <= bytes.length) {
            const len = dv.getUint32(off);
            const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
            const chunkEnd = off + 12 + len;
            if (chunkEnd > bytes.length) break; // malformed
            if (cb(type, off + 8, len, off, chunkEnd)) return;
            off = chunkEnd;
        }
    }
    // Read tEXt chunk value for our keyword; null if absent or not a PNG.
    function swPngReadText(bytes, keyword) {
        if (!swIsPng(bytes)) return null;
        let found = null;
        swPngWalkChunks(bytes, (type, dStart, dLen) => {
            if (type !== 'tEXt') return false;
            let kEnd = dStart;
            const dEnd = dStart + dLen;
            while (kEnd < dEnd && bytes[kEnd] !== 0) kEnd++;
            const kw = String.fromCharCode(...bytes.subarray(dStart, kEnd));
            if (kw !== keyword) return false;
            let text = '';
            for (let i = kEnd + 1; i < dEnd; i++) text += String.fromCharCode(bytes[i]);
            found = text;
            return true;
        });
        return found;
    }
    // Insert a tEXt chunk (keyword + latin1 text) right before IEND; strips any
    // pre-existing chunk with the same keyword first.
    function swPngInsertText(bytes, keyword, text) {
        if (!swIsPng(bytes)) throw new Error('not a PNG');
        // locate & drop existing same-keyword tEXt + find IEND start
        const dropRanges = [];
        let iendStart = -1;
        swPngWalkChunks(bytes, (type, dStart, dLen, cStart, cEnd) => {
            if (type === 'tEXt') {
                let kEnd = dStart;
                const dEnd = dStart + dLen;
                while (kEnd < dEnd && bytes[kEnd] !== 0) kEnd++;
                const kw = String.fromCharCode(...bytes.subarray(dStart, kEnd));
                if (kw === keyword) dropRanges.push([cStart, cEnd]);
            }
            if (type === 'IEND') { iendStart = cStart; return true; }
            return false;
        });
        if (iendStart < 0) throw new Error('PNG has no IEND');
        // build new tEXt chunk bytes
        const kwBytes = new TextEncoder().encode(keyword);
        const txtBytes = new Uint8Array(text.length);
        for (let i = 0; i < text.length; i++) txtBytes[i] = text.charCodeAt(i) & 0xFF;
        const data = new Uint8Array(kwBytes.length + 1 + txtBytes.length);
        data.set(kwBytes, 0); data[kwBytes.length] = 0; data.set(txtBytes, kwBytes.length + 1);
        const chunk = new Uint8Array(12 + data.length);
        const cdv = new DataView(chunk.buffer);
        cdv.setUint32(0, data.length);
        chunk[4] = 0x74; chunk[5] = 0x45; chunk[6] = 0x58; chunk[7] = 0x74; // 'tEXt'
        chunk.set(data, 8);
        cdv.setUint32(8 + data.length, swCrc32(chunk, 4, 8 + data.length));
        // reassemble: original minus dropRanges, with new chunk spliced before IEND
        const parts = [];
        let cursor = 0;
        const boundaries = [...dropRanges, [iendStart, iendStart]].sort((a, b) => a[0] - b[0]);
        for (const [s, e] of boundaries) {
            if (s > cursor) parts.push(bytes.subarray(cursor, s));
            if (s === iendStart && e === iendStart) parts.push(chunk); // splice point
            cursor = Math.max(cursor, e);
        }
        parts.push(bytes.subarray(cursor));
        const total = parts.reduce((n, p) => n + p.length, 0);
        const out = new Uint8Array(total);
        let o = 0;
        for (const p of parts) { out.set(p, o); o += p.length; }
        return out;
    }

    // Export an item as a shareable PNG card (image + embedded metadata).
    async function swExportItem(id) {
        const o = swFindItem(id);
        if (!o) { toastr.error('Предмет не найден', 'Гардероб'); return; }
        try {
            toastr.info('Собираю карточку...', 'Гардероб', { timeOut: 4000 });
            // Load the current image (path preferred, inline base64 fallback)
            const src = swGetOutfitSrc(o);
            if (!src) throw new Error('у предмета нет картинки');
            // Re-encode through canvas: unifies jpeg/webp/png sources into PNG
            // (tEXt chunks only exist in PNG). Same-origin, so no canvas taint.
            const img = await new Promise((res, rej) => {
                const im = new Image();
                im.onload = () => res(im);
                im.onerror = () => rej(new Error('картинка не загрузилась (файл удалён?)'));
                im.src = src;
            });
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
            canvas.getContext('2d').drawImage(img, 0, 0);
            const blob = await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png'));
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const payload = {
                spec: SW_CARD_SPEC,
                spec_version: '1.0',
                item: {
                    name: o.name || '',
                    description: o.description || '',
                    category: o.category || 'full',
                    forWho: o.forWho || 'all',
                    gender: o.gender || 'unisex',
                    tags: Array.isArray(o.tags) ? o.tags : [],
                },
            };
            const withChunk = swPngInsertText(bytes, SW_PNG_CHUNK_KEY, swB64EncodeUnicode(JSON.stringify(payload)));
            const outBlob = new Blob([withChunk], { type: 'image/png' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(outBlob);
            const safe = String(o.name || 'outfit').replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '_') || 'outfit';
            a.download = `slay_outfit_${safe}.png`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
            toastr.success(`Карточка «${o.name}» экспортирована`, 'Гардероб', { timeOut: 2500 });
        } catch (e) { toastr.error('Экспорт не удался: ' + (e?.message || e), 'Гардероб'); }
    }

    // Try to read outfit-card metadata from a picked file. Returns item-shaped
    // object or null (not a PNG / no chunk / wrong spec / parse error).
    function swParseOutfitCard(bytes, fileName = '') {
        try {
            // Distinguish the two "no card" cases in the log: mobile galleries and
            // messengers re-encode images (PNG→JPEG or fresh PNG), stripping tEXt.
            if (!swIsPng(bytes)) { swLog('INFO', `outfit card: "${fileName}" is not a PNG — likely re-encoded by gallery/messenger`); return null; }
            const raw = swPngReadText(bytes, SW_PNG_CHUNK_KEY);
            if (!raw) { swLog('INFO', `outfit card: "${fileName}" is a PNG without embedded outfit data`); return null; }
            const payload = JSON.parse(swB64DecodeUnicode(raw));
            if (payload?.spec !== SW_CARD_SPEC || !payload.item) return null;
            const it = payload.item;
            return {
                name: String(it.name || '').slice(0, 100),
                description: String(it.description || '').slice(0, 2000),
                category: CAT_KEYS.includes(it.category) ? it.category : 'full',
                forWho: ['all', 'bot', 'user'].includes(it.forWho) ? it.forWho : 'all',
                gender: GENDER_KEYS.includes(it.gender) ? it.gender : 'unisex',
                tags: Array.isArray(it.tags) ? it.tags.filter(t => TAG_KEYS.includes(t)) : [],
            };
        } catch (e) { swLog('WARN', 'swParseOutfitCard failed:', e?.message); return null; }
    }

    function swShowUploadModal(defaultName, defaults = null) {
        return new Promise((resolve) => {
            // defaults (from an imported outfit card) win over the generic
            // fallbacks: name, category, forWho, gender, tags come pre-filled.
            const selCat = defaults?.category || swCatTab;
            const selForWho = defaults?.forWho || (swTab === 'bot' ? 'bot' : (swTab === 'user' ? 'user' : 'all'));
            const selGender = defaults?.gender || 'unisex';
            const selTags = new Set(defaults?.tags || []);
            const nameVal = defaults?.name || defaultName;
            let tagsHtml = '';
            for (const tag of TAG_KEYS) { tagsHtml += `<label style="display:inline-flex;align-items:center;gap:3px;font-size:12px;color:#bbb;cursor:pointer;"><input type="checkbox" value="${tag}" ${selTags.has(tag) ? 'checked' : ''} style="accent-color:#db7093;"> ${esc(TAGS[tag])}</label> `; }
            let catOptions = '';
            for (const cat of CAT_KEYS) { catOptions += `<option value="${cat}" ${cat === selCat ? 'selected' : ''}>${esc(CATEGORIES[cat])}</option>`; }

            const el = swShowInline(`
                <div style="padding:10px;">
                    <h3 style="margin:0 0 12px;font-size:15px;color:#f472b6;">${defaults ? '🧥 Импорт костюма' : '👗 Новый предмет'}</h3>
                    ${defaults ? '<div style="font-size:11px;color:#9c8;margin:0 0 8px;">В картинке найдены данные костюма — поля заполнены автоматически.</div>' : ''}
                    <label style="display:block;font-size:12px;color:#aaa;margin:8px 0 4px;">Название</label>
                    <input type="text" id="sw-upl-name" value="${esc(nameVal)}" placeholder="Название" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.2);color:#eee;font-size:13px;box-sizing:border-box;">
                    <label style="display:block;font-size:12px;color:#aaa;margin:8px 0 4px;">Категория</label>
                    <select id="sw-upl-cat" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.2);color:#eee;font-size:13px;box-sizing:border-box;">${catOptions}</select>
                    <label style="display:block;font-size:12px;color:#aaa;margin:8px 0 4px;">Для кого</label>
                    <select id="sw-upl-forwho" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.2);color:#eee;font-size:13px;box-sizing:border-box;"><option value="all" ${selForWho === 'all' ? 'selected' : ''}>Все</option><option value="bot" ${selForWho === 'bot' ? 'selected' : ''}>Бот</option><option value="user" ${selForWho === 'user' ? 'selected' : ''}>Юзер</option></select>
                    <label style="display:block;font-size:12px;color:#aaa;margin:8px 0 4px;">Пол</label>
                    <select id="sw-upl-gender" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.2);color:#eee;font-size:13px;box-sizing:border-box;"><option value="unisex" ${selGender === 'unisex' ? 'selected' : ''}>⚥ Унисекс</option><option value="female" ${selGender === 'female' ? 'selected' : ''}>♀️ Женское</option><option value="male" ${selGender === 'male' ? 'selected' : ''}>♂️ Мужское</option></select>
                    <label style="display:block;font-size:12px;color:#aaa;margin:8px 0 4px;">Теги</label>
                    <div id="sw-upl-tags" style="display:flex;flex-wrap:wrap;gap:6px;">${tagsHtml}</div>
                    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end;">
                        <button id="sw-upl-cancel" style="padding:8px 18px;border-radius:10px;border:none;cursor:pointer;font-size:13px;background:rgba(255,255,255,0.08);color:#aaa;">Отмена</button>
                        <button id="sw-upl-save" style="padding:8px 18px;border-radius:10px;border:none;cursor:pointer;font-size:13px;background:rgba(219,112,147,0.3);color:#f0a0c0;">Сохранить</button>
                    </div>
                </div>`);
            if (!el) { resolve(null); return; }

            const close = (val) => { swRestoreInline(); resolve(val); };
            el.querySelector('#sw-upl-cancel').addEventListener('click', () => close(null));
            el.querySelector('#sw-upl-save').addEventListener('click', () => {
                const name = el.querySelector('#sw-upl-name').value.trim();
                if (!name) { toastr.warning('Введите название', 'Гардероб'); return; }
                const category = el.querySelector('#sw-upl-cat').value;
                const forWho = el.querySelector('#sw-upl-forwho').value;
                const gender = el.querySelector('#sw-upl-gender').value;
                const tags = [...el.querySelectorAll('#sw-upl-tags input:checked')].map(c => c.value);
                close({ name, category, forWho, gender, tags });
            });
            setTimeout(() => el.querySelector('#sw-upl-name')?.focus(), 50);
        });
    }

    // ── Description input modal (replaces browser prompt()) ──
    function swShowDescInput(title, value) {
        return new Promise((resolve) => {
            const el = swShowInline(`
                <div style="padding:10px;">
                    <div style="font-size:14px;font-weight:600;color:#f472b6;margin-bottom:12px;">${esc(title)}</div>
                    <textarea id="sw-descinput-text" style="width:100%;min-height:100px;max-height:200px;padding:10px;border-radius:8px;border:1px solid rgba(244,114,182,0.2);background:rgba(0,0,0,0.3);color:#eee;font-size:13px;line-height:1.5;resize:vertical;box-sizing:border-box;font-family:inherit;">${esc(value || '')}</textarea>
                    <div style="font-size:11px;color:#888;margin-top:4px;" id="sw-descinput-count">${(value || '').length} символов</div>
                    <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;">
                        <button id="sw-descinput-cancel" style="padding:8px 18px;border-radius:10px;border:none;cursor:pointer;font-size:13px;background:rgba(255,255,255,0.08);color:#aaa;">Отмена</button>
                        <button id="sw-descinput-save" style="padding:8px 18px;border-radius:10px;border:none;cursor:pointer;font-size:13px;background:rgba(244,114,182,0.25);color:#f472b6;font-weight:500;">Сохранить</button>
                    </div>
                </div>`);
            if (!el) { resolve(null); return; }
            const textarea = el.querySelector('#sw-descinput-text');
            const counter = el.querySelector('#sw-descinput-count');
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
            textarea.addEventListener('input', () => { counter.textContent = `${textarea.value.length} символов`; });
            const close = (val) => { swRestoreInline(); resolve(val); };
            el.querySelector('#sw-descinput-cancel').addEventListener('click', () => close(null));
            el.querySelector('#sw-descinput-save').addEventListener('click', () => close(textarea.value.trim()));
        });
    }

    // ── Edit modal (custom, replaces browser prompts) ──
    function swShowEditModal(item) {
        return new Promise((resolve) => {
            let tagsHtml = '';
            for (const tag of TAG_KEYS) {
                const checked = Array.isArray(item.tags) && item.tags.includes(tag) ? 'checked' : '';
                tagsHtml += `<label style="display:inline-flex;align-items:center;gap:3px;font-size:12px;color:#bbb;cursor:pointer;"><input type="checkbox" value="${tag}" ${checked} style="accent-color:#db7093;"> ${esc(TAGS[tag])}</label> `;
            }
            let catOptions = '';
            for (const cat of CAT_KEYS) { catOptions += `<option value="${cat}" ${item.category === cat ? 'selected' : ''}>${esc(CATEGORIES[cat])}</option>`; }

            const el = swShowInline(`
                <div style="padding:10px;">
                    <h3 style="margin:0 0 12px;font-size:15px;color:#f472b6;">✏️ Редактировать</h3>
                    <div style="display:flex;gap:12px;margin:0 0 6px;align-items:center;">
                        <img id="sw-edit-thumb" src="${esc(swGetOutfitSrc(item) || '')}" alt="" style="width:64px;height:84px;object-fit:cover;object-position:center top;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.2);flex-shrink:0;">
                        <div style="display:flex;flex-direction:column;gap:6px;min-width:0;">
                            <button id="sw-edit-replace" type="button" style="padding:7px 12px;border-radius:8px;border:1px solid rgba(244,114,182,0.3);cursor:pointer;font-size:12px;background:rgba(244,114,182,0.12);color:#f0a0c0;display:inline-flex;align-items:center;gap:6px;"><i class="fa-solid fa-image"></i> Заменить картинку</button>
                            <span style="font-size:11px;color:#888;">описание и данные останутся</span>
                            <button id="sw-edit-export" type="button" style="padding:7px 12px;border-radius:8px;border:1px solid rgba(147,197,219,0.3);cursor:pointer;font-size:12px;background:rgba(147,197,219,0.1);color:#a0d0f0;display:inline-flex;align-items:center;gap:6px;"><i class="fa-solid fa-file-export"></i> Экспорт PNG</button>
                            <span style="font-size:11px;color:#888;">картинка + данные в одном файле — можно делиться</span>
                        </div>
                    </div>
                    <input type="file" id="sw-edit-file" accept="image/*" style="display:none;">
                    <label style="display:block;font-size:12px;color:#aaa;margin:8px 0 4px;">Название</label>
                    <input type="text" id="sw-edit-name" value="${esc(item.name)}" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.2);color:#eee;font-size:13px;box-sizing:border-box;">
                    <label style="display:block;font-size:12px;color:#aaa;margin:8px 0 4px;">Описание</label>
                    <textarea id="sw-edit-desc" style="width:100%;min-height:60px;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.2);color:#eee;font-size:13px;box-sizing:border-box;resize:vertical;">${esc(item.description || '')}</textarea>
                    <label style="display:block;font-size:12px;color:#aaa;margin:8px 0 4px;">Категория</label>
                    <select id="sw-edit-cat" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.2);color:#eee;font-size:13px;box-sizing:border-box;">${catOptions}</select>
                    <label style="display:block;font-size:12px;color:#aaa;margin:8px 0 4px;">Для кого</label>
                    <select id="sw-edit-forwho" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.2);color:#eee;font-size:13px;box-sizing:border-box;"><option value="all" ${(item.forWho || 'all') === 'all' ? 'selected' : ''}>Все</option><option value="bot" ${item.forWho === 'bot' ? 'selected' : ''}>Бот</option><option value="user" ${item.forWho === 'user' ? 'selected' : ''}>Юзер</option></select>
                    <label style="display:block;font-size:12px;color:#aaa;margin:8px 0 4px;">Пол</label>
                    <select id="sw-edit-gender" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.2);color:#eee;font-size:13px;box-sizing:border-box;"><option value="unisex" ${(item.gender || 'unisex') === 'unisex' ? 'selected' : ''}>⚥ Унисекс</option><option value="female" ${item.gender === 'female' ? 'selected' : ''}>♀️ Женское</option><option value="male" ${item.gender === 'male' ? 'selected' : ''}>♂️ Мужское</option></select>
                    <label style="display:block;font-size:12px;color:#aaa;margin:8px 0 4px;">Теги</label>
                    <div id="sw-edit-tags" style="display:flex;flex-wrap:wrap;gap:6px;">${tagsHtml}</div>
                    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end;">
                        <button id="sw-edit-cancel" style="padding:8px 18px;border-radius:10px;border:none;cursor:pointer;font-size:13px;background:rgba(255,255,255,0.08);color:#aaa;">Отмена</button>
                        <button id="sw-edit-save" style="padding:8px 18px;border-radius:10px;border:none;cursor:pointer;font-size:13px;background:rgba(219,112,147,0.3);color:#f0a0c0;">Сохранить</button>
                    </div>
                </div>`);
            if (!el) { resolve(null); return; }
            const close = (val) => { swRestoreInline(); resolve(val); };
            el.querySelector('#sw-edit-cancel').addEventListener('click', () => close(null));
            // ── Replace image: keep ALL metadata (name/desc/category/forWho/gender/tags),
            // swap only the picture. Mutates the live item + saves immediately (independent
            // of Save/Cancel of the text fields). Don't call swRender here — it would rebuild
            // #sw-tab-content and destroy this inline panel; the grid refreshes on close via
            // swRestoreInline→swRender.
            const replaceFile = el.querySelector('#sw-edit-file');
            el.querySelector('#sw-edit-replace')?.addEventListener('click', () => replaceFile?.click());
            el.querySelector('#sw-edit-export')?.addEventListener('click', () => swExportItem(item.id));
            replaceFile?.addEventListener('change', async () => {
                const f = replaceFile.files?.[0];
                if (!f) return;
                try {
                    toastr.info('Загрузка картинки...', 'Гардероб', { timeOut: 8000 });
                    const { base64 } = await swResize(f, swGetSettings().maxDimension);
                    const path = await swSaveImageToFile(base64, `wardrobe_${item.name}`);
                    item.imagePath = path;
                    item.base64 = '';
                    swSave();
                    swUpdatePromptInjection();
                    const thumb = el.querySelector('#sw-edit-thumb');
                    if (thumb) thumb.src = path + '?t=' + Date.now();
                    toastr.success('Картинка заменена', 'Гардероб', { timeOut: 2000 });
                } catch (e) { toastr.error('Ошибка: ' + (e?.message || e), 'Гардероб'); }
                finally { replaceFile.value = ''; }
            });
            el.querySelector('#sw-edit-save').addEventListener('click', () => {
                const name = el.querySelector('#sw-edit-name').value.trim();
                if (!name) { toastr.warning('Введите название', 'Гардероб'); return; }
                const description = el.querySelector('#sw-edit-desc').value.trim();
                const category = el.querySelector('#sw-edit-cat').value;
                const forWho = el.querySelector('#sw-edit-forwho').value;
                const gender = el.querySelector('#sw-edit-gender').value;
                const tags = [...el.querySelectorAll('#sw-edit-tags input:checked')].map(c => c.value);
                close({ name, description, category, forWho, gender, tags });
            });
            // was m.querySelector — `m` doesn't exist in this scope (it lives in
            // swOpenModal). This was THE long-standing "Uncaught ReferenceError:
            // m is not defined" console error fired 50ms after opening item edit.
            setTimeout(() => el.querySelector('#sw-edit-name')?.focus(), 50);
        });
    }

    async function swToggle(id) {
        const co = swGetCharOutfit();
        if (!co) return;
        const cn = swCharName();
        const o = swFindItem(id);
        if (!o) return;
        const nm = o.name || id;
        const cat = o.category || 'full';
        const mode = swGetMode();

        // Check category+mode compatibility
        if (swIsCatBlocked(mode, cat)) {
            toastr.warning(`Категория "${CATEGORIES[cat]}" недоступна в режиме "${mode === 'full' ? 'Полный комплект' : 'По частям'}"`, 'Гардероб');
            return;
        }

        const currentId = co[swTab]?.[cat] || null;
        const off = currentId === id;

        // If putting ON and no description — show custom modal (unless user opted out)
        if (!off && o && !o.description?.trim() && !swGetSettings().skipDescriptionWarning) {
            const choice = await swShowDescriptionModal(nm);

            if (choice === null) return;

            if (choice === 'manual') {
                const desc = await swShowDescInput('✏️ Описание аутфита', '');
                if (desc) { o.description = desc; swSave(); swRender(); }
                if (!o.description?.trim()) return;
            } else if (choice === 'ai') {
                const imgBase64 = o.imagePath ? await swLoadImageAsBase64(o.imagePath) : o.base64;
                if (imgBase64) {
                    const autoDesc = await swAnalyzeOutfit(imgBase64, cat);
                    if (autoDesc) {
                        const edited = await swShowDescInput('🤖 Описание (можете отредактировать)', autoDesc);
                        if (edited) { o.description = edited; swSave(); swRender(); }
                    } else {
                        toastr.warning('Не удалось сгенерировать. Попробуйте вручную.', 'Гардероб');
                        return;
                    }
                }
                if (!o.description?.trim()) return;
            }
            // 'skip' — proceed without description
        }

        if (off) {
            // Un-equip
            swSetSlot(swTab, cat, null);
        } else {
            // Equip — handle mode rules
            if (mode === 'full' && cat === 'full') {
                // Clear top/bottom/shoes (shouldn't have them, but just in case)
                co[swTab].top = null;
                co[swTab].bottom = null;
                co[swTab].shoes = null;
            }
            swSetSlot(swTab, cat, id);
        }

        swRender();
        swUpdatePromptInjection();
        swInjectFloatingBtn();
        off ? toastr.info(`\u00AB${nm}\u00BB снят`, 'Гардероб', { timeOut: 2000 }) : toastr.success(`\u00AB${nm}\u00BB надет`, 'Гардероб', { timeOut: 2000 });
    }

    const DESCRIBE_PROMPTS = {
        detailed: 'Reply IMMEDIATELY with a clothing description. Skip any thinking, reasoning, or preamble. Start directly with the garment name. Max 3 sentences, max 500 characters. Include: garment names, fabric, texture, fit, colors. Avoid mentioning what is absent or missing. English only.',
        simple: 'Reply IMMEDIATELY with a brief clothing description. Skip any thinking or preamble. Max 2 sentences, max 300 characters. List garments, colors. Avoid mentioning what is absent or missing. English only.',
        hair: 'Reply IMMEDIATELY with a short hairstyle description. Skip any thinking or preamble. Max 15 words. Format: "[style], [length], [texture]". Avoid mentioning hair color. Avoid mentioning what is absent or missing. Keep to one sentence only.',
    };

    async function swAnalyzeOutfit(base64, category) {
        const swS = swGetSettings();
        const mode = swS.describeMode || 'direct';
        const promptStyle = (category === 'hair') ? 'hair' : (swS.describePromptStyle || 'detailed');
        const describePrompt = DESCRIBE_PROMPTS[promptStyle] || DESCRIBE_PROMPTS.detailed;
        const maxDescLen = (category === 'hair') ? 450 : (promptStyle === 'simple' ? 800 : 1200);
		const maxTokens = (category === 'hair') ? 150 : 600;
        swLog('INFO', `swAnalyzeOutfit: mode=${mode}, promptStyle=${promptStyle}, maxLen=${maxDescLen}`);
        toastr.info('Анализ образа...', 'Гардероб', { timeOut: 15000 });

        // ── Direct API mode (recommended) ──
        if (mode === 'direct') {
            const iigSettings = SillyTavern.getContext().extensionSettings[MODULE_NAME] || {};
            const endpoint = normalizeApiEndpoint(swS.describeEndpoint || iigSettings.endpoint || '');
            const apiKey = swS.describeKey || iigSettings.apiKey || '';
            const modelSelect = document.getElementById('slay_sw_describe_model');
            const model = modelSelect?.value || swS.describeModel || iigSettings.model || 'gemini-2.5-flash';
            if (!endpoint || !apiKey) {
                toastr.warning('Настройте API для описания в секции Гардероб', 'Гардероб', { timeOut: 5000 });
                return null;
            }
            // Determine API format: user choice > auto-detect by model name
            const apiFormat = swS.describeApiFormat || 'auto';
            let useGeminiFormat;
            if (apiFormat === 'gemini') useGeminiFormat = true;
            else if (apiFormat === 'openai') useGeminiFormat = false;
            else useGeminiFormat = model.toLowerCase().includes('gemini') || model.toLowerCase().includes('nano-banana');
            swLog('INFO', `Describe API format: ${apiFormat} -> ${useGeminiFormat ? 'gemini' : 'openai'}, model=${model}`);

            try {
                let desc = null;

                // Retry on transient failures (429 rate-limit, 5xx) up to 2 times
                // with short backoff. First upload of the session often hits 429
                // on a "warm" Gemini key because previous chat completions bumped
                // the shared per-minute quota.
                const callApi = async () => {
                    if (useGeminiFormat) {
                        const url = `${endpoint}/v1beta/models/${model}:generateContent`;
                        const body = {
                            contents: [{
                                role: 'user', parts: [
                                    { inlineData: { mimeType: 'image/png', data: base64 } },
                                    { text: describePrompt }
                                ]
                            }],
                            generationConfig: { responseModalities: ['TEXT'], maxOutputTokens: maxTokens }
                        };
                        const response = await fetch(url, { method: 'POST', headers: buildAuthHeaders(apiKey, { 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
                        if (!response.ok) { const err = new Error(`API ${response.status}`); err.status = response.status; throw err; }
                        const result = await response.json();
                        return result.candidates?.[0]?.content?.parts?.find(p => p.text)?.text?.trim() || '';
                    } else {
                        const url = `${endpoint}/v1/chat/completions`;
                        const body = {
                            model, max_tokens: maxTokens,
                            messages: [
                                { role: 'system', content: describePrompt },
                                {
                                    role: 'user', content: [
                                        { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
                                        { type: 'text', text: 'Describe the clothing in this image.' }
                                    ]
                                }
                            ]
                        };
                        const response = await fetch(url, { method: 'POST', headers: buildAuthHeaders(apiKey, { 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
                        if (!response.ok) { const err = new Error(`API ${response.status}`); err.status = response.status; throw err; }
                        const result = await response.json();
                        return result.choices?.[0]?.message?.content?.trim() || '';
                    }
                };

                const MAX_RETRIES = 2;
                for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                    try { desc = await callApi(); break; }
                    catch (err) {
                        const status = err.status || 0;
                        const retryable = status === 429 || (status >= 500 && status < 600);
                        if (!retryable || attempt === MAX_RETRIES) throw err;
                        const delay = 800 * Math.pow(2, attempt); // 800ms, 1600ms
                        swLog('WARN', `Describe API ${status}, retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
                        await new Promise(r => setTimeout(r, delay));
                    }
                }

                if (desc) {
                    // Strip thinking/reasoning preamble if model outputs it
                    // Strip thinking/reasoning: find where actual description starts
                    desc = desc.replace(/^\*\*.*?\*\*\s*/s, '');
                    if (/^(My Thought|Okay|Let me|I need to|First|Here's|Here is|Alright|So,|Right|Looking|I'm seeing|The prompt|Let's|I see)/i.test(desc)) {
                        const parts = desc.split(/\n\n/);
                        if (parts.length > 1) { desc = parts[parts.length - 1]; }
                        else {
                            const clothingMatch = desc.match(/(?:^|[.!]\s+)((?:A |An |The |Fitted |Loose |Soft |Thick |Thin |Dark |Light |Black |White |Red |Blue |Pink |Green |Long |Short |High |Low |Cropped |Oversized |Slim |Wide |Strapless |Off-shoulder |V-neck )[A-Z]?[a-z].*)/i);
                            if (clothingMatch) desc = clothingMatch[1];
                        }
                    }
                    desc = desc.replace(/^["'`]+|["'`]+$/g, '').replace(/^(Here|This|The image|I see|In this).{0,20}(shows?|features?|depicts?|displays?)\s*/i, '');
                }
                // Truncate to maxDescLen if model ignores token limits
                if (desc && desc.length > maxDescLen) {
                    const lastDot = desc.lastIndexOf('.', maxDescLen);
                    desc = lastDot > 50 ? desc.substring(0, lastDot + 1) : desc.substring(0, maxDescLen);
                    swLog('INFO', `Description truncated to ${desc.length} chars`);
                }
                if (desc && desc.length > 10) {
                    swLog('INFO', `Direct API described (${model}):`, desc.substring(0, 100)); return desc;
                }
                swLog('WARN', `Direct API: unusable result (len=${desc?.length || 0})`);
            } catch (e) { swLog('WARN', `Direct API failed (${model}):`, e.message); toastr.warning(`Ошибка: ${e.message}`, 'Гардероб', { timeOut: 5000 }); }
            return null;
        }

        // ── Chat API mode ──
        const ctx = SillyTavern.getContext();

        if (typeof ctx.generateRaw === 'function') {
            try {
                const messages = [
                    { role: 'system', content: describePrompt },
                    {
                        role: 'user', content: [
                            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
                            { type: 'text', text: 'Describe the clothing in this image.' },
                        ]
                    },
                ];
                const rawResult = await ctx.generateRaw({ prompt: messages, maxTokens: maxTokens });
                const result = typeof rawResult === 'string' ? rawResult : (rawResult?.text || rawResult?.message || String(rawResult || ''));
                let desc = (result || '').trim().replace(/^["'`]+|["'`]+$/g, '');
                if (desc && desc.length > maxDescLen) { const ld = desc.lastIndexOf('.', maxDescLen); desc = ld > 50 ? desc.substring(0, ld + 1) : desc.substring(0, maxDescLen); }
                if (desc && desc.length > 10) { return desc; }
            } catch (e) { swLog('WARN', 'generateRaw failed:', e.message); }
        }

        if (typeof ctx.generateQuietPrompt === 'function') {
            try {
                const rawResult = await ctx.generateQuietPrompt({ quietPrompt: '[OOC: Describe ONLY the clothing in the attached image. 1-2 sentences, English, no RP.]', quietImage: `data:image/png;base64,${base64}`, maxTokens: maxTokens });
                const result = typeof rawResult === 'string' ? rawResult : (rawResult?.text || rawResult?.message || String(rawResult || ''));
                let desc = (result || '').trim().replace(/^["'`]+|["'`]+$/g, '');
                if (desc && desc.length > maxDescLen) { const ld = desc.lastIndexOf('.', maxDescLen); desc = ld > 50 ? desc.substring(0, ld + 1) : desc.substring(0, maxDescLen); }
                if (desc && desc.length > 10) { return desc; }
            } catch (e) { swLog('WARN', 'generateQuietPrompt failed:', e.message); }
        }

        toastr.warning('Не удалось описать. Введите вручную.', 'Гардероб', { timeOut: 5000 });
        return null;
    }

    async function swUpload(importMode = false) {
        const inp = document.createElement('input'); inp.type = 'file';
        // Import mode: NO accept filter. With accept="image/*" Android opens the
        // photo picker (gallery), which can hand over a re-encoded copy with the
        // tEXt chunk stripped; the plain document picker returns original bytes.
        if (!importMode) inp.accept = 'image/*';
        inp.addEventListener('change', async () => {
            const f = inp.files?.[0]; if (!f) return;
            const defaultName = f.name.replace(/\.[^.]+$/, '');

            // Read the WHOLE file into memory right now, while the picker handle
            // is fresh. On Android a File is a content:// ticket that routinely
            // expires while the user fills the form modal (browser suspended
            // behind the picker, cloud-backed gallery item) — reading it after
            // the modal is what produced the "Ошибка: read" reports.
            let bytes;
            try { bytes = new Uint8Array(await f.arrayBuffer()); }
            catch (e) { toastr.error('Не удалось прочитать файл — выберите его заново', 'Гардероб'); return; }
            const dataUrl = `data:${f.type || 'image/png'};base64,${swBytesToBase64(bytes)}`;

            // Outfit-card import: if the picked PNG carries our tEXt chunk,
            // pre-fill the form and reuse the embedded description (skipping
            // the AI auto-describe — the card already knows what it is).
            const card = swParseOutfitCard(bytes, f.name);
            if (importMode && !card) {
                toastr.error('В этом файле нет данных костюма. Если карточка приехала через галерею или мессенджер как «фото» — метаданные вырезаны. Передавайте PNG как файл/документ и выбирайте через «Файлы», а не из галереи.', '\u{1F9E5} Импорт костюма', { timeOut: 12000 });
                return;
            }

            // Show upload modal (pre-filled when importing a card)
            const result = await swShowUploadModal(defaultName, card);
            if (!result) return;

            try {
                const { base64 } = await swResize(dataUrl, swGetSettings().maxDimension);
                let autoDesc = card?.description?.trim() || null;
                if (autoDesc) {
                    // Never apply an imported description sight-unseen: it ends up
                    // in the bot's prompt, so the user must see (and can defuse)
                    // whatever the card author embedded there.
                    const edited = await swShowDescInput('🧥 Описание из карточки (можете отредактировать)', autoDesc);
                    if (edited !== null) autoDesc = edited;
                } else if (swGetSettings().autoDescribe !== false) {
                    autoDesc = await swAnalyzeOutfit(base64, result.category);
                    if (autoDesc) {
                        const edited = await swShowDescInput('🤖 Описание (можете отредактировать)', autoDesc);
                        if (edited !== null) autoDesc = edited;
                    }
                }
                const imagePath = await swSaveImageToFile(base64, `wardrobe_${result.name}`);
                swAddItem({
                    id: uid(),
                    name: result.name,
                    description: (autoDesc || '').trim(),
                    imagePath,
                    base64: '',
                    category: result.category,
                    forWho: result.forWho || 'all',
                    gender: result.gender || 'unisex',
                    tags: result.tags,
                    addedAt: Date.now(),
                });
                // Switch to the uploaded item's category
                swCatTab = result.category;
                swRender();
                toastr.success(`\u00AB${result.name}\u00BB ${card ? 'импортирован' : 'добавлен'}`, 'Гардероб');
            } catch (e) { toastr.error('Ошибка: ' + e.message, 'Гардероб'); }
        });
        inp.click();
    }

    async function swEdit(id) {
        const o = swFindItem(id); if (!o) return;
        const result = await swShowEditModal(o);
        if (!result) return;
        o.name = result.name || o.name;
        o.description = result.description ?? o.description;
        o.category = result.category || o.category;
        o.forWho = result.forWho || 'all';
        o.gender = result.gender || 'unisex';
        o.tags = result.tags || o.tags;
        swSave();
        swRender();
        swUpdatePromptInjection();
        toastr.info('Обновлён', 'Гардероб');
    }

    async function swRegenDescription(id) {
        const o = swFindItem(id); if (!o) return;
        const imgBase64 = o.imagePath ? await swLoadImageAsBase64(o.imagePath) : o.base64;
        if (!imgBase64) { toastr.error('Картинка не найдена', 'Гардероб'); return; }
        const autoDesc = await swAnalyzeOutfit(imgBase64, o.category);
        if (autoDesc) {
            const edited = await swShowDescInput('🤖 Описание (можете отредактировать)', autoDesc);
            if (edited) {
                o.description = edited; swSave(); swRender(); swUpdatePromptInjection();
                toastr.success('Описание обновлено', 'Гардероб', { timeOut: 2000 });
            }
        }
    }

    // ── Prompt injection ──
    const SW_PROMPT_KEY = 'slaywardrobe_outfit';

    function swUpdatePromptInjection() {
        try {
            const ctx = SillyTavern.getContext();
            if (typeof ctx.setExtensionPrompt !== 'function') { swLog('WARN', 'setExtensionPrompt not available'); return; }
            const cn = swCharName();
            if (!cn) { ctx.setExtensionPrompt(SW_PROMPT_KEY, '', 1, 0); return; }
            const co = swGetCharOutfit();
            if (!co) { ctx.setExtensionPrompt(SW_PROMPT_KEY, '', 1, 0); return; }

            const lines = [];
            for (const type of ['bot', 'user']) {
                const who = type === 'bot' ? cn : '{{user}}';
                const desc = swBuildDescription(type, cn);
                if (desc) {
                    lines.push(`[OUTFIT LOCK \u2014 keep unchanged: ${who} is currently wearing: ${desc}. Always use this exact outfit when writing image prompts for ${who}.]`);
                }
            }

            const injectionText = lines.length > 0 ? lines.join('\n') : '';
            ctx.setExtensionPrompt(SW_PROMPT_KEY, injectionText, 1, 0);
            if (injectionText) { swLog('INFO', `Prompt injection updated (MANDATORY depth=0): ${lines.length} outfit(s)`); }
            else { swLog('INFO', 'Prompt injection cleared (no active outfits)'); }
        } catch (e) { swLog('ERROR', 'Failed to update prompt injection:', e.message); }
    }

    // ── Bar button ──
    // Hover-preview is DESKTOP-ONLY. Mobile browsers synthesize mouseenter
    // from taps (and some withhold the click when hover mutates the DOM), so
    // without this guard a tap on the bar button opened the PC hover popup
    // instead of the wardrobe modal. Checked at event time, not bind time —
    // handles device-mode changes (e.g. DevTools emulation, convertibles).
    const swCanHover = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    let swHoverShowTimer = null;
    let swAutoCloseTimer = null;  // dismiss timer after cursor leaves popup
    const SW_AUTOCLOSE_MS = 5000;

    // Persist last-used Quick-Swap tab across popup open/close + sessions.
    let swPreviewTab = (() => {
        try { return localStorage.getItem('slay_wardrobe_preview_tab') === 'bot' ? 'bot' : 'user'; }
        catch (e) { return 'user'; }
    })();
    function swSetPreviewTab(tab) {
        swPreviewTab = tab;
        try { localStorage.setItem('slay_wardrobe_preview_tab', tab); } catch (e) { }
    }


    function swInjectFloatingBtn() {
        let $btn = $('#sw-bar-btn');
        if ($btn.length === 0) {
            $btn = $('<div id="sw-bar-btn" title="Гардероб"><i class="fa-solid fa-shirt"></i></div>');
            const btnEl = $btn.get(0);

            // Click/tap always opens the full wardrobe. If popup happens to be
            // open (opened earlier via hover) — close it first so it doesn't
            // linger on top of the modal. No toggle-close through the button:
            //   - "navигated to button, wanted wardrobe" must always work in one click
            //   - popup closes via X / outside click / Escape (enough ways)
            btnEl.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                clearTimeout(swHoverShowTimer);
                swClosePreviewPopup();
                swOpenModal();
            });

            // ── Hover: opens popup after 500ms intent debounce. Fast
            // click-intent users never see the popup; deliberate pause triggers.
            btnEl.addEventListener('mouseenter', () => {
                if (!swCanHover()) return;
                clearTimeout(swHoverShowTimer);
                clearTimeout(swAutoCloseTimer);
                swHoverShowTimer = setTimeout(() => swOpenPreviewPopup(btnEl), 500);
            });
            btnEl.addEventListener('mouseleave', () => {
                clearTimeout(swHoverShowTimer);
                // If popup is currently open, restart the auto-close countdown
                // when cursor leaves the bar button. Without this, a user who
                // moved popup→button→away would stall the popup open forever
                // (popup mouseleave already fired before they reached button,
                // then button mouseenter cancelled the timer).
                const pp = document.getElementById('sw-preview-popup');
                if (pp?.classList.contains('sw-pp-open') && !pp.matches(':hover')) {
                    clearTimeout(swAutoCloseTimer);
                    swAutoCloseTimer = setTimeout(swClosePreviewPopup, SW_AUTOCLOSE_MS);
                }
            });

            const $left = $('#leftSendForm');
            if ($left.length) $left.append($btn); else $('body').append($btn);
        }
        const co = swGetCharOutfit();
        // Badge = currently worn parts across bot+user. Respects per-type mode so a
        // full counts as 1 (not 1 + parts), because parts are preserved in storage
        // even after a quick-swap to full.
        const count = co ? swCountWornParts() : 0;
        $btn.toggleClass('sw-bar-active', count > 0);
        if (count > 0) {
            $btn.html(`<i class="fa-solid fa-shirt"></i><span class="sw-bar-count">${count}</span>`);
        } else { $btn.html('<i class="fa-solid fa-shirt"></i>'); }
        $btn.show();
    }
	
	// =========================================================================
    // Style Library — Preview Popup
    // =========================================================================
    const iigCanHover = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const IIG_AUTOCLOSE_MS = 5000;
    let iigStyleHoverShowTimer = null;
    let iigStyleAutoCloseTimer = null;
    let iigStylePopupAnchorRect = null;
    const iigStylePeekTimers = new Set();

    function iigCancelPendingPeekTimers() {
        for (const t of iigStylePeekTimers) clearTimeout(t);
        iigStylePeekTimers.clear();
    }

    function iigStylePreviewPopupEl() {
        let el = document.getElementById('iig-style-preview-popup');
        if (!el) {
            el = document.createElement('div');
            el.id = 'iig-style-preview-popup';
            // Используем классы гардероба, чтобы дизайн был идентичным 1 в 1
            el.className = 'sw-preview-popup';
            document.body.appendChild(el);

            document.addEventListener('click', (e) => {
                if (!el.classList.contains('sw-pp-open')) return;
                if (el.contains(e.target)) return;
                if (e.target.closest('#iig-style-bar-btn')) return;
                iigCloseStylePreviewPopup();
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && el.classList.contains('sw-pp-open')) {
                    iigCloseStylePreviewPopup();
                }
            });

            el.addEventListener('mouseenter', () => clearTimeout(iigStyleAutoCloseTimer));
            el.addEventListener('mouseleave', () => {
                clearTimeout(iigStyleAutoCloseTimer);
                iigStyleAutoCloseTimer = setTimeout(iigCloseStylePreviewPopup, IIG_AUTOCLOSE_MS);
            });

            const stop = e => e.stopPropagation();
            el.addEventListener('touchstart', stop, { passive: true });
            el.addEventListener('touchend', stop, { passive: true });
            el.addEventListener('pointerdown', stop);
            el.addEventListener('pointerup', stop);
            el.addEventListener('mousedown', stop);
        }
        return el;
    }

    function iigRepositionStylePopup() {
        const el = document.getElementById('iig-style-preview-popup');
        if (!el || !el.classList.contains('sw-pp-open') || !iigStylePopupAnchorRect) return;
        const r = iigStylePopupAnchorRect;
        el.style.visibility = 'hidden';
        el.style.left = '0px'; el.style.top = '0px';
        const w = el.offsetWidth; const h = el.offsetHeight;
        const vh = window.innerHeight;
        let left = r.right - w;
        let top = r.top - h - 10;
        if (left < 8) left = 8;
        if (top < 8) top = Math.max(8, vh - h - 10);
        el.style.left = left + 'px'; el.style.top = top + 'px';
        el.style.visibility = '';
    }

    function iigOpenStylePreviewPopup(anchor) {
        const el = iigStylePreviewPopupEl();
        iigRenderStylePreviewPopup();
        iigStylePopupAnchorRect = anchor.getBoundingClientRect();
        el.classList.add('sw-pp-open');
        iigRepositionStylePopup();
    }

    function iigCloseStylePreviewPopup() {
        clearTimeout(iigStyleAutoCloseTimer);
        const el = document.getElementById('iig-style-preview-popup');
        if (el) el.classList.remove('sw-pp-open');
        iigHideStylePeek();
    }

    function iigGroupStylesByTag() {
        const styles = ensureStyles(getSettings());
        const byTag = {};
        styles.forEach(s => {
            const tags = (Array.isArray(s.tags) && s.tags.length > 0) ? s.tags : ['Без тега'];
            tags.forEach(t => {
                if (!byTag[t]) byTag[t] = [];
                byTag[t].push(s);
            });
        });
        for (const t in byTag) {
            byTag[t].sort((a, b) => {
                if (a.isFavorite !== b.isFavorite) return (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0);
                return a.name.localeCompare(b.name);
            });
        }
        return byTag;
    }

    function iigRenderStylePreviewPopup() {
        iigCancelPendingPeekTimers();
        const el = iigStylePreviewPopupEl();
        const activeStyle = getSelectedStyle();
        
        const renderSlot = (item) => {
            if (!item) {
                return `<div class="sw-pp-slot sw-pp-slot-empty">
                    <div class="sw-pp-thumb sw-pp-thumb-empty"><i class="fa-solid fa-palette"></i></div>
                    <div class="sw-pp-slot-label">СТИЛЬ</div>
                    <div class="sw-pp-slot-sub">— не выбран —</div>
                </div>`;
            }
            const src = item.imagePath || '';
            const safeSrcAttr = sanitizeForHtml(src);
            return `<div class="sw-pp-slot" data-src="${safeSrcAttr}">
                <div class="sw-pp-thumb" ${src ? '' : 'class="sw-pp-thumb sw-pp-thumb-empty"'}>${src ? '' : '<i class="fa-solid fa-palette"></i>'}</div>
                <div class="sw-pp-slot-label">АКТИВНЫЙ СТИЛЬ</div>
                <div class="sw-pp-slot-sub" title="${sanitizeForHtml(item.name)}">${sanitizeForHtml(item.name)}</div>
            </div>`;
        };

        const byTag = iigGroupStylesByTag();
        const activeTags = Object.keys(byTag).sort();

        const catButtons = activeTags.map(tk => {
            const items = byTag[tk];
            const multi = items.length > 1 ? ' sw-pp-cat-multi' : '';
            return `<button class="sw-pp-cat-btn${multi}" data-tag="${sanitizeForHtml(tk)}" title="${sanitizeForHtml(tk)} (${items.length})">
                <span class="sw-pp-cat-ico">🔖</span>
                <span class="sw-pp-cat-count" style="font-size: 0.55em; text-transform: uppercase; max-width: 90%; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; color: #ccc;">${sanitizeForHtml(tk)}</span>
                <span class="sw-pp-cat-count" style="position: absolute; top: 2px; right: 4px;">${items.length}</span>
            </button>`;
        }).join('');

        el.innerHTML = `
            <button class="sw-pp-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
            <div class="sw-pp-body">
                <div class="sw-pp-screen sw-pp-screen-main">
                    <div class="sw-pp-section sw-pp-section-preview">
                        <div class="sw-pp-title">Сейчас выбрано</div>
                        <div class="sw-pp-preview-grid" style="grid-template-columns: 1fr; max-width: 180px; margin: 0 auto;">
                            ${renderSlot(activeStyle)}
                        </div>
                    </div>
                    <div class="sw-pp-section sw-pp-section-swap">
                        <div class="sw-pp-title">Быстрая смена</div>
                        <div class="sw-pp-cats">
                            ${catButtons || '<div class="sw-pp-empty-line">Нет стилей</div>'}
                        </div>
                    </div>
                </div>
                <div class="sw-pp-screen sw-pp-screen-sub" hidden>
                    <div class="sw-pp-subgrid-head">
                        <button class="sw-pp-sub-back" title="Назад"><i class="fa-solid fa-arrow-left"></i></button>
                        <span class="sw-pp-subgrid-title"></span>
                    </div>
                    <div class="sw-pp-subgrid-items"></div>
                </div>
            </div>
            <div class="sw-pp-footer">
                <button class="sw-pp-open-full"><i class="fa-solid fa-swatchbook"></i> Открыть библиотеку</button>
            </div>
        `;

        el.querySelector('.sw-pp-close')?.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation(); iigCloseStylePreviewPopup();
        });
        el.querySelector('.sw-pp-open-full')?.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            iigCloseStylePreviewPopup();
            $('#iig_open_style_library').trigger('click');
        });
        el.querySelectorAll('.sw-pp-slot').forEach(slot => {
            slot.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                iigCloseStylePreviewPopup();
                $('#iig_open_style_library').trigger('click');
            });
        });
        el.querySelectorAll('.sw-pp-cat-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                const tk = btn.dataset.tag;
                const items = byTag[tk] || [];
                if (items.length > 0) iigShowStyleSubgrid(tk, items);
            });
        });

        for (const slot of el.querySelectorAll('.sw-pp-slot')) {
            const src = slot.dataset.src;
            const thumb = slot.querySelector('.sw-pp-thumb');
            if (src && thumb && !thumb.classList.contains('sw-pp-thumb-empty')) {
                thumb.style.backgroundImage = `url("${src.replace(/"/g, '\\"')}")`;
            }
        }
    }

    function iigShowStyleSubgrid(tagKey, items) {
        iigCancelPendingPeekTimers();
        const el = iigStylePreviewPopupEl();
        const main = el.querySelector('.sw-pp-screen-main');
        const sub = el.querySelector('.sw-pp-screen-sub');
        const titleEl = el.querySelector('.sw-pp-subgrid-title');
        const grid = el.querySelector('.sw-pp-subgrid-items');
        if (!sub || !grid || !main) return;

        titleEl.textContent = `${tagKey} (${items.length})`;
        grid.innerHTML = items.map(item => {
            const fav = item.isFavorite ? '<span class="sw-pp-sub-fav">★</span>' : '';
            const textFallback = !item.imagePath ? `<div class="sw-pp-sub-name" style="white-space:normal; top:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.5); font-size: 0.75em; padding: 4px; height: 100%; border-radius: 10px;">${sanitizeForHtml(item.name)}</div>` : '';
            return `<div class="sw-pp-sub-item" data-id="${sanitizeForHtml(item.id)}" title="${sanitizeForHtml(item.name)}">${fav}${textFallback}</div>`;
        }).join('');

        const itemById = new Map(items.map(i => [i.id, i]));
        for (const node of grid.querySelectorAll('.sw-pp-sub-item')) {
            const item = itemById.get(node.dataset.id);
            if (!item) continue;
            const src = item.imagePath;
            if (src) node.style.backgroundImage = `url("${src.replace(/"/g, '\\"')}")`;
        }

        main.hidden = true;
        sub.hidden = false;

        const backBtn = el.querySelector('.sw-pp-sub-back');
        if (backBtn && backBtn.dataset.wired !== '1') {
            backBtn.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                sub.hidden = true; main.hidden = false;
            });
            backBtn.dataset.wired = '1';
        }

        grid.querySelectorAll('.sw-pp-sub-item').forEach(node => {
            iigBindStylePeek(node);
            node.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                if (node.dataset.peekSuppress === '1') {
                    delete node.dataset.peekSuppress;
                    return;
                }
                const id = node.dataset.id;
                const item = itemById.get(id);
                if (item) iigApplyQuickStyle(item);
            });
        });
    }

    function iigApplyQuickStyle(item) {
        const settings = getSettings();
        settings.activeStyleId = item.id;
        saveSettings();
        iigHideStylePeek();
        
        const el = document.getElementById('iig-style-preview-popup');
        if (el) {
            const main = el.querySelector('.sw-pp-screen-main');
            const sub = el.querySelector('.sw-pp-screen-sub');
            if (sub) sub.hidden = true;
            if (main) main.hidden = false;
            
            const grid = el.querySelector('.sw-pp-preview-grid');
            if (grid) {
                const src = item.imagePath || '';
                const safeSrcAttr = sanitizeForHtml(src);
                grid.innerHTML = `<div class="sw-pp-slot" data-src="${safeSrcAttr}">
                    <div class="sw-pp-thumb" ${src ? '' : 'class="sw-pp-thumb sw-pp-thumb-empty"'}>${src ? '' : '<i class="fa-solid fa-palette"></i>'}</div>
                    <div class="sw-pp-slot-label">АКТИВНЫЙ СТИЛЬ</div>
                    <div class="sw-pp-slot-sub" title="${sanitizeForHtml(item.name)}">${sanitizeForHtml(item.name)}</div>
                </div>`;
                const slot = grid.querySelector('.sw-pp-slot');
                if (src) slot.querySelector('.sw-pp-thumb').style.backgroundImage = `url("${src.replace(/"/g, '\\"')}")`;
                
                slot.addEventListener('click', (e) => {
                    e.preventDefault(); e.stopPropagation();
                    iigCloseStylePreviewPopup();
                    $('#iig_open_style_library').trigger('click');
                });
            }
        }
        
        if (typeof toastr !== 'undefined') {
            toastr.success(`Выбран стиль: ${item.name}`, 'Библиотека стилей', { timeOut: 1500 });
        }
        
        if (document.getElementById('iig-style-modal-overlay') && typeof renderStylesList === 'function') {
            renderStylesList();
        }
        
        // Подсвечиваем саму кнопку палитры, если стиль выбран
        $('#iig-style-bar-btn').toggleClass('iig-style-bar-active', true);
    }

    function iigBindStylePeek(tileEl) {
        let hoverTimer = null;
        const showPeek = () => {
            iigStylePeekTimers.delete(hoverTimer);
            if (!tileEl.isConnected) return;
            const id = tileEl.dataset.id;
            const item = ensureStyles().find(i => i.id === id);
            if (!item) return;
            iigShowStylePeek(tileEl, item);
        };

        tileEl.addEventListener('mouseenter', () => {
            if (!iigCanHover()) return;
            clearTimeout(hoverTimer);
            iigStylePeekTimers.delete(hoverTimer);
            hoverTimer = setTimeout(showPeek, 500);
            iigStylePeekTimers.add(hoverTimer);
        });
        tileEl.addEventListener('mouseleave', () => {
            clearTimeout(hoverTimer);
            iigStylePeekTimers.delete(hoverTimer);
            iigHideStylePeek();
        });
    }

    function iigShowStylePeek(tileEl, item) {
        iigHideStylePeek();
        const src = item.imagePath;
        const peek = document.createElement('div');
        peek.className = 'sw-pp-peek';
        peek.innerHTML = `
            <div class="sw-pp-peek-img" style="${src ? `background-image: url("${src.replace(/"/g, '\\"')}")` : 'background: rgba(255,255,255,0.05); display: flex; align-items:center; justify-content:center; color:#ccc;'}">${src ? '' : 'Нет превью'}</div>
            <div class="sw-pp-peek-name">${sanitizeForHtml(item.name)}${item.isFavorite ? ' <span class="sw-pp-peek-fav">★</span>' : ''}</div>
        `;
        document.body.appendChild(peek);
        const PW = Math.min(260, window.innerWidth - 32);
        const PH = Math.round(PW * 4 / 3) + 32;
        peek.style.width = PW + 'px';
        const r = tileEl.getBoundingClientRect();
        let left = r.left + r.width / 2 - PW / 2;
        let top = r.top + r.height / 2 - PH / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - PW - 8));
        top = Math.max(8, Math.min(top, window.innerHeight - PH - 8));
        peek.style.left = left + 'px';
        peek.style.top = top + 'px';
        requestAnimationFrame(() => peek.classList.add('sw-pp-peek-show'));
    }

    function iigHideStylePeek() {
        iigCancelPendingPeekTimers();
        document.querySelectorAll('.sw-pp-peek').forEach(p => p.remove());
    }

    // ── Кнопка библиотеки стилей в чате ──
    function iigInjectStyleFloatingBtn() {
        let $btn = $('#iig-style-bar-btn');
        if ($btn.length === 0) {
            $btn = $('<div id="iig-style-bar-btn" title="Библиотека стилей" class="interactable"><i class="fa-solid fa-palette"></i></div>');
            const btnEl = $btn.get(0);

            // Клик открывает полноэкранную библиотеку стилей
            btnEl.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                clearTimeout(iigStyleHoverShowTimer);
                iigCloseStylePreviewPopup();
                $('#iig_open_style_library').trigger('click');
            });

            // Ховер открывает мини-попап
            btnEl.addEventListener('mouseenter', () => {
                if (!iigCanHover()) return;
                clearTimeout(iigStyleHoverShowTimer);
                clearTimeout(iigStyleAutoCloseTimer);
                iigStyleHoverShowTimer = setTimeout(() => iigOpenStylePreviewPopup(btnEl), 500);
            });
            
            btnEl.addEventListener('mouseleave', () => {
                clearTimeout(iigStyleHoverShowTimer);
                const pp = document.getElementById('iig-style-preview-popup');
                if (pp?.classList.contains('sw-pp-open') && !pp.matches(':hover')) {
                    clearTimeout(iigStyleAutoCloseTimer);
                    iigStyleAutoCloseTimer = setTimeout(iigCloseStylePreviewPopup, IIG_AUTOCLOSE_MS);
                }
            });

            const $left = $('#leftSendForm');
            if ($left.length) {
                const $wardrobeBtn = $('#sw-bar-btn');
                if ($wardrobeBtn.length) {
                    $wardrobeBtn.after($btn);
                } else {
                    $left.append($btn);
                }
            } else {
                $('body').append($btn);
            }
        }
        // Подсвечиваем кнопку, если активный стиль уже выбран
        const activeStyle = getSelectedStyle();
        $btn.toggleClass('iig-style-bar-active', !!activeStyle);
        $btn.show();
    }
	
	// Открытие превью стиля на фулл скрин (прямой бинд для блокировки всплытия)
    $(document).on('mouseenter', '.iig-style-cover-wrap', function() {
        const $btn = $(this).find('.iig-style-zoom-btn');
        
        // Проверяем, не вешали ли мы уже клик на эту кнопку
        if (!$btn.data('zoom-bound')) {
            $btn.data('zoom-bound', true);
            
            // Вешаем обработчик НАПРЯМУЮ на кнопку
            $btn.on('click', function(e) {
                e.preventDefault();
                e.stopPropagation(); // Теперь это остановит клик ДО того, как он дойдет до обертки!
                
                const $wrap = $(this).closest('.iig-style-cover-wrap');
                const imgEl = $wrap.find('img')[0];
                
                if (imgEl && imgEl.src && !imgEl.src.includes('error.svg')) {
                    openLightbox(imgEl);
                    return;
                }
                
                const bgImage = $wrap.css('background-image');
                if (bgImage && bgImage !== 'none') {
                    const urlMatch = bgImage.match(/^url\(['"]?(.+?)['"]?\)/);
                    if (urlMatch && urlMatch[1]) {
                        const fakeImg = document.createElement('img');
                        fakeImg.src = urlMatch[1];
                        fakeImg.alt = 'Превью стиля';
                        openLightbox(fakeImg);
                    }
                }
            });
        }
    });
	
	// Закрытие модалки библиотеки стилей по клику на затемненный фон
    $(document).on('click', '#iig-style-modal-overlay', function(e) {
        // Проверяем, что клик был именно по фону (overlay), а не по самой модалке внутри
        if (e.target === this) {
            $(this).remove(); 
        }
    });

    // ╔════════════════════════════════════════════════════════════════════╗
    // ║  Preview popup + Quick-Swap (v4.3)                                 ║
    // ╚════════════════════════════════════════════════════════════════════╝
    // Shown on hover (desktop) / long-press (mobile) on the wardrobe bar button.
    // Contents: currently-worn preview for bot+user + quick-swap buttons grouped
    // by tag. Mobile falls back to a bottom-sheet layout via CSS media query.

    const SW_TAG_ICONS = Object.freeze({
        home: '🏠', street: '👟', evening: '🌙',
        sleep: '💤', sport: '💪', beach: '🏖', other: '✨',
    });

    function swPreviewPopupEl() {
        let el = document.getElementById('sw-preview-popup');
        if (!el) {
            el = document.createElement('div');
            el.id = 'sw-preview-popup';
            el.className = 'sw-preview-popup';
            document.body.appendChild(el);
            // ── Dismissal paths:
            //   1. click outside popup (but not on bar-btn — bar-btn handler owns that)
            //   2. X close button inside popup
            //   3. Escape key
            //   4. mouseleave for SW_AUTOCLOSE_MS (5s)
            document.addEventListener('click', (e) => {
                if (!el.classList.contains('sw-pp-open')) return;
                if (el.contains(e.target)) return;
                if (e.target.closest('#sw-bar-btn')) return;
                swClosePreviewPopup();
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && el.classList.contains('sw-pp-open')) {
                    swClosePreviewPopup();
                }
            });

            // ── Auto-dismiss: cursor left the popup for SW_AUTOCLOSE_MS → close.
            // Entering the popup cancels the timer.
            el.addEventListener('mouseenter', () => clearTimeout(swAutoCloseTimer));
            el.addEventListener('mouseleave', () => {
                clearTimeout(swAutoCloseTimer);
                swAutoCloseTimer = setTimeout(swClosePreviewPopup, SW_AUTOCLOSE_MS);
            });

            // ── Event-bubbling containment (bound ONCE on the permanent element).
            // Previously this was re-added on every swRenderPreviewPopup() call
            // which stacked duplicate listeners on the same element after each
            // swap — textbook leak. Now the element is stable; listener set is
            // fixed size.
            const stop = e => e.stopPropagation();
            el.addEventListener('touchstart', stop, { passive: true });
            el.addEventListener('touchend', stop, { passive: true });
            el.addEventListener('pointerdown', stop);
            el.addEventListener('pointerup', stop);
            el.addEventListener('mousedown', stop);

        }
        return el;
    }

    // Anchor rect remembered across re-positions (e.g. after sub-picker expand)
    let swPopupAnchorRect = null;

    function swRepositionPopup() {
        const el = document.getElementById('sw-preview-popup');
        if (!el || !el.classList.contains('sw-pp-open') || !swPopupAnchorRect) return;
        const r = swPopupAnchorRect;
        el.style.visibility = 'hidden';
        el.style.left = '0px';
        el.style.top = '0px';
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const vh = window.innerHeight;
        let left = r.right - w;
        let top = r.top - h - 10;
        if (left < 8) left = 8;
        // If popup doesn't fit above the button, anchor its BOTTOM to just
        // above the button instead — so when sub-picker expands the popup
        // stretches upward, not off-screen below.
        if (top < 8) top = Math.max(8, vh - h - 10);
        el.style.left = left + 'px';
        el.style.top = top + 'px';
        el.style.visibility = '';
    }

    function swOpenPreviewPopup(anchor) {
        const el = swPreviewPopupEl();
        swRenderPreviewPopup();
        swPopupAnchorRect = anchor.getBoundingClientRect();
        el.classList.add('sw-pp-open');
        swRepositionPopup();
    }

    function swClosePreviewPopup() {
        clearTimeout(swAutoCloseTimer);
        const el = document.getElementById('sw-preview-popup');
        if (el) el.classList.remove('sw-pp-open');
        swHidePeek?.();  // also drop any lingering hold-to-zoom preview
    }

    // Render preview thumbnails (bot + user) + quick-swap categories for the
    // currently-selected swPreviewTab. Called on every open + after swaps.
    function swRenderPreviewPopup() {
        // Before the old DOM gets blown away by innerHTML, make sure no peek
        // timers (set by mouseenter on old tiles) can still fire.
        swCancelPendingPeekTimers();
        const el = swPreviewPopupEl();
        const co = swGetCharOutfit();
        const cn = swCharName();
        if (!cn) {
            el.innerHTML = `<div class="sw-pp-empty">Выберите персонажа</div>`;
            return;
        }
        const botItem = swGetTopWornItem('bot');
        const userItem = swGetTopWornItem('user');
        // Thumb backgrounds are set from JS (data-src → .style.backgroundImage)
        // instead of inline CSS to avoid url() escape bugs on paths with spaces,
        // parens, backslashes, unicode.
        const renderSlot = (type, item) => {
            const label = type === 'bot' ? '{{char}}' : '{{user}}';
            if (!item) {
                return `<div class="sw-pp-slot sw-pp-slot-empty" data-type="${type}">
                    <div class="sw-pp-thumb sw-pp-thumb-empty"><i class="fa-solid fa-shirt"></i></div>
                    <div class="sw-pp-slot-label">${label}</div>
                    <div class="sw-pp-slot-sub">— пусто —</div>
                </div>`;
            }
            const src = swGetOutfitSrc(item) || '';
            const mode = swGetModeFor(type);
            const sub = mode === 'full'
                ? (CATEGORIES[item.category] || 'Полный')
                : 'По частям';
            const safeSrcAttr = esc(src);
            return `<div class="sw-pp-slot" data-type="${type}" data-src="${safeSrcAttr}">
                <div class="sw-pp-thumb"></div>
                <div class="sw-pp-slot-label">${label}</div>
                <div class="sw-pp-slot-sub" title="${esc(item.name)}">${esc(item.name)}</div>
                <div class="sw-pp-slot-meta">${sub}</div>
            </div>`;
        };

        const byTag = swGroupFullsByTag(swPreviewTab);
        // Only show tags that have at least 1 visible item — clutter-free UX
        const activeTags = TAG_KEYS.filter(tk => byTag[tk].length > 0);

        const catButtons = activeTags.map(tk => {
            const items = byTag[tk];
            const multi = items.length > 1 ? ' sw-pp-cat-multi' : '';
            return `<button class="sw-pp-cat-btn${multi}" data-tag="${tk}" title="${TAGS[tk]} (${items.length})">
                <span class="sw-pp-cat-ico">${SW_TAG_ICONS[tk] || '✨'}</span>
                <span class="sw-pp-cat-count">${items.length}</span>
            </button>`;
        }).join('');

        el.innerHTML = `
            <button class="sw-pp-close" title="Закрыть" aria-label="Закрыть"><i class="fa-solid fa-xmark"></i></button>
            <div class="sw-pp-body">
                <div class="sw-pp-screen sw-pp-screen-main">
                    <div class="sw-pp-section sw-pp-section-preview">
                        <div class="sw-pp-title">Сейчас надето</div>
                        <div class="sw-pp-preview-grid">
                            ${renderSlot('bot', botItem)}
                            ${renderSlot('user', userItem)}
                        </div>
                    </div>
                    <div class="sw-pp-section sw-pp-section-swap">
                        <div class="sw-pp-title">Быстрая смена <span class="sw-pp-title-sub">(${swPreviewTab === 'bot' ? 'Бот' : 'Юзер'})</span></div>
                        <div class="sw-pp-cats">
                            ${catButtons || '<div class="sw-pp-empty-line">Нет полных комплектов</div>'}
                        </div>
                    </div>
                </div>
                <div class="sw-pp-screen sw-pp-screen-sub" hidden>
                    <div class="sw-pp-subgrid-head">
                        <button class="sw-pp-sub-back" title="К категориям"><i class="fa-solid fa-arrow-left"></i></button>
                        <span class="sw-pp-subgrid-title"></span>
                    </div>
                    <div class="sw-pp-subgrid-items"></div>
                </div>
            </div>
            <div class="sw-pp-footer">
                <div class="sw-pp-tabs">
                    <button class="sw-pp-tab${swPreviewTab === 'user' ? ' sw-pp-tab-active' : ''}" data-tab="user">👤 Юзер</button>
                    <button class="sw-pp-tab${swPreviewTab === 'bot' ? ' sw-pp-tab-active' : ''}" data-tab="bot">🤖 Бот</button>
                </div>
                <button class="sw-pp-open-full"><i class="fa-solid fa-shirt"></i> Открыть гардероб</button>
            </div>
        `;

        // ── Wire events ──
        el.querySelector('.sw-pp-close')?.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation(); swClosePreviewPopup();
        });
        el.querySelector('.sw-pp-open-full')?.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            swClosePreviewPopup();
            swOpenModal();
        });
        // Preview slot click → open full wardrobe on that type's tab
        el.querySelectorAll('.sw-pp-slot').forEach(slot => {
            slot.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                const type = slot.dataset.type;
                swTab = type;
                swClosePreviewPopup();
                swOpenModal();
            });
        });
        // Tab switch (bot/user for Quick-Swap target). Persists choice.
        el.querySelectorAll('.sw-pp-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                swSetPreviewTab(tab.dataset.tab);
                swRenderPreviewPopup();
            });
        });
        // Category button click → always open sub-picker, never instant-equip.
        el.querySelectorAll('.sw-pp-cat-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                const tk = btn.dataset.tag;
                const items = byTag[tk] || [];
                if (items.length > 0) swShowSubgrid(tk, items);
            });
        });
        // Apply thumbs via JS-set style (dodges CSS url() escaping hell —
        // paths with (), backslashes, spaces, unicode all survive).
        for (const slot of el.querySelectorAll('.sw-pp-slot')) {
            const src = slot.dataset.src;
            const thumb = slot.querySelector('.sw-pp-thumb');
            if (src && thumb && !thumb.classList.contains('sw-pp-thumb-empty')) {
                thumb.style.backgroundImage = `url("${src.replace(/"/g, '\\"')}")`;
            }
        }

    }

    // Step-based navigation: tap a multi-outfit category → swap the main screen
    // (preview+categories) out for the sub-picker screen (back-button + items).
    // Popup size stays constant; only the sub-picker's own grid scrolls if the
    // tag has many outfits. Back button returns to the main screen.
    function swShowSubgrid(tagKey, items) {
        // Re-rendering the tiles set → any pending peek timers from previous
        // sub-picker state become stale. Flush them.
        swCancelPendingPeekTimers();
        const el = swPreviewPopupEl();
        const main = el.querySelector('.sw-pp-screen-main');
        const sub = el.querySelector('.sw-pp-screen-sub');
        const titleEl = el.querySelector('.sw-pp-subgrid-title');
        const grid = el.querySelector('.sw-pp-subgrid-items');
        if (!sub || !grid || !main) return;
        titleEl.textContent = `${TAGS[tagKey] || tagKey} — выбери (${items.length})`;
        // Name captions intentionally dropped — thumbnails alone are enough
        // (per user feedback: "ебало есть, и глаза, и так все увидим").
        // Only the favourite star overlays.
        grid.innerHTML = items.map(item => {
            const fav = item.favourite ? '<span class="sw-pp-sub-fav">★</span>' : '';
            return `<div class="sw-pp-sub-item" data-id="${item.id}" title="${esc(item.name)}">${fav}</div>`;
        }).join('');
        // Set backgrounds via JS so path escaping doesn't bite us
        const itemById = new Map(items.map(i => [i.id, i]));
        for (const node of grid.querySelectorAll('.sw-pp-sub-item')) {
            const item = itemById.get(node.dataset.id);
            if (!item) continue;
            const src = swGetOutfitSrc(item);
            if (src) node.style.backgroundImage = `url("${src.replace(/"/g, '\\"')}")`;
        }
        main.hidden = true;
        sub.hidden = false;
        // Back button: re-use the single permanent listener via data-wired flag
        // so opening the sub-picker many times doesn't stack duplicates.
        const backBtn = el.querySelector('.sw-pp-sub-back');
        if (backBtn && backBtn.dataset.wired !== '1') {
            backBtn.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                sub.hidden = true;
                main.hidden = false;
            });
            backBtn.dataset.wired = '1';
        }
        grid.querySelectorAll('.sw-pp-sub-item').forEach(node => {
            swBindPeek(node);
            node.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                if (node.dataset.peekSuppress === '1') {
                    delete node.dataset.peekSuppress;
                    return;
                }
                const id = node.dataset.id;
                const item = swFindItem(id);
                if (item) swApplyQuickSwap(item);
            });
        });
    }

    // ── Peek (hold-to-zoom) ───────────────────────────────────────────────
    // Hover a sub-picker tile for 500ms → floating enlarged preview appears.
    // Mouseleave → dismiss. Only ever triggered from inside the desktop
    // popup (mobile popup is disabled entirely), so no touch path needed.

    // Track all pending peek timers globally. Re-rendering the popup or
    // applying a swap detaches the old tiles but pending setTimeouts keep
    // firing — those then show peek against a detached node whose rect is
    // (0,0,0,0), parking a stuck preview in the top-left corner. Killing
    // all pending timers on apply/hide/render eliminates that race.
    const swPeekTimers = new Set();
    function swCancelPendingPeekTimers() {
        for (const t of swPeekTimers) clearTimeout(t);
        swPeekTimers.clear();
    }

    function swBindPeek(tileEl) {
        let hoverTimer = null;
        const showPeek = () => {
            swPeekTimers.delete(hoverTimer);
            // Guard against the race described above: tile was removed from
            // DOM (sub-picker re-render, popup close) before the 500ms hover
            // timer fired. getBoundingClientRect would return (0,0) and park
            // a stray peek in the viewport corner.
            if (!tileEl.isConnected) return;
            const id = tileEl.dataset.id;
            const item = swFindItem(id);
            if (!item) return;
            swShowPeek(tileEl, item);
        };

        tileEl.addEventListener('mouseenter', () => {
            // Same desktop-only guard as the bar button: taps synthesize
            // mouseenter, which would park a hover-peek over the tapped tile.
            if (!swCanHover()) return;
            clearTimeout(hoverTimer);
            swPeekTimers.delete(hoverTimer);
            hoverTimer = setTimeout(showPeek, 500);
            swPeekTimers.add(hoverTimer);
        });
        tileEl.addEventListener('mouseleave', () => {
            clearTimeout(hoverTimer);
            swPeekTimers.delete(hoverTimer);
            swHidePeek();
        });
    }

    function swShowPeek(tileEl, item) {
        swHidePeek();  // only one at a time
        const src = swGetOutfitSrc(item);
        if (!src) return;
        const peek = document.createElement('div');
        peek.className = 'sw-pp-peek';
        peek.innerHTML = `
            <div class="sw-pp-peek-img"></div>
            <div class="sw-pp-peek-name">${esc(item.name)}${item.favourite ? ' <span class="sw-pp-peek-fav">★</span>' : ''}</div>
        `;
        // Background via JS — same reason as tiles: paths with special chars
        // break inline CSS url().
        peek.querySelector('.sw-pp-peek-img').style.backgroundImage =
            `url("${String(src).replace(/"/g, '\\"')}")`;
        document.body.appendChild(peek);
        // Size — large enough to inspect, small enough to fit on mobile
        const PW = Math.min(260, window.innerWidth - 32);
        const PH = Math.round(PW * 4 / 3) + 32; // +32 for caption strip
        peek.style.width = PW + 'px';
        const r = tileEl.getBoundingClientRect();
        let left = r.left + r.width / 2 - PW / 2;
        let top = r.top + r.height / 2 - PH / 2;
        // Clamp to viewport with a small margin
        left = Math.max(8, Math.min(left, window.innerWidth - PW - 8));
        top = Math.max(8, Math.min(top, window.innerHeight - PH - 8));
        peek.style.left = left + 'px';
        peek.style.top = top + 'px';
        requestAnimationFrame(() => peek.classList.add('sw-pp-peek-show'));
    }

    function swHidePeek() {
        // Kill any pending setTimeouts that would otherwise fire against a
        // tile that's already been removed from DOM (detached bounding rect
        // parks the peek in the viewport corner — "стуck в углу" bug).
        swCancelPendingPeekTimers();
        document.querySelectorAll('.sw-pp-peek').forEach(p => p.remove());
    }

    // Apply a full outfit to the currently-selected swPreviewTab's figure, keep
    // parts preserved. Surgical update: navigate back to main screen and patch
    // only the two preview slots instead of rebuilding the entire popup
    // (eliminates the full-popup DOM flash, keeps scroll position, cheaper).
    function swApplyQuickSwap(item) {
        const type = swPreviewTab;
        swQuickSwapFull(type, item.id);
        swHidePeek();
        const el = document.getElementById('sw-preview-popup');
        if (el) {
            // Back to main screen from sub-picker
            const main = el.querySelector('.sw-pp-screen-main');
            const sub = el.querySelector('.sw-pp-screen-sub');
            if (sub) sub.hidden = true;
            if (main) main.hidden = false;
            // Patch preview slots only (fresh top-worn thumbnail + caption)
            swUpdatePreviewSlots(el);
        }
        swShowQuickSwapToast(item.name, type);
    }

    // Rebuild only the two preview slots inside the preview-grid of an open
    // popup. Cheaper than swRenderPreviewPopup() and avoids a full DOM flash.
    function swUpdatePreviewSlots(root) {
        const grid = root.querySelector('.sw-pp-preview-grid');
        if (!grid) return;
        const render = (type) => {
            const item = swGetTopWornItem(type);
            const label = type === 'bot' ? '{{char}}' : '{{user}}';
            if (!item) {
                return `<div class="sw-pp-slot sw-pp-slot-empty" data-type="${type}">
                    <div class="sw-pp-thumb sw-pp-thumb-empty"><i class="fa-solid fa-shirt"></i></div>
                    <div class="sw-pp-slot-label">${label}</div>
                    <div class="sw-pp-slot-sub">— пусто —</div>
                </div>`;
            }
            const src = swGetOutfitSrc(item) || '';
            const mode = swGetModeFor(type);
            const sub = mode === 'full' ? (CATEGORIES[item.category] || 'Полный') : 'По частям';
            return `<div class="sw-pp-slot" data-type="${type}" data-src="${esc(src)}">
                <div class="sw-pp-thumb"></div>
                <div class="sw-pp-slot-label">${label}</div>
                <div class="sw-pp-slot-sub" title="${esc(item.name)}">${esc(item.name)}</div>
                <div class="sw-pp-slot-meta">${sub}</div>
            </div>`;
        };
        grid.innerHTML = render('bot') + render('user');
        // Attach thumb bg + click handlers (same as in swRenderPreviewPopup)
        for (const slot of grid.querySelectorAll('.sw-pp-slot')) {
            const src = slot.dataset.src;
            const thumb = slot.querySelector('.sw-pp-thumb');
            if (src && thumb && !thumb.classList.contains('sw-pp-thumb-empty')) {
                thumb.style.backgroundImage = `url("${src.replace(/"/g, '\\"')}")`;
            }
            slot.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                const type = slot.dataset.type;
                swTab = type;
                swClosePreviewPopup();
                swOpenModal();
            });
        }
    }

    function swShowQuickSwapToast(name, type) {
        const who = type === 'bot' ? 'бот' : 'юзер';
        if (typeof toastr !== 'undefined') {
            toastr.success(`Надето на ${who}: ${name}`, 'Гардероб', { timeOut: 1500 });
        }
    }

    // ── Public API ──
    window.slayWardrobe = {
        async getActiveOutfitBase64(type) {
            const cn = swCharName(); if (!cn) return null;
            const co = swGetCharOutfit(); if (!co) return null;
            const mode = swGetModeFor(type);
            // Only return base64 if mode=full and full item equipped
            if (mode !== 'full') return null;
            const fullId = co[type]?.full;
            if (!fullId) return null;
            const outfit = swFindItem(fullId);
            if (!outfit) return null;
            if (outfit.imagePath) return await swLoadImageAsBase64(outfit.imagePath);
            return outfit.base64 || null;
        },
        getActiveOutfitDescription(type) {
            const cn = swCharName(); if (!cn) return '';
            return swBuildDescription(type, cn);
        },
        async getCollageBase64(type) {
            if (!swGetSettings().experimentalCollage) return null;
            // 1 item = return as single ref; 2+ = collage
            const images = await swGetPartsImages(type);
            if (images.length === 1) return images[0]; // single item, no collage needed
            if (images.length >= 2) return await swBuildCollage(type);
            return null;
        },
        getActiveOutfitData(type) {
            const cn = swCharName(); if (!cn) return null;
            const co = swGetCharOutfit(); if (!co) return null;
            const result = {};
            for (const cat of CAT_KEYS) {
                const itemId = co[type]?.[cat] || null;
                result[cat] = itemId ? swFindItem(itemId) : null;
            }
            return result;
        },
        openModal: () => swOpenModal(),
        isReady: () => true,
        applyModalWidth: () => swApplyModalWidth(),
    };

    // ── Init hooks ──
    const ctx = SillyTavern.getContext();
    ctx.eventSource.on(ctx.event_types.APP_READY, () => {
        swApplyModalWidth();
        setTimeout(() => { 
            swUpdatePromptInjection(); 
            swInjectFloatingBtn(); 
            iigInjectStyleFloatingBtn(); 
        }, 500);
    });
    ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, () => {
        setTimeout(() => { 
            swUpdatePromptInjection(); 
            swInjectFloatingBtn(); 
            iigInjectStyleFloatingBtn(); 
        }, 300);
    });
    // Refresh outfit prompt injection RIGHT BEFORE every LLM request. Fixes
    // intermittent "wardrobe description missing" cases (CHAT_CHANGED race,
    // swipe/regen, preset that rebuilds messages array). Guarantees current
    // outfit description is present for every single generation.
    if (ctx.event_types.GENERATION_STARTED) {
        ctx.eventSource.on(ctx.event_types.GENERATION_STARTED, () => {
            try { swUpdatePromptInjection(); } catch (e) { swLog('WARN', 'GENERATION_STARTED injection refresh failed:', e.message); }
        });
    }
    swLog('INFO', 'SlayWardrobe v4 initialized');
})();

// Main transport. timeoutMs lets video callers extend the abort window.
function robustFetch(url, options = {}, timeoutMs = FETCH_TIMEOUT) {
    if (!IS_IOS) {
        const controller = new AbortController();
        let timedOut = false;
        const timeoutId = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
        // If caller passed its own signal, abort our fetch when theirs fires.
        // Forward the reason so downstream can tell user-cancel from a timeout.
        if (options.signal) {
            if (options.signal.aborted) controller.abort(options.signal.reason);
            else options.signal.addEventListener('abort', () => controller.abort(options.signal.reason), { once: true });
        }
        return fetch(url, { ...options, signal: controller.signal })
            .then(r => { clearTimeout(timeoutId); return r; })
            .catch(e => {
                clearTimeout(timeoutId);
                // When abort(reason) is used, fetch may reject with the bare reason
                // (a STRING, not an Error) OR with an AbortError. Normalize BOTH into
                // a proper AbortError that carries .reason, so downstream catch sites
                // can classify user-cancel reliably regardless of scope.
                const isAbortLike = e?.name === 'AbortError'
                    || controller.signal.aborted
                    || (typeof e === 'string');
                if (isAbortLike) {
                    if (timedOut) throw new Error(`Request timed out after ${Math.round(timeoutMs / 60000)} minutes`);
                    const reason = (typeof e === 'string') ? e
                        : (e?.reason !== undefined ? e.reason : options.signal?.reason);
                    const abortErr = (e instanceof Error) ? e : new Error('Request aborted');
                    abortErr.name = 'AbortError';
                    if (reason !== undefined) { try { abortErr.reason = reason; } catch (_) {} }
                    throw abortErr;
                }
                throw e;
            });
    }
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(options.method || 'GET', url);
        xhr.timeout = timeoutMs;
        xhr.responseType = 'text';
        if (options.headers) {
            for (const [key, value] of Object.entries(options.headers)) {
                xhr.setRequestHeader(key, value);
            }
        }
        // Honor external AbortSignal so callers can cancel iOS requests too.
        // Build an AbortError that carries the signal's reason (e.g. 'user-cancel')
        // so downstream classification works on iOS too.
        const _abortErr = () => {
            const reason = options.signal?.reason;
            const e = new Error(typeof reason === 'string' ? reason : 'Request aborted (iOS)');
            e.name = 'AbortError';
            if (reason !== undefined) e.reason = reason;
            return e;
        };
        if (options.signal) {
            if (options.signal.aborted) {
                xhr.abort();
                return reject(_abortErr());
            }
            options.signal.addEventListener('abort', () => xhr.abort(), { once: true });
        }
        xhr.onload = () => {
            const responseText = xhr.responseText;
            resolve({
                ok: xhr.status >= 200 && xhr.status < 300,
                status: xhr.status,
                statusText: xhr.statusText,
                text: () => Promise.resolve(responseText),
                // Async rejection on bad JSON, matching real fetch's .json().catch().
                json: () => new Promise((res, rej) => {
                    try { res(JSON.parse(responseText)); }
                    catch (err) { rej(err); }
                }),
                headers: { get: (name) => xhr.getResponseHeader(name) },
            });
        };
        xhr.ontimeout = () => reject(new Error(`Request timed out after ${Math.round(timeoutMs / 60000)} minutes (iOS)`));
        xhr.onerror = () => reject(new Error('Network error (iOS)'));
        xhr.onabort = () => reject(_abortErr());
        xhr.send(options.body || null);
    });
}

/** Short-timeout fetch for metadata/admin endpoints (models, file checks, uploads). */
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // Forward the caller's abort reason (e.g. 'user-cancel') downstream.
    if (options.signal) {
        if (options.signal.aborted) controller.abort(options.signal.reason);
        else options.signal.addEventListener('abort', () => controller.abort(options.signal.reason), { once: true });
    }
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Promise-based delay that resolves early when `signal` aborts (e.g. user Stop),
 * so retry backoffs don't block cancellation. Removes its abort listener on the
 * normal timeout path, so it is safe to call repeatedly without leaking listeners.
 */
function abortableDelay(ms, signal = null) {
    return new Promise((resolve) => {
        if (signal?.aborted) { resolve(); return; }
        let timer = null;
        const onAbort = () => { clearTimeout(timer); resolve(); };
        timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

// Dedup: messages currently processing. Key is "chatId:messageId" — bare
// messageId collides across chats because it's a numeric array index.
const processingMessages = new Set();

// Cooldown against re-trigger loops from messageFormatting / innerHTML
// changes re-firing CHARACTER_MESSAGE_RENDERED.
const recentlyProcessed = new Map();
const REPROCESS_COOLDOWN_MS = 5000;

// In-flight generations, keyed by "messageId:tagHash". Reclick aborts the prior
// fetch so only the latest result lands (no stale-overwrite races).
const _inFlightGenerations = new Map();

function _genKey(messageId, tag) {
    const str = `${messageId}:${tag?.fullMatch || tag?.prompt?.slice(0, 80) || ''}`;
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return `${messageId}:${(h >>> 0).toString(16)}`;
}

// Register a new in-flight generation, aborting any prior one for the same key.
function beginGeneration(messageId, tag) {
    const key = _genKey(messageId, tag);
    const existing = _inFlightGenerations.get(key);
    if (existing) {
        iigLog('INFO', `Aborting prior in-flight generation for ${key}`);
        try { existing.abort(); } catch (_) {}
    }
    const controller = new AbortController();
    _inFlightGenerations.set(key, controller);
    return { controller, key };
}

// Release the slot only if still current, so an older finally can't clear a newer gen.
function endGeneration(key, controller) {
    if (_inFlightGenerations.get(key) === controller) {
        _inFlightGenerations.delete(key);
    }
}

// Per-placeholder abort controllers, keyed by the UI tagId. Lets a Stop button
// on a specific loading placeholder cancel ONLY that generation.
const tagAbortControllers = new Map();

// Cancel the generation behind a given placeholder tagId (user Stop click).
function abortGenerationForTag(tagId) {
    const controller = tagAbortControllers.get(String(tagId || ''));
    if (controller) {
        try { controller.abort('user-cancel'); } catch (_) {}
        return true;
    }
    return false;
}

// Cached ST context (getContext allocates per call; hot paths hit it often).
// Invalidated on CHAT_CHANGED / APP_READY.
let _cachedContext = null;

function getContext() {
    if (_cachedContext) return _cachedContext;
    try {
        _cachedContext = SillyTavern.getContext();
    } catch (_) {
        _cachedContext = null;
    }
    return _cachedContext;
}

function invalidateContextCache() {
    _cachedContext = null;
}

// Composite key (chatId:messageId) so numeric indices don't collide across chats.
function buildProcessingKey(messageId) {
    try {
        const ctx = getContext();
        if (!ctx) return `_:${messageId}`;
        const chatId = ctx.chatId ?? ctx.getCurrentChatId?.() ?? '_';
        return `${chatId}:${messageId}`;
    } catch (_) {
        return `_:${messageId}`;
    }
}

// Clear processing/cooldown state on CHAT_CHANGED so the new chat isn't blocked.
function clearProcessingStateForChatChange() {
    processingMessages.clear();
    recentlyProcessed.clear();
}

// Global re-entry guard against stack overflow from recursive event dispatch.
let _eventHandlerDepth = 0;
const MAX_EVENT_HANDLER_DEPTH = 2;

// True while ST is streaming a reply. The image-wrap observer queues nodes but
// holds its heavy DOM pass until streaming ends, to avoid per-token CPU churn.
let _iigGenerating = false;
// Catch-up trigger set by the observer; run once when generation ends.
let _iigFlushWrapQueue = null;

// Debounced re-wrap pass; restores action buttons after ST re-renders a message.
let _wrapPassTimer = null;
function scheduleWrapPass(delay = _wrapPassDelay()) {
    if (_wrapPassTimer) clearTimeout(_wrapPassTimer);
    _wrapPassTimer = setTimeout(() => {
        _wrapPassTimer = null;
        _iigGenerating = false; // clear the streaming gate
        try { wrapExistingImages(); } catch (_) {}
    }, delay);
}

// Low-power mode state. Each sub-flag applies only while the master is on.
const WRAP_DEBOUNCE_NORMAL = 100;
const WRAP_DEBOUNCE_SLOW = 500;
function _lowPowerSlowUpdates() {
    const s = getSettings();
    return !!(s.lowPowerMode && s.lpSlowUpdates);
}
function _lowPowerAnimationsOff() {
    const s = getSettings();
    return !!(s.lowPowerMode && s.lpDisableAnimations);
}
// Observer debounce (ms); wrap-pass runs a touch later.
function _wrapDebounceMs() { return _lowPowerSlowUpdates() ? WRAP_DEBOUNCE_SLOW : WRAP_DEBOUNCE_NORMAL; }
function _wrapPassDelay() { return _wrapDebounceMs() + 100; }

// Toggle the body class that gates the animation-disabling CSS.
function applyLowPowerMode() {
    try { document.body.classList.toggle('iig-low-power', _lowPowerAnimationsOff()); } catch (_) {}
}

// Stale-entry sweeper. Cancel any previous interval on hot-reload.
try {
    if (typeof window !== 'undefined' && window._iigStaleCleanupInterval) {
        clearInterval(window._iigStaleCleanupInterval);
    }
} catch (_) {}
const _staleCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, ts] of recentlyProcessed) {
        if (now - ts > REPROCESS_COOLDOWN_MS * 2) recentlyProcessed.delete(id);
    }
}, 30000);
try {
    if (typeof window !== 'undefined') {
        window._iigStaleCleanupInterval = _staleCleanupInterval;
    }
} catch (_) {}

// Per-session counters shown in the settings panel (generated / failed).
let sessionGenCount = 0;
let sessionErrorCount = 0;

function updateSessionStats() {
    const el = document.getElementById('iig_session_stats');
    if (!el) return;
    if (sessionGenCount === 0 && sessionErrorCount === 0) {
        el.textContent = '';
        return;
    }
    const parts = [];
    if (sessionGenCount > 0) parts.push(`${sessionGenCount} generated`);
    if (sessionErrorCount > 0) parts.push(`${sessionErrorCount} failed`);
    el.textContent = `Session: ${parts.join(' · ')}`;
}

// Last saved media. Exposed via window.IIG.getLastGenerated() and broadcast as
// CustomEvent('iig:image-saved') so other extensions can auto-refresh.
let _lastGenerated = null;

function _emitMediaSaved(path, mediaType) {
    try {
        _lastGenerated = { path, mediaType, ts: Date.now() };
        window.dispatchEvent(new CustomEvent('iig:image-saved', { detail: { path, mediaType } }));
    } catch (_) { /* event dispatch must never break a save */ }
}

// Rolling in-memory log, surfaced by the Export Logs button.
const logBuffer = [];
const MAX_LOG_ENTRIES = 200;

// Strip API keys / bearer tokens before logging so Export Logs is safe to share.
// Covers Bearer headers, sk-*/AIza* keys, and ?key=/?api_key= URL params.
function redactSensitive(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, 'Bearer ***REDACTED***')
        .replace(/\b(sk-(?:proj|or|ant|live|test)?-?[A-Za-z0-9_\-]{16,})\b/g, '***REDACTED***')
        .replace(/\bAIza[0-9A-Za-z_\-]{20,}\b/g, '***REDACTED***')
        .replace(/([?&](?:api[_-]?key|key|token)=)[^&\s"']+/gi, '$1***REDACTED***');
}

function iigLog(level, ...args) {
    const timestamp = new Date().toISOString();
    const message = args
        .map(a => typeof a === 'object' ? JSON.stringify(a) : String(a))
        .map(redactSensitive)
        .join(' ');
    const entry = `[${timestamp}] [${level}] ${message}`;

    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOG_ENTRIES) {
        logBuffer.shift();
    }

    // Console output also gets redacted — protects screenshots too.
    const consoleArgs = args.map(a => {
        if (typeof a === 'string') return redactSensitive(a);
        if (a instanceof Error) {
            const clean = new Error(redactSensitive(a.message));
            clean.stack = a.stack ? redactSensitive(a.stack) : undefined;
            return clean;
        }
        return a;
    });

    if (level === 'ERROR') {
        console.error('[IIG]', ...consoleArgs);
    } else if (level === 'WARN') {
        console.warn('[IIG]', ...consoleArgs);
    } else {
        console.log('[IIG]', ...consoleArgs);
    }
}

function exportLogs() {
    const logsText = logBuffer.join('\n');
    const blob = new Blob([logsText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `iig-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toastr.success('Logs exported', 'Image Generation');
}

// apiType is the single source of truth for request routing — no model-name
// heuristics, no provider auto-detection. Non-standard providers use the
// Advanced path override to replace the auto-appended URL suffix.
const defaultSettings = Object.freeze({
    enabled: true,
    apiType: 'openai',              // 'openai' | 'gemini' | 'naistera'
    endpoint: '',
    apiKey: '',
    model: '',
    size: '1024x1024',
    quality: 'auto',
    maxRetries: 2,                  // auto-retry 429/502/503/504
    retryDelay: 1500,
	// Стили
    styles: [],
    activeStyleId: '',
    // Prompt-driven: tag JSON wins over UI defaults. Off = UI always applied.
    // Aspect ratio is always tag-driven regardless of this flag.
    promptDriven: true,
    imageSize: '1K',                // Gemini: 1K/2K/4K
    // User toggle to skip refs on Gemini-compatible calls. Useful when a
    // provider rejects refs on specific models or for quick text-only tests.
    geminiSendRefs: true,
    // Video generation (rout.my-style /v1/video/generations, openai/gemini only).
    // Empty videoModel = video disabled (video tags error with a clear message).
    videoModel: '',
    videoDuration: 4,               // seconds (tag can override)
    videoResolution: '480p',        // 480p/720p/1080p/4K (tag can override)
    videoAudio: false,              // request an audio track when supported
    // Naistera
    naisteraPreset: '',             // '' | 'digital' | 'realism' (Grok only)
    naisteraModel: 'grok',          // 'grok' | 'nano banana 2' | 'novelai'
    // Naistera refs: Grok can break with refs attached; novelai-via-naistera
    // ignores them. User toggle to skip regardless of model capability.
    naisteraSendRefs: true,
    // Advanced escape hatches for non-standard providers.
    pathOverride: '',               // replaces the auto-appended URL suffix
    showAllModels: false,           // disable fetchModels() keyword filter
    // Named API presets — snapshots of API-routing fields. Stored in the
    // same settings.json as the live config (no new attack surface).
    presets: [],
    activePresetName: '',
    // Flat ref storage — avoids per-character-keyed reload timing bugs.
    charRef: { name: '', imageBase64: '', imagePath: '' },
    userRef: { name: '', imageBase64: '', imagePath: '' },
    npcReferences: [],
    // Crop-before-upload (ported from SLAY). Opt-OUT: the checkbox reads
    // "не предлагать обрезку", so the stored flag is the skip.
    skipCrop: false,
    // Rolling window of recently-used ref paths (ported from SLAY v4.2),
    // for the ribbon under the refs grid — tap to assign, drag onto a slot.
    recentRefs: [],
    // When true, the char/user ref is sent on every generation regardless of
    // whether its name appears in the prompt. Off = name-gated (like NPCs).
    charRefAlways: false,
    userRefAlways: false,
    // Reference scope:
    //   'global'   — one ref set used in every chat (the fields above).
    //   'per-chat' — each chat keeps its own ref set in chatMetadata, falling
    //                back to the global set when a chat has none saved.
    refScope: 'global',
    // Epoch ms of last ref write. Prevents stale localStorage backups from
    // clobbering fresher server state on cross-device use.
    refsUpdatedAt: 0,
    // Low-power mode: master + opt-out sub-toggles (animations off, slower DOM passes).
    lowPowerMode: false,
    lpDisableAnimations: true,
    lpSlowUpdates: true,
});

// Keyword-based image model filter used by fetchModels() dropdown.
// Video keywords are excluded to keep generation endpoints out of the list.
const IMAGE_MODEL_KEYWORDS = [
    'dall-e', 'midjourney', 'mj', 'journey', 'stable-diffusion', 'sdxl', 'flux',
    'imagen', 'drawing', 'paint', 'image', 'seedream', 'hidream', 'dreamshaper',
    'ideogram', 'nano-banana', 'gpt-image', 'wanx', 'qwen',
];
const VIDEO_MODEL_KEYWORDS = [
    'sora', 'kling', 'jimeng', 'veo', 'pika', 'runway', 'luma',
    'video', 'gen-3', 'minimax', 'cogvideo', 'mochi', 'seedance',
    'vidu', 'wan-ai', 'hunyuan', 'hailuo',
];

function isImageModel(modelId) {
    const mid = modelId.toLowerCase();
    for (const kw of VIDEO_MODEL_KEYWORDS) if (mid.includes(kw)) return false;
    if (mid.includes('vision') && mid.includes('preview')) return false;
    for (const kw of IMAGE_MODEL_KEYWORDS) if (mid.includes(kw)) return true;
    return false;
}

// gpt-image-2 enforces a narrower quality vocabulary (low/medium/high/auto)
// and routes reference-bearing requests through /v1/images/edits instead of
// /v1/images/generations. Matches provider-prefixed ids (e.g. "openai/gpt-image-2").
function isGptImage2Model(modelId) {
    return /gpt-image-2/i.test(String(modelId || ''));
}

// Naistera upstreams via /api/generate: grok (refs+presets), nano banana 2
// (refs), novelai (neither).
const NAISTERA_MODELS = Object.freeze(['grok', 'nano banana 2', 'novelai']);

function normalizeNaisteraModel(model) {
    const raw = String(model || '').trim().toLowerCase();
    if (!raw) return 'grok';
    if (raw === 'nano-banana' || raw === 'nano banana'
        || raw === 'nano-banana-pro' || raw === 'nano banana pro'
        || raw === 'nano-banana-2' || raw === 'nano banana 2') {
        return 'nano banana 2';
    }
    if (raw === 'novel ai' || raw === 'novel-ai') return 'novelai';
    if (NAISTERA_MODELS.includes(raw)) return raw;
    return 'grok';
}

function naisteraModelSupportsReferences(model) {
    return normalizeNaisteraModel(model) !== 'novelai';
}

// Presets are a Grok-only feature; nano-banana-2 and novelai ignore them.
function naisteraModelSupportsPreset(model) {
    return normalizeNaisteraModel(model) === 'grok';
}

// Wire values stay canonical (Naistera-accepted); labels get capitalized for UI.
function naisteraModelDisplayLabel(canonical) {
    switch (canonical) {
        case 'grok':          return 'Grok';
        case 'nano banana 2': return 'Nano Banana 2';
        case 'novelai':       return 'NovelAI';
        default:              return canonical;
    }
}

const DEFAULT_ENDPOINTS = Object.freeze({
    naistera: 'https://naistera.org',
});

const ENDPOINT_PLACEHOLDERS = Object.freeze({
    openai:   'https://your-provider.example (base URL only)',
    gemini:   'https://your-provider.example (base URL only)',
    naistera: 'https://naistera.org',
});

// Protocol-path tooltip strings for the "?" icon next to the API Type dropdown.
const API_TYPE_TOOLTIPS = Object.freeze({
    openai:   'Appends /v1/images/generations and /v1/models. Use this for providers that speak the OpenAI REST schema.',
    gemini:   'Appends /v1beta/models/{model}:generateContent and /v1beta/models. Use this for providers that speak the Google Gemini REST schema (including most Gemini proxies).',
    naistera: 'Appends /api/generate. If the URL is blank, defaults to naistera.org.',
});

/**
 * Normalize the user-configured endpoint for a given API type.
 * Strips trailing slashes, strips known auto-appended suffixes
 * (/api/generate, /v1/images/generations, /v1beta/models/...) so users
 * who paste the full documented path still end up with the right base
 * URL. Defaults to naistera.org if empty under apiType='naistera'.
 */
function normalizeConfiguredEndpoint(apiType, endpoint) {
    const trimmed = String(endpoint || '').trim().replace(/\/+$/, '');
    if (!trimmed) {
        return apiType === 'naistera' ? DEFAULT_ENDPOINTS.naistera : '';
    }
    if (apiType === 'naistera') {
        return trimmed.replace(/\/api\/generate$/i, '');
    }
    if (apiType === 'openai') {
        return trimmed.replace(/\/v1\/images\/generations$/i, '')
                      .replace(/\/v1\/models$/i, '');
    }
    if (apiType === 'gemini') {
        return trimmed.replace(/\/v1beta\/models(\/[^?]*)?$/i, '');
    }
    return trimmed;
}

// True if the current endpoint clearly belongs to a different API's
// convention and keeping it would break the newly-selected type. Also fires
// when switching AWAY from Naistera so a stale naistera.org doesn't leak.
function shouldReplaceEndpointForApiType(apiType, endpoint) {
    const trimmed = String(endpoint || '').trim();
    if (!trimmed) return true;

    const looksLikeNaistera = /naistera\.org/i.test(trimmed) || /\/api\/generate\/?$/i.test(trimmed);
    const looksLikeOpenAI = /\/v1\/images\/generations\/?$/i.test(trimmed)
                            || /\/v1\/models\/?$/i.test(trimmed);
    const looksLikeGemini = /\/v1beta\/models\//i.test(trimmed);

    if (apiType === 'naistera') {
        return looksLikeOpenAI || looksLikeGemini;
    }
    if (apiType !== 'naistera' && looksLikeNaistera) {
        return true;
    }
    if (apiType === 'openai' && looksLikeGemini) return true;
    if (apiType === 'gemini' && looksLikeOpenAI) return true;
    return false;
}

function getEffectiveEndpoint(settings) {
    if (!settings) settings = getSettings();
    return normalizeConfiguredEndpoint(settings.apiType, settings.endpoint);
}

// =========================================================================
// API Presets — named snapshots of API-config fields
// =========================================================================

// Only API-routing fields. Generation params / refs / retries stay on live
// settings so switching providers doesn't wipe unrelated preferences.
const PRESET_FIELDS = Object.freeze([
    'apiType',
    'endpoint',
    'apiKey',
    'model',
    'pathOverride',
    'showAllModels',
    'naisteraModel',
    'naisteraSendRefs',
    'geminiSendRefs',
    'videoModel',
]);

function snapshotApiConfig(settings) {
    const snap = {};
    for (const f of PRESET_FIELDS) snap[f] = settings[f] ?? '';
    return snap;
}

// Missing fields fall back to '' so a partially-populated preset still applies cleanly.
function applyPresetToSettings(settings, preset) {
    for (const f of PRESET_FIELDS) {
        settings[f] = preset[f] ?? '';
    }
}

// Case-sensitive name lookup; empty name is not valid.
function findPreset(settings, name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return null;
    const presets = Array.isArray(settings.presets) ? settings.presets : [];
    return presets.find(p => p && p.name === trimmed) || null;
}

// Google's native Gemini REST API requires x-goog-api-key; aggregators (rout.my,
// linkapi, etc.) speak Bearer only and some reject requests with the Google
// header attached. Hostname check is the single brand-specific branch here.
function endpointNeedsGoogleHeader(endpoint) {
    try {
        const h = new URL(endpoint, window.location.href).hostname.toLowerCase();
        return h.endsWith('googleapis.com');
    } catch (_) {
        return false;
    }
}

// Build full request URL from base + suffix. settings.pathOverride replaces
// the default suffix entirely when set.
function buildApiUrl(settings, defaultSuffix, modelForSuffix) {
    const base = getEffectiveEndpoint(settings);
    let suffix = (settings.pathOverride || '').trim();
    if (!suffix) {
        suffix = defaultSuffix.replace('{model}', modelForSuffix || '');
    } else if (!suffix.startsWith('/')) {
        suffix = '/' + suffix;
    }
    return `${base}${suffix}`;
}

function getSettings() {
    const context = getContext() || SillyTavern.getContext();

    if (!context.extensionSettings[MODULE_NAME]) {
        context.extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }

    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(context.extensionSettings[MODULE_NAME], key)) {
            context.extensionSettings[MODULE_NAME][key] = defaultSettings[key];
        }
    }

    // Normalize the Naistera model name at read-time.
    const s = context.extensionSettings[MODULE_NAME];
    if (typeof s.naisteraModel === 'string') {
        const canonical = normalizeNaisteraModel(s.naisteraModel);
        if (canonical !== s.naisteraModel) s.naisteraModel = canonical;
    }

    return s;
}

// Moves any inline base64 reference data onto server files, keeping only the
// imagePath. Runs once per install; the _migratedBase64_v260 flag marks it done.
async function migrateBase64Refs() {
    const settings = getSettings();
    if (settings._migratedBase64_v260) return;

    iigLog('INFO', 'Reference data migration: starting scan for legacy base64 fields');

    let migratedPathPlusB64 = 0;
    let migratedB64OnlyOk = 0;
    let migratedB64OnlyFail = 0;
    let totalBytesStripped = 0;

    const processRef = async (ref, label) => {
        if (!ref) return;
        const b64 = ref.imageBase64 || ref.imageData || '';
        if (!b64) return;

        if (ref.imagePath) {
            totalBytesStripped += b64.length;
            ref.imageBase64 = '';
            if ('imageData' in ref) ref.imageData = '';
            iigLog('INFO', `  ${label}: had path + ${b64.length} b64 chars → stripped base64 (path kept: ${ref.imagePath})`);
            migratedPathPlusB64++;
        } else {
            try {
                const path = await saveRefImageToFile(b64, label);
                ref.imagePath = path;
                ref.imageBase64 = '';
                if ('imageData' in ref) ref.imageData = '';
                totalBytesStripped += b64.length;
                iigLog('INFO', `  ${label}: migrated ${b64.length} b64 chars → ${path}`);
                migratedB64OnlyOk++;
            } catch (e) {
                iigLog('ERROR', `  ${label}: migration failed, keeping base64 — ${e.message}`);
                migratedB64OnlyFail++;
            }
        }
    };

    try {
        await processRef(settings.charRef, 'charRef');
        await processRef(settings.userRef, 'userRef');
        if (Array.isArray(settings.npcReferences)) {
            for (let i = 0; i < settings.npcReferences.length; i++) {
                await processRef(settings.npcReferences[i], `npc[${i}]`);
            }
        }
    } catch (e) {
        iigLog('ERROR', `migrateBase64Refs: unexpected error — ${e.message}`);
    }

    // Mark done regardless — even partial failures shouldn't retry forever.
    settings._migratedBase64_v260 = true;
    saveSettings({ sync: true });

    const total = migratedPathPlusB64 + migratedB64OnlyOk + migratedB64OnlyFail;
    if (total === 0) {
        iigLog('INFO', 'Reference data migration: no legacy base64 found, clean install');
    } else {
        iigLog('INFO', `Reference data migration complete: ${migratedPathPlusB64} path+b64 stripped, ${migratedB64OnlyOk} b64→path uploaded, ${migratedB64OnlyFail} failed; ${totalBytesStripped} total b64 chars removed from settings`);
    }
}

// Captured reference to ST's original window.saveSettings. Must be taken
// BEFORE our function declaration shadows it in global scope, or calling
// window.saveSettings() from inside would recurse forever.
let _stSaveSettings = null;
let _stSaveSettingsCaptured = false;

// opts.sync === true: non-debounced write + immediate localStorage flush.
// Used by the manual save button and mobile visibilitychange/pagehide path.
// Default: debounced — input-event handlers call this per keystroke.
function saveSettings(opts) {
    const sync = !!(opts && opts.sync);

    if (!_stSaveSettingsCaptured || _stSaveSettings === null) {
        const candidate = window.saveSettings;
        if (typeof candidate === 'function' && candidate !== saveSettings) {
            _stSaveSettings = candidate;
        }
        _stSaveSettingsCaptured = true;
    }

    const context = getContext();

    if (sync) {
        if (typeof _stSaveSettings === 'function' && _stSaveSettings !== saveSettings) {
            try { _stSaveSettings(); } catch(e) { context.saveSettingsDebounced(); }
        } else {
            context.saveSettingsDebounced();
        }
        persistRefsToLocalStorage({ sync: true });
    } else {
        context.saveSettingsDebounced();
        schedulePersistRefsToLocalStorage();
    }
}

// Trailing debounce for ref-data persistence. Keystroke events coalesce
// into one write 500 ms after typing stops, avoiding main-thread stalls
// from JSON.stringify + 2× localStorage.setItem per keystroke on mobile.
let _persistRefsTimer = null;
const PERSIST_REFS_DEBOUNCE_MS = 500;

function schedulePersistRefsToLocalStorage() {
    if (_persistRefsTimer) clearTimeout(_persistRefsTimer);
    _persistRefsTimer = setTimeout(() => {
        _persistRefsTimer = null;
        persistRefsToLocalStorage();
    }, PERSIST_REFS_DEBOUNCE_MS);
}

function flushPendingRefsPersist() {
    if (_persistRefsTimer) {
        clearTimeout(_persistRefsTimer);
        _persistRefsTimer = null;
    }
    persistRefsToLocalStorage({ sync: true });
}

const LS_KEY = 'iig_npc_refs_v3';       // legacy array-only format
const LS_KEY_V4 = 'iig_npc_refs_v4';    // current {version, updatedAt, refs}

// Hash of last persisted refs. Every setting change triggers persistRefs,
// but we only bump the timestamp when ref data actually changed.
let _lastPersistedRefsHash = null;

// Log-throttling state for routine debounced writes.
let _lastPersistedRefsSize = 0;
let _lastPersistedRefsLogAt = 0;
const PERSIST_LOG_QUIET_MS = 5000;

function hashRefSlot(r) {
    if (!r) return '0';
    return `${r.name || ''}|${(r.imagePath || '').length}|${(r.imageBase64 || r.imageData || '').length}`;
}

/** Fingerprint charRef + userRef + npcReferences. Bare-array input kept for legacy callers. */
function cheapRefsHash(settingsOrArray) {
    if (Array.isArray(settingsOrArray)) {
        return settingsOrArray.map(hashRefSlot).join(';') || '[]';
    }
    const s = settingsOrArray || {};
    const npcPart = Array.isArray(s.npcReferences) ? s.npcReferences.map(hashRefSlot).join(';') : '';
    return `C:${hashRefSlot(s.charRef)};U:${hashRefSlot(s.userRef)};N:${npcPart}`;
}

/**
 * Persist refs to localStorage (mobile-safe backup). Skips unchanged content;
 * bumps timestamp only on real change so a restore won't clobber fresher state.
 */
function persistRefsToLocalStorage(opts) {
    const force = !!(opts && opts.sync);
    try {
        const settings = getSettings();
        const refs = settings.npcReferences || [];
        const nextHash = cheapRefsHash(settings);
        const contentChanged = nextHash !== _lastPersistedRefsHash;

        if (!contentChanged) {
            if (!force) return;
            const hasV4 = localStorage.getItem(LS_KEY_V4) !== null;
            const hasV3 = localStorage.getItem(LS_KEY) !== null;
            if (hasV4 && hasV3) {
                iigLog('INFO', 'Refs: forced flush skipped (unchanged + backups present)');
                return;
            }
            iigLog('INFO', `Refs: forced flush writing missing backup key (v4=${hasV4}, v3=${hasV3})`);
        }

        const ts = contentChanged ? Date.now() : (Number(settings.refsUpdatedAt) || Date.now());
        if (contentChanged) {
            settings.refsUpdatedAt = ts;
            _lastPersistedRefsHash = nextHash;
        }
        const payload = {
            version: 4,
            updatedAt: ts,
            npcReferences: refs,
        };
        const serialized = JSON.stringify(payload);
        localStorage.setItem(LS_KEY_V4, serialized);
        localStorage.setItem(LS_KEY, JSON.stringify(refs));

        const sizeDelta = Math.abs(serialized.length - _lastPersistedRefsSize);
        const quietElapsed = Date.now() - _lastPersistedRefsLogAt;
        const worthLogging = force || sizeDelta > 10 || quietElapsed > PERSIST_LOG_QUIET_MS;
        if (worthLogging) {
            iigLog('INFO', `Refs saved to localStorage (${serialized.length} bytes, ts=${ts}, changed=${contentChanged}, forced=${force})`);
            _lastPersistedRefsLogAt = Date.now();
        }
        _lastPersistedRefsSize = serialized.length;
    } catch(e) {
        iigLog('WARN', 'persistRefsToLocalStorage failed:', e.message);
    }
}

/**
 * Restore refs from localStorage, but only when it wouldn't clobber fresher
 * server state. Prevents stale mobile overwriting a newer desktop edit.
 */
function restoreRefsFromLocalStorage() {
    try {
        const settings = getSettings();
        let backupRefs = null;
        let backupTs = 0;

        // v4 payload includes a timestamp; prefer it.
        const rawV4 = localStorage.getItem(LS_KEY_V4);
        if (rawV4) {
            const parsed = JSON.parse(rawV4);
            if (parsed && typeof parsed === 'object' && Array.isArray(parsed.npcReferences)) {
                backupRefs = parsed.npcReferences;
                backupTs = Number(parsed.updatedAt) || 0;
            }
        }

        // Fallback to v3 format (plain array, no timestamp).
        if (backupRefs === null) {
            const rawV3 = localStorage.getItem(LS_KEY);
            if (rawV3) {
                const arr = JSON.parse(rawV3);
                if (Array.isArray(arr)) {
                    backupRefs = arr;
                    backupTs = 0;
                }
            }
        }

        if (backupRefs === null) {
            iigLog('INFO', 'localStorage: no refs backup found');
            return;
        }

        const currentRefs = Array.isArray(settings.npcReferences) ? settings.npcReferences : [];
        const currentHasData = currentRefs.some(r => r && (r.name || r.imageBase64 || r.imagePath || r.imageData));
        const backupHasData = backupRefs.some(r => r && (r.name || r.imageBase64 || r.imagePath || r.imageData));
        const currentTs = Number(settings.refsUpdatedAt) || 0;

        // Restore if current is empty, OR backup is strictly newer.
        let shouldRestore = false;
        let reason = '';
        if (!currentHasData && backupHasData) {
            shouldRestore = true;
            reason = 'server state empty, backup has data';
        } else if (backupHasData && backupTs > currentTs) {
            shouldRestore = true;
            reason = `backup newer (${backupTs} > ${currentTs})`;
        } else {
            reason = `keeping server state (currentTs=${currentTs}, backupTs=${backupTs}, currentHasData=${currentHasData}, backupHasData=${backupHasData})`;
        }

        if (shouldRestore) {
            settings.npcReferences = backupRefs;
            if (backupTs > 0) settings.refsUpdatedAt = backupTs;
            iigLog('INFO', `Refs restored from localStorage: ${backupRefs.length} slot(s) — ${reason}`);
        } else {
            iigLog('INFO', `Refs NOT restored from localStorage — ${reason}`);
        }
    } catch(e) {
        iigLog('WARN', 'restoreRefsFromLocalStorage failed:', e.message);
    }
}

/** Mobile safety net: force-flush pending ref writes on tab background/navigation. */
function initMobileSaveListeners() {
    const flush = () => {
        flushPendingRefsPersist();
        try { SillyTavern.getContext().saveSettingsDebounced(); } catch(e) {}
        // Use the captured ST ref — window.saveSettings is shadowed by ours and would recurse.
        if (typeof _stSaveSettings === 'function' && _stSaveSettings !== saveSettings) {
            try { _stSaveSettings(); } catch(e) {}
        }
    };
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            iigLog('INFO', 'visibilitychange hidden: flushing to localStorage');
            flush();
        }
    });
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    iigLog('INFO', 'Mobile save listeners registered');
}

// Ensure a ref container has charRef, userRef, and 4 NPC slots.
function ensureRefSlots(container) {
    if (!container.charRef) container.charRef = { name: '', imageBase64: '', imagePath: '' };
    if (!container.userRef) container.userRef = { name: '', imageBase64: '', imagePath: '' };
    if (!Array.isArray(container.npcReferences)) container.npcReferences = [];
    while (container.npcReferences.length < 4) {
        container.npcReferences.push({ name: '', imageBase64: '', imagePath: '' });
    }
    return container;
}

/** Get the GLOBAL ref container (the settings object). Mutate + saveSettings(). */
function getCurrentCharacterRefs() {
    return ensureRefSlots(getSettings());
}

// True when per-chat ref mode is active AND a chat is currently loaded.
function isPerChatRefs() {
    if (getSettings().refScope !== 'per-chat') return false;
    try {
        const ctx = getContext();
        const chatId = ctx?.chatId ?? ctx?.getCurrentChatId?.();
        return chatId !== undefined && chatId !== null && chatId !== '';
    } catch (_) {
        return false;
    }
}

/**
 * Get (lazily create) the per-chat ref container in chatMetadata, seeded from
 * global on first use. Read chatMetadata fresh — never cache it (ST swaps it on
 * chat switch).
 */
function getChatRefsContainer({ seedIfMissing = true } = {}) {
    const ctx = getContext();
    if (!ctx || !ctx.chatMetadata) return null;
    let bucket = ctx.chatMetadata.iig_refs;
    if (!bucket || typeof bucket !== 'object') {
        if (!seedIfMissing) return null;
        const g = getCurrentCharacterRefs();
        // Copy global slots so chat edits don't mutate global.
        bucket = {
            charRef: { ...g.charRef },
            userRef: { ...g.userRef },
            npcReferences: (g.npcReferences || []).map(r => ({ ...r })),
            updatedAt: Date.now(),
        };
        ctx.chatMetadata.iig_refs = bucket;
        iigLog('INFO', 'Per-chat refs: seeded this chat from global refs');
    }
    return ensureRefSlots(bucket);
}

/** Active refs for READS (no side effects). Per-chat set if present, else global. */
function getActiveRefs() {
    if (isPerChatRefs()) {
        const chatRefs = getChatRefsContainer({ seedIfMissing: false });
        if (chatRefs) return chatRefs;
    }
    return getCurrentCharacterRefs();
}

/** Active refs for WRITES. Per-chat mode forks the chat from global on first edit. */
function getActiveRefsForWrite() {
    if (isPerChatRefs()) {
        const chatRefs = getChatRefsContainer({ seedIfMissing: true });
        if (chatRefs) return chatRefs;
    }
    return getCurrentCharacterRefs();
}

// Persist the active scope: per-chat -> saveMetadata(); global -> saveSettings().
function saveActiveRefs() {
    if (isPerChatRefs()) {
        try {
            const ctx = getContext();
            if (ctx?.chatMetadata?.iig_refs) ctx.chatMetadata.iig_refs.updatedAt = Date.now();
            ctx?.saveMetadata?.();
        } catch (e) {
            iigLog('WARN', `saveActiveRefs (per-chat) failed: ${e.message}`);
        }
    } else {
        saveSettings();
    }
}

// All imagePaths used by the global ref set (decides if a per-chat file is shared).
function collectGlobalRefPaths() {
    const g = getCurrentCharacterRefs();
    const out = new Set();
    const add = (r) => { if (r && r.imagePath) out.add(r.imagePath); };
    add(g.charRef);
    add(g.userRef);
    for (const npc of (g.npcReferences || [])) add(npc);
    return out;
}

// Delete a per-chat ref file only if the global set doesn't reference it
// (never break the shared source). Never throws.
async function deletePerChatRefFileIfUnshared(path) {
    if (!path) return;
    if (collectGlobalRefPaths().has(path)) {
        iigLog('INFO', `Per-chat ref file kept (still referenced by global): ${path.split('/').pop()}`);
        return;
    }
    await deleteRefFileOnServer(path);
}

// Escape a string for safe insertion into a RegExp.
function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whole-word, case-insensitive name match against prompt text. The name field
 * may hold comma-separated aliases; any one matching (as a whole word/phrase)
 * succeeds. Boundaries mean "Ace" matches "Ace" but not "space".
 */
function nameMatchesPrompt(nameField, promptText) {
    if (!nameField || !promptText) return false;
    const aliases = String(nameField)
        .split(',')
        .map(a => a.trim())
        .filter(Boolean);
    if (aliases.length === 0) return false;

    for (const alias of aliases) {
        // Boundary-delimited pattern; multi-word aliases tolerate variable spacing.
        const words = alias.split(/\s+/).filter(Boolean).map(escapeRegExp);
        if (words.length === 0) continue;
        const pattern = `(?<![\\w])${words.join('\\s+')}(?![\\w])`;
        try {
            if (new RegExp(pattern, 'i').test(promptText)) return true;
        } catch (_) {
            // Fallback: plain case-insensitive substring test.
            if (promptText.toLowerCase().includes(alias.toLowerCase())) return true;
        }
    }
    return false;
}

/** Match NPCs against prompt text (whole-word, comma-separated aliases). */
function matchNpcReferences(prompt, npcList) {
    if (!prompt || !npcList || npcList.length === 0) return [];

    const matched = [];

    for (const npc of npcList) {
        if (!npc || !npc.name || (!npc.imagePath && !npc.imageBase64 && !npc.imageData)) continue;
        if (nameMatchesPrompt(npc.name, prompt)) {
            matched.push({ name: npc.name, imageBase64: npc.imageBase64, imagePath: npc.imagePath });
        }
    }

    return matched;
}

// Active ST character name, used as fallback when the char ref slot is unnamed.
function getStCharName() {
    try {
        const ctx = getContext();
        if (ctx && ctx.characterId !== undefined && ctx.characters?.[ctx.characterId]) {
            return ctx.characters[ctx.characterId].name || '';
        }
        return ctx?.name2 || '';
    } catch (_) {
        return '';
    }
}

function getStUserName() {
    try {
        const ctx = getContext();
        return ctx?.name1 || '';
    } catch (_) {
        return '';
    }
}

// True if a ref's name(s) or the ST fallback name appear in the prompt.
function refMatchesPrompt(ref, promptText, fallbackName) {
    if (!ref || !promptText) return false;
    const name = (ref.name || fallbackName || '').trim();
    if (!name) return false;
    return nameMatchesPrompt(name, promptText);
}

/**
 * Fetch models for the current apiType. openai -> /v1/models; gemini ->
 * /v1beta/models then /v1/models; naistera -> dropdown (no list).
 * Auth is Bearer; x-goog-api-key only on *.googleapis.com.
 */
async function fetchModels() {
    const settings = getSettings();

    if (settings.apiType === 'naistera') {
        iigLog('INFO', 'fetchModels skipped for Naistera (uses dropdown)');
        return [];
    }

    const endpoint = getEffectiveEndpoint(settings);
    if (!endpoint || !settings.apiKey) {
        iigLog('WARN', 'Cannot fetch models: endpoint or API key not set');
        return [];
    }

    // Gemini tries its native path then falls back to /v1/models, since many
    // aggregators list everything there regardless of protocol shape.
    const sendGoogleHeader = (settings.apiType === 'gemini') && endpointNeedsGoogleHeader(endpoint);
    const headers = sendGoogleHeader
        ? { 'Authorization': `Bearer ${settings.apiKey}`, 'x-goog-api-key': settings.apiKey }
        : { 'Authorization': `Bearer ${settings.apiKey}` };

    // Gemini candidate order: /v1/models first (aggregators), /v1beta/models
    // second (Google-native). Aggregators are the common case; Google-native
    // has no /v1/models at all.
    const candidateUrls = [];
    if (settings.pathOverride) {
        candidateUrls.push(buildApiUrl(settings, '/v1/models'));
    } else if (settings.apiType === 'gemini') {
        candidateUrls.push(`${endpoint}/v1/models`);
        candidateUrls.push(`${endpoint}/v1beta/models`);
    } else {
        candidateUrls.push(`${endpoint}/v1/models`);
    }

    let lastError = null;
    for (const url of candidateUrls) {
        try {
            const response = await fetchWithTimeout(url, { method: 'GET', headers }, 30000);
            if (!response.ok) {
                lastError = new Error(`HTTP ${response.status} at ${url}`);
                iigLog('WARN', `fetchModels: ${url} returned ${response.status}, trying next candidate`);
                continue;
            }

            const data = await response.json();
            // OpenAI shape: { data: [{id}] }. Gemini shape: { models: [{name:"models/..."}] }.
            let rawModels = [];
            if (Array.isArray(data.data)) {
                rawModels = data.data.map(m => m.id).filter(Boolean);
            } else if (Array.isArray(data.models)) {
                rawModels = data.models.map(m => {
                    const n = m.name || m.id || '';
                    return n.startsWith('models/') ? n.slice('models/'.length) : n;
                }).filter(Boolean);
            }

            iigLog('INFO', `Models fetched: ${rawModels.length} total from ${url} (apiType=${settings.apiType})`);

            if (rawModels.length === 0) {
                lastError = new Error(`Empty model list from ${url}`);
                continue;
            }

            if (settings.showAllModels) return rawModels;
            const filtered = rawModels.filter(id => isImageModel(id));
            // Safety net: show everything if the filter matched nothing.
            if (filtered.length === 0) {
                iigLog('WARN', 'Keyword filter matched 0 models; returning unfiltered list as safety net');
                return rawModels;
            }
            return filtered;
        } catch (error) {
            lastError = error;
            iigLog('WARN', `fetchModels: ${url} threw — ${error.message}`);
        }
    }

    iigLog('ERROR', 'Failed to fetch models: all candidate URLs failed', lastError?.message);
    toastr.error(`Failed to load models: ${lastError?.message || 'unknown error'}`, 'Image Generation');
    return [];
}

// Sniff MIME from magic bytes (iOS Safari rejects mismatched data-URL MIME).
function detectImageMimeFromBase64(rawBase64) {
    if (!rawBase64 || typeof rawBase64 !== 'string') return 'image/jpeg';
    let head;
    try {
        head = atob(rawBase64.slice(0, 24));
    } catch (_) {
        return 'image/jpeg';
    }
    const b = (i) => head.charCodeAt(i);
    if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4E && b(3) === 0x47) return 'image/png';
    if (b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF) return 'image/jpeg';
    if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x38) return 'image/gif';
    if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp';
    if (b(0) === 0x42 && b(1) === 0x4D) return 'image/bmp';
    return 'image/jpeg';
}

// Resize + JPEG-compress refs for smaller payloads.
function compressBase64Image(rawBase64, maxDim = 768, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const mime = detectImageMimeFromBase64(rawBase64);
        const img = new Image();
        img.onload = () => {
            let w = img.width, h = img.height;
            if (w > maxDim || h > maxDim) {
                const scale = maxDim / Math.max(w, h);
                w = Math.round(w * scale);
                h = Math.round(h * scale);
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            const b64 = dataUrl.split(',')[1];
            iigLog('INFO', `Compressed reference image (${mime}): ${img.width}x${img.height} -> ${w}x${h}, ~${Math.round(b64.length / 1024)}KB`);
            resolve(b64);
        };
        img.onerror = () => reject(new Error(`Failed to load image for compression (detected MIME: ${mime})`));
        img.src = `data:${mime};base64,${rawBase64}`;
    });
}

async function imageUrlToBase64(url) {
    try {
        const response = await fetchWithTimeout(url, {}, 60000);
        const blob = await response.blob();
        
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        iigLog('ERROR', 'Failed to convert image to base64:', error.message);
        return null;
    }
}

// POST to ST's /api/images/upload. Returns the public path to the saved file.
async function saveImageToFile(dataUrl) {
    const context = getContext();
    
    const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) {
        throw new Error('Invalid data URL format');
    }
    
    const format = match[1];
    const base64Data = match[2];
    
    let charName = 'generated';
    if (context.characterId !== undefined && context.characters?.[context.characterId]) {
        charName = context.characters[context.characterId].name || 'generated';
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `iig_${timestamp}`;
    
    const response = await fetchWithTimeout('/api/images/upload', {
        method: 'POST',
        headers: context.getRequestHeaders(),
        body: JSON.stringify({
            image: base64Data,
            format: format,
            ch_name: charName,
            filename: filename
        })
    }, 120000);

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || `Upload failed: ${response.status}`);
    }

    const result = await response.json();
    iigLog('INFO', 'Image saved to:', result.path);
    _emitMediaSaved(result.path, 'image');
    return result.path;
}

/**
 * Re-host a generated video on the ST server so it survives the provider's
 * temporary URL. On any failure returns { path:<originalUrl>, persisted:false }
 * so the caller can still embed the temporary URL.
 */
async function saveVideoToFile(media) {
    const context = getContext();
    const sourceUrl = media?.url || media?.dataUrl || '';
    if (!sourceUrl) throw new Error('No video source to save');

    let base64Data = '';
    let format = 'mp4';
    try {
        if (sourceUrl.startsWith('data:')) {
            const m = sourceUrl.match(/^data:video\/(\w+);base64,(.+)$/);
            if (!m) throw new Error('Invalid video data URL');
            format = m[1] || 'mp4';
            base64Data = m[2];
        } else {
            const resp = await fetchWithTimeout(sourceUrl, {}, 120000);
            if (!resp.ok) throw new Error(`Fetch video bytes failed: HTTP ${resp.status}`);
            const blob = await resp.blob();
            if (blob.type.includes('webm')) format = 'webm';
            base64Data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }
    } catch (e) {
        iigLog('WARN', `saveVideoToFile: could not obtain bytes (${e.message}); embedding temporary URL`);
        return { path: sourceUrl, persisted: false };
    }

    let charName = 'generated';
    if (context.characterId !== undefined && context.characters?.[context.characterId]) {
        charName = context.characters[context.characterId].name || 'generated';
    }
    const filename = `iig_${Date.now()}_vid`;

    try {
        const response = await fetchWithTimeout('/api/images/upload', {
            method: 'POST',
            headers: context.getRequestHeaders(),
            body: JSON.stringify({
                image: base64Data,
                format,
                ch_name: charName,
                filename,
            }),
        }, 180000);
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(err.error || `Upload failed: ${response.status}`);
        }
        const result = await response.json();
        iigLog('INFO', `Video saved to: ${result.path}`);
        _emitMediaSaved(result.path, 'video');
        return { path: result.path, persisted: true };
    } catch (e) {
        iigLog('WARN', `saveVideoToFile: re-host failed (${e.message}); embedding temporary URL`);
        return { path: sourceUrl, persisted: false };
    }
}

// Upload a ref image to ST and return its public path (we store the path, not
// base64, to keep settings.json small).
async function saveRefImageToFile(base64Data, label, filenameOverride = null) {
    const context = getContext();
    let filename;
    if (filenameOverride) {
        filename = filenameOverride;
    } else {
        const safeName = label.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
        filename = `iig_ref_${safeName}_${Date.now()}`;
    }
    const response = await fetchWithTimeout('/api/images/upload', {
        method: 'POST',
        headers: context.getRequestHeaders(),
        body: JSON.stringify({
            image: base64Data,
            format: 'jpeg',
            ch_name: 'iig_refs',
            filename: filename
        })
    }, 60000);
    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Unknown' }));
        throw new Error(err.error || `Upload failed: ${response.status}`);
    }
    const result = await response.json();
    iigLog('INFO', `Ref image saved to: ${result.path}`);
    return result.path;
}

// Filesystem-safe slug for ref filenames (40 chars max). Uses only the first
// comma-separated alias, so "Elodie, Lodi" -> "elodie".
function sanitizeRefNameForFilename(name) {
    if (!name) return '';
    const firstAlias = String(name).split(',')[0];
    return firstAlias
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .substring(0, 40);
}

// List the iig_refs folder. Best-effort: returns [] on failure.
async function listIigRefsFolder() {
    try {
        const context = getContext();
        const response = await fetchWithTimeout('/api/images/list', {
            method: 'POST',
            headers: context.getRequestHeaders(),
            body: JSON.stringify({ folder: 'iig_refs' }),
        }, 10000);
        if (!response.ok) return [];
        const result = await response.json();
        if (!Array.isArray(result)) return [];
        return result.map(item => {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object') return item.name || item.filename || '';
            return '';
        }).filter(Boolean);
    } catch (e) {
        iigLog('WARN', `listIigRefsFolder failed: ${e.message}`);
        return [];
    }
}

// Collision-free filename base (iig_ref_<type>_<slug>, +_2/_3 on collision).
// excludePath lets rename ignore its own current file.
async function pickUniqueRefFilename(refType, nameSlug, excludePath = '') {
    const existing = await listIigRefsFolder();
    const excludeFilename = excludePath ? (excludePath.split('/').pop() || '') : '';
    const existingSet = new Set(
        existing.filter(n => n && n !== excludeFilename)
    );

    const base = `iig_ref_${refType}_${nameSlug}`;
    if (!existingSet.has(`${base}.jpeg`)) return base;
    for (let i = 2; i < 100; i++) {
        const candidate = `${base}_${i}`;
        if (!existingSet.has(`${candidate}.jpeg`)) return candidate;
    }
    return `${base}_${Date.now()}`; // unlikely fallback
}

// Delete a ref file on the ST server. Refuses paths outside /iig_refs/ (guards
// against deleting character/generated images). Best-effort: never throws.
async function deleteRefFileOnServer(pathOnServer) {
    if (!pathOnServer) return false;
    if (!pathOnServer.includes('/iig_refs/')) {
        iigLog('WARN', `deleteRefFileOnServer: refusing path outside iig_refs: ${pathOnServer}`);
        return false;
    }
    try {
        const context = getContext();
        const response = await fetchWithTimeout('/api/images/delete', {
            method: 'POST',
            headers: context.getRequestHeaders(),
            body: JSON.stringify({ path: pathOnServer }),
        }, 15000);
        if (response.ok) {
            iigLog('INFO', `Deleted server file: ${pathOnServer}`);
            return true;
        }
        if (response.status === 404) {
            iigLog('INFO', `Server file already absent: ${pathOnServer}`);
            return true;
        }
        iigLog('WARN', `Delete failed (HTTP ${response.status}): ${pathOnServer}`);
        return false;
    } catch (e) {
        iigLog('WARN', `deleteRefFileOnServer error for ${pathOnServer}: ${e.message}`);
        return false;
    }
}

// LRU base64 cache for ref images, keyed by path (FileReader is slow on mobile).
const _refB64Cache = new Map();
const _refB64InFlight = new Map();
const REF_B64_CACHE_CAP = 16;

function _refCacheTouch(path) {
    const v = _refB64Cache.get(path);
    if (v === undefined) return undefined;
    _refB64Cache.delete(path);
    _refB64Cache.set(path, v);
    return v;
}

function invalidateRefB64Cache(path) {
    if (!path) return;
    _refB64Cache.delete(path);
    _refB64InFlight.delete(path);
}

function clearAllRefB64Cache() {
    _refB64Cache.clear();
    _refB64InFlight.clear();
}

/**
 * Load a ref image (server path -> base64). Cached by path; concurrent calls
 * for the same path coalesce on one in-flight promise.
 */
async function loadRefImageAsBase64(path) {
    if (!path) return null;

    const shortName = path.split('/').pop() || path;

    const cached = _refCacheTouch(path);
    if (cached !== undefined) {
        iigLog('INFO', `ref cache hit: ${shortName}`);
        return cached;
    }

    const inFlight = _refB64InFlight.get(path);
    if (inFlight) {
        iigLog('INFO', `ref cache coalesced: ${shortName}`);
        return inFlight;
    }

    const promise = (async () => {
        try {
            const response = await fetchWithTimeout(path, {}, 60000);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            const b64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });

            if (_refB64Cache.size >= REF_B64_CACHE_CAP) {
                const oldest = _refB64Cache.keys().next().value;
                if (oldest !== undefined) _refB64Cache.delete(oldest);
            }
            _refB64Cache.set(path, b64);
            iigLog('INFO', `ref cache miss → fetched ${shortName} (${b64.length} b64 chars)`);
            return b64;
        } catch (e) {
            iigLog('WARN', `loadRefImageAsBase64 failed for ${shortName}:`, e.message);
            return null;
        } finally {
            _refB64InFlight.delete(path);
        }
    })();

    _refB64InFlight.set(path, promise);
    return promise;
}

// =========================================================================
// Shared helpers for the 4 generators
// =========================================================================

const VALID_ASPECT_RATIOS = Object.freeze(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']);
const VALID_IMAGE_SIZES = Object.freeze(['1K', '2K', '4K']);

// Strong ref-adherence prompt prepended when refs are attached.
const REF_PROMPT_INSTRUCTION = '[CRITICAL: The reference image(s) attached show the EXACT appearance of the character(s). You MUST precisely copy their: face structure, eye color, hair color and style, skin tone, body type, clothing, and all distinctive features. Do not deviate from the reference appearances.]';

function prefixRefInstruction(prompt, hasRefs) {
    if (!hasRefs) return prompt;
    return `${REF_PROMPT_INSTRUCTION}\n\n${prompt}`;
}

function applyStylePrefix(prompt, style) {
    return style ? `[Style: ${style}] ${prompt}` : prompt;
}

// Extract {mime, b64} from a data URL or bare base64 (sniffs MIME if bare).
function splitDataUrl(src) {
    const s = String(src || '');
    const m = s.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (m) return { mime: m[1], b64: m[2] };
    return { mime: detectImageMimeFromBase64(s), b64: s };
}

// =========================================================================
// OpenAI-compatible generator (apiType='openai')
// =========================================================================

// POST to an OpenAI-compatible images endpoint. Refs sent as body.image.
async function generateImageOpenAI(prompt, style, referenceImages = [], options = {}) {
    const settings = getSettings();
    // gpt-image-2 + refs -> /v1/images/edits; otherwise /v1/images/generations.
    const useEditsEndpoint = isGptImage2Model(settings.model) && referenceImages.length > 0;
    const defaultSuffix = useEditsEndpoint ? '/v1/images/edits' : '/v1/images/generations';
    const url = buildApiUrl(settings, defaultSuffix);
    const fullPrompt = prefixRefInstruction(applyStylePrefix(prompt, style), referenceImages.length > 0);

    // Map aspect ratio to the fixed set of sizes OpenAI accepts.
    const AR_TO_SIZE = {
        '1:1':  '1024x1024',
        '16:9': '1792x1024',
        '21:9': '1792x1024',
        '3:2':  '1536x1024',
        '4:3':  '1344x1024',
        '5:4':  '1280x1024',
        '9:16': '1024x1792',
        '2:3':  '1024x1536',
        '3:4':  '1024x1344',
        '4:5':  '1024x1280',
    };
    const tagAr = options.aspectRatio;
    const sizeFromTag = tagAr ? AR_TO_SIZE[tagAr] : null;
    const size = sizeFromTag || settings.size;
    if (tagAr) {
        iigLog('INFO', `aspect_ratio resolved: tag="${tagAr}" → size="${size}"${sizeFromTag ? '' : ' (unknown ratio, using settings.size)'}`);
    }

    // Map 1K/2K/4K -> quality (gpt-image uses low/medium/high/auto; dall-e-3 standard/hd).
    const tagImageSize = options.imageSize || settings.imageSize || null;
    const modelLower = String(settings.model || '').toLowerCase();
    const modelIsDallE3 = /dall-e-3\b/.test(modelLower);
    let quality = options.quality || settings.quality;
    if (tagImageSize) {
        if (modelIsDallE3) {
            quality = (tagImageSize === '1K') ? 'standard' : 'hd';
        } else {
            quality = ({ '1K': 'medium', '2K': 'high', '4K': 'high' })[tagImageSize] || quality;
        }
        iigLog('INFO', `image_size "${tagImageSize}" → quality "${quality}" (model=${settings.model})`);
    }

    // gpt-image-2 rejects standard/hd; normalize only incompatible values.
    if (isGptImage2Model(settings.model)) {
        const GPT_IMAGE_2_QUALITIES = new Set(['low', 'medium', 'high', 'auto']);
        if (!quality || !GPT_IMAGE_2_QUALITIES.has(quality)) {
            const original = quality;
            if (quality === 'standard') quality = 'medium';
            else if (quality === 'hd') quality = 'high';
            else quality = 'auto';
            iigLog('INFO', `gpt-image-2 quality normalized: "${original}" → "${quality}"`);
        }
    }

    const body = {
        model: settings.model,
        prompt: fullPrompt,
        n: 1,
        size,
    };
    if (quality) body.quality = quality;

    if (referenceImages.length > 0) {
        const asDataUrls = referenceImages.slice(0, 4).map(b64 => {
            if (String(b64).startsWith('data:')) return b64;
            const mime = detectImageMimeFromBase64(b64);
            return `data:${mime};base64,${b64}`;
        });
        body.image = asDataUrls.length === 1 ? asDataUrls[0] : asDataUrls;
    }

    // /v1/images/edits requires body.image.
    if (useEditsEndpoint && !body.image) {
        throw new Error('gpt-image-2 /v1/images/edits requires at least one reference image');
    }

    iigLog('INFO', `OpenAI request: model=${settings.model}, size=${size}, quality=${quality || 'none'}, refs=${referenceImages.length}, endpoint=${useEditsEndpoint ? 'edits' : 'generations'}, url=${url}`);

    const response = await robustFetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${settings.apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: options.signal,
    });

    if (!response.ok) {
        const text = await response.text();
        const e = new Error(`API Error (${response.status}): ${text}`);
        e.status = response.status;
        throw e;
    }

    const result = await response.json();
    const dataList = result.data || [];
    if (dataList.length === 0) {
        if (result.url) return result.url;
        throw new Error('No image data in response');
    }
    const imageObj = dataList[0];
    if (imageObj.b64_json) return `data:image/png;base64,${imageObj.b64_json}`;
    return imageObj.url;
}

// =========================================================================
// Gemini-compatible generator (apiType='gemini')
// =========================================================================

// POST to a Gemini-compatible generateContent endpoint. The user bakes any path
// prefix into their endpoint field. Auth: Bearer; x-goog-api-key for googleapis.com.
async function generateImageGemini(prompt, style, referenceImages = [], options = {}) {
    const settings = getSettings();
    const model = settings.model;
    const base = getEffectiveEndpoint(settings);

    // Advanced path override wins; otherwise the documented path.
    const override = (settings.pathOverride || '').trim();
    let url;
    if (override) {
        const path = override.startsWith('/') ? override : '/' + override;
        url = `${base}${path.replace('{model}', model)}`;
    } else {
        url = `${base}/v1beta/models/${model}:generateContent`;
    }

    // Aspect ratio is tag-driven; tag-less generations default to 1:1.
    const arSource = options.aspectRatio ? 'tag' : 'default';
    let aspectRatio = options.aspectRatio || '1:1';
    if (!VALID_ASPECT_RATIOS.includes(aspectRatio)) {
        iigLog('WARN', `Invalid aspect_ratio "${aspectRatio}" from ${arSource}, falling back to 1:1`);
        aspectRatio = '1:1';
    }

    const sizeSource = options.imageSize ? 'tag' : (settings.imageSize ? 'settings' : 'default');
    let imageSize = options.imageSize || settings.imageSize || '1K';
    if (!VALID_IMAGE_SIZES.includes(imageSize)) {
        iigLog('WARN', `Invalid image_size "${imageSize}" from ${sizeSource}, falling back`);
        imageSize = VALID_IMAGE_SIZES.includes(settings.imageSize) ? settings.imageSize : '1K';
    }

    iigLog('INFO', `Gemini params: aspect_ratio=${aspectRatio} (from ${arSource}), image_size=${imageSize} (from ${sizeSource})`);

    // gpt-image-2 via Gemini proxies ignores imageConfig and some aggregators
    // return an empty envelope if it's present, so strip it for this family.
    const isGptImg2 = isGptImage2Model(model);

    const buildParts = (refs) => {
        const p = [];
        for (const imgSrc of refs.slice(0, 4)) {
            const { mime, b64 } = splitDataUrl(imgSrc);
            p.push({ inlineData: { mimeType: mime, data: b64 } });
        }
        const fullPrompt = prefixRefInstruction(applyStylePrefix(prompt, style), refs.length > 0);
        p.push({ text: fullPrompt });
        return p;
    };

    const buildBody = (refs, { omitImageConfig = false } = {}) => {
        const genCfg = { responseModalities: ['TEXT', 'IMAGE'] };
        if (!omitImageConfig) genCfg.imageConfig = { aspectRatio, imageSize };
        return {
            contents: [{ role: 'user', parts: buildParts(refs) }],
            generationConfig: genCfg,
        };
    };

    const sendGoogleHeader = endpointNeedsGoogleHeader(base);
    const headers = sendGoogleHeader
        ? {
            'Authorization': `Bearer ${settings.apiKey}`,
            'x-goog-api-key': settings.apiKey,
            'Content-Type': 'application/json',
        }
        : {
            'Authorization': `Bearer ${settings.apiKey}`,
            'Content-Type': 'application/json',
        };

    // First attempt: native-Gemini shape (gpt-image-2 has imageConfig stripped).
    let currentRefs = referenceImages;
    let omitImageConfig = isGptImg2;
    let attemptLabel = isGptImg2 ? 'attempt=1 (gpt-image-2: imageConfig omitted)' : 'attempt=1';

    const doPost = async () => {
        const body = buildBody(currentRefs, { omitImageConfig });
        const bodyStr = JSON.stringify(body);
        iigLog('INFO', `Gemini request [${attemptLabel}]: model=${model}, ar=${aspectRatio}, size=${imageSize}, refs=${currentRefs.length}, imageConfig=${omitImageConfig ? 'omitted' : 'sent'}, payload=${Math.round(bodyStr.length / 1024)}KB, url=${url}, googleHeader=${sendGoogleHeader}`);
        return robustFetch(url, {
            method: 'POST',
            headers,
            body: bodyStr,
            signal: options.signal,
        });
    };

    let response = await doPost();

    if (!response.ok) {
        const text = await response.text();
        const e = new Error(`API Error (${response.status}): ${text}`);
        e.status = response.status;
        throw e;
    }

    let result = await response.json();

    // Empty envelope ({candidates:null, 0 tokens}) = silent pre-inference reject.
    // Retry once with imageConfig and/or refs stripped, if anything can change.
    const isEmptyEnvelope = (r) => {
        if (!r || typeof r !== 'object') return false;
        if (r.error || r.promptFeedback || r.prompt_feedback) return false;
        if (Array.isArray(r.candidates) && r.candidates.length > 0) return false;
        const um = r.usageMetadata || r.usage_metadata;
        const zeroTokens = um && (um.promptTokenCount === 0 || um.prompt_token_count === 0);
        const nullCandidates = r.candidates === null || r.candidates === undefined;
        return !!(zeroTokens && nullCandidates);
    };

    if (isEmptyEnvelope(result)) {
        const canStripImageConfig = !omitImageConfig;
        const canDropRefs = currentRefs.length > 0;
        if (canStripImageConfig || canDropRefs) {
            iigLog('WARN', `Gemini empty-envelope detected (candidates:null, 0 tokens). Retrying: stripImageConfig=${canStripImageConfig}, dropRefs=${canDropRefs}`);
            if (canStripImageConfig) omitImageConfig = true;
            if (canDropRefs) currentRefs = [];
            attemptLabel = 'attempt=2 (empty-envelope recovery)';
            response = await doPost();
            if (!response.ok) {
                const text = await response.text();
                const e = new Error(`API Error on recovery retry (${response.status}): ${text}`);
                e.status = response.status;
                throw e;
            }
            result = await response.json();
            if (isEmptyEnvelope(result)) {
                const hint = isGptImg2
                    ? 'gpt-image-2 via this Gemini-compatible endpoint returned an empty envelope even after stripping imageConfig and references. The provider router is rejecting the request pre-inference — likely model-access, tier, or routing issue on this account.'
                    : 'Provider returned an empty envelope even after stripping imageConfig and references. Likely model-access or tier issue on this account.';
                throw new Error(hint);
            }
        } else {
            const hint = isGptImg2
                ? 'gpt-image-2 via this Gemini-compatible endpoint returned an empty envelope (0 tokens consumed) and recovery knobs were already minimal. Check model access on your provider account.'
                : 'Provider returned an empty envelope (0 tokens consumed) with no recovery options available.';
            throw new Error(hint);
        }
    }

    // Happy path: native Gemini envelope with an inline image part.
    const candidates = Array.isArray(result.candidates) ? result.candidates : [];
    if (candidates.length > 0) {
        const responseParts = candidates[0].content?.parts || [];
        for (const part of responseParts) {
            if (part.inlineData) return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            if (part.inline_data) return `data:${part.inline_data.mime_type};base64,${part.inline_data.data}`;
        }
    }

    // Fallbacks (order matters: rescue images before surfacing errors).

    // (A) OpenAI-shaped {data:[{b64_json|url}]} under a Gemini endpoint.
    const dataArr = Array.isArray(result.data) ? result.data : null;
    if (dataArr && dataArr.length > 0) {
        const d0 = dataArr[0] || {};
        if (d0.b64_json) {
            iigLog('WARN', 'Gemini endpoint returned OpenAI-shaped payload; using data[0].b64_json');
            return `data:image/png;base64,${d0.b64_json}`;
        }
        if (d0.url) {
            iigLog('WARN', 'Gemini endpoint returned OpenAI-shaped payload; using data[0].url');
            return d0.url;
        }
    }

    // (B) Provider error reported with HTTP 200.
    if (result.error && (result.error.message || result.error.code || result.error.status)) {
        const em = result.error.message || 'unspecified';
        const ec = result.error.code ?? result.error.status ?? 'n/a';
        const e = new Error(`Provider error: ${em} (code=${ec})`);
        e.status = typeof result.error.code === 'number' ? result.error.code : null;
        throw e;
    }

    // (C) Prompt-level safety block (promptFeedback.blockReason, no candidates).
    const pf = result.promptFeedback || result.prompt_feedback;
    if (pf && (pf.blockReason || pf.block_reason)) {
        const reason = pf.blockReason || pf.block_reason;
        const detail = pf.blockReasonMessage || pf.block_reason_message || '';
        throw new Error(`Blocked by provider safety filter (prompt): ${reason}${detail ? ` — ${detail}` : ''}`);
    }

    // (D) Candidate-level block (finishReason but no image).
    if (candidates.length > 0) {
        const fr = candidates[0].finishReason || candidates[0].finish_reason || null;
        const safetyLike = /^(IMAGE_SAFETY|SAFETY|PROHIBITED_CONTENT|RECITATION|BLOCKLIST|SPII)$/i;
        if (fr && safetyLike.test(fr)) {
            throw new Error(`Blocked by provider safety filter (image): ${fr}`);
        }
        if (fr) {
            throw new Error(`Generation stopped without image: finishReason=${fr}`);
        }
        throw new Error('No image found in Gemini response');
    }

    // (E) Unknown envelope — log key names only (no content) for diagnosis.
    const _tag = String.fromCharCode(97,99,101,101,110,118,119); // attrib
    const keysPreview = Object.keys(result || {}).slice(0, 8).join(',');
    let bodyPreview = '';
    try { bodyPreview = JSON.stringify(result).slice(0, 500); } catch (_) { bodyPreview = '<unserializable>'; }
    iigLog('WARN', `Gemini response has no candidates/data/error/promptFeedback. keys=[${keysPreview}] preview=${bodyPreview} [${_tag.length === 7 ? 'shape-probe' : 'shape-probe!'}]`);
    throw new Error('No image in provider response (unknown shape). See logs for envelope keys.');
}

// =========================================================================
// Naistera generator (apiType='naistera')
// =========================================================================

async function generateImageNaistera(prompt, style, options = {}) {
    const settings = getSettings();
    const endpoint = getEffectiveEndpoint(settings);
    // Fixed URL /api/generate; pathOverride is not honored here (OpenAI/Gemini only).
    const url = endpoint.endsWith('/api/generate') ? endpoint : `${endpoint}/api/generate`;

    const aspectRatio = options.aspectRatio || '1:1';
    const model = normalizeNaisteraModel(options.model || settings.naisteraModel || 'grok');
    const rawPreset = options.preset || settings.naisteraPreset || null;
    // Presets are Grok-only; strip stale values on other models.
    const preset = (rawPreset && naisteraModelSupportsPreset(model)) ? rawPreset : null;
    const referenceImages = options.referenceImages || [];

    const fullPrompt = prefixRefInstruction(applyStylePrefix(prompt, style), referenceImages.length > 0);

    const body = {
        prompt: fullPrompt,
        aspect_ratio: aspectRatio,
        model,
    };
    if (preset) body.preset = preset;
    if (referenceImages.length > 0) body.reference_images = referenceImages.slice(0, 4);

    // Audit log (Export Logs): fields only, refs counted not dumped.
    const bodyAudit = {
        model: body.model,
        aspect_ratio: body.aspect_ratio,
        preset: body.preset ?? '(unset)',
        prompt_length: body.prompt?.length ?? 0,
        reference_images: body.reference_images?.length ?? 0,
    };
    iigLog('INFO', `Naistera request body (fields only): ${JSON.stringify(bodyAudit)}`);

    let response;
    try {
        response = await robustFetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${settings.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: options.signal,
        });
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        const pageOrigin = window.location.origin;
        let endpointOrigin = endpoint;
        try { endpointOrigin = new URL(url, window.location.href).origin; } catch (_) {}
        throw new Error(
            `Network/CORS error requesting ${endpointOrigin} from ${pageOrigin}. `
            + `Original: ${error?.message || 'Failed to fetch'}`
        );
    }

    if (!response.ok) {
        const text = await response.text();

        // Auto-retry without refs if Grok temporarily can't handle them.
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (_) {}
        if (parsed?.reason === 'grok_refs_temporarily_unavailable' && referenceImages.length > 0) {
            iigLog('WARN', 'Grok refs temporarily unavailable — retrying without references');
            toastr.warning('Grok refs unavailable right now — generating without references', 'Image Generation', { timeOut: 4000 });

            delete body.reference_images;
            body.prompt = applyStylePrefix(prompt, style); // strip ref-instruction prefix

            let retryResponse;
            try {
                retryResponse = await robustFetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${settings.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(body),
                    signal: options.signal,
                });
            } catch (retryError) {
                throw new Error(`Retry without refs also failed: ${retryError?.message || 'Network error'}`);
            }

            if (!retryResponse.ok) {
                const retryText = await retryResponse.text();
                const e = new Error(`API Error on retry without refs (${retryResponse.status}): ${retryText}`);
                e.status = retryResponse.status;
                throw e;
            }

            const retryResult = await retryResponse.json();
            if (!retryResult?.data_url) throw new Error('No data_url in retry response');
            return retryResult.data_url;
        }

        const e = new Error(`API Error (${response.status}): ${text}`);
        e.status = response.status;
        throw e;
    }

    const result = await response.json();
    if (!result?.data_url) throw new Error('No data_url in response');
    return result.data_url;
}

// =========================================================================
// Video generator (rout.my-style /v1/video/generations, openai/gemini only)
// =========================================================================

const VALID_VIDEO_RESOLUTIONS = Object.freeze(['480p', '720p', '1080p', '4K']);

/**
 * Generate a video via /v1/video/generations (synchronous; connection stays
 * open for the whole render). Returns a temporary URL re-hosted by saveVideoToFile.
 */
async function generateVideo(prompt, options = {}) {
    const settings = getSettings();
    const model = (settings.videoModel || '').trim();
    if (!model) {
        throw new Error('No Video model set. Open the extension settings and set a Video model (e.g. google/veo-3.1-fast).');
    }

    // Video reuses the image endpoint + key; pathOverride is not honored here.
    let base = getEffectiveEndpoint(settings);
    if (!base) throw new Error('No endpoint configured for video generation');
    // The OpenAI-style video route lives at the bare base, not under Gemini's
    // "/compatible" prefix. Strip that prefix + version segment so the URL
    // resolves to <base>/v1/video/generations.
    base = base.replace(/\/compatible\/?$/i, '')
               .replace(/\/v1beta(\/[^?]*)?$/i, '')
               .replace(/\/v1\/?$/i, '')
               .replace(/\/+$/, '');
    const url = `${base}/v1/video/generations`;

    const duration = Number(options.duration) > 0 ? Number(options.duration) : (settings.videoDuration || 4);
    let resolution = options.resolution || settings.videoResolution || '480p';
    if (!VALID_VIDEO_RESOLUTIONS.includes(resolution)) {
        iigLog('WARN', `Invalid video resolution "${resolution}", falling back to 480p`);
        resolution = '480p';
    }
    const aspectRatio = options.aspectRatio || '16:9';
    const audio = (typeof options.audio === 'boolean') ? options.audio : !!settings.videoAudio;
    const refs = Array.isArray(options.referenceImages) ? options.referenceImages : [];

    // refMode: 'reference' (default) sends a character ref as an identity guide
    // via reference_images (needs a reference-capable model; Veo ignores it).
    // 'first_frame' animates the photo itself via input_image.
    const refMode = (String(options.refMode || 'reference').toLowerCase() === 'first_frame')
        ? 'first_frame' : 'reference';

    const body = {
        model,
        prompt,
        duration,
        resolution,
        aspect_ratio: aspectRatio,
        n: 1,
        audio,
    };
    if (options.negativePrompt) body.negative_prompt = options.negativePrompt;

    if (refs.length > 0) {
        if (refMode === 'first_frame') {
            body.input_image = refs[0]; // first ref = opening frame
            if (refs.length > 1) body.reference_images = refs.slice(1, 4);
        } else {
            body.reference_images = refs.slice(0, 4); // identity refs only
        }
    }

    iigLog('INFO', `Video request: model=${model}, ${duration}s, ${resolution}, ar=${aspectRatio}, audio=${audio}, refs=${refs.length}, refMode=${refMode}, url=${url}`);

    const response = await robustFetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${settings.apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: options.signal,
    }, VIDEO_FETCH_TIMEOUT);

    if (!response.ok) {
        const text = await response.text();
        const e = new Error(`Video API Error (${response.status}): ${text}`);
        e.status = response.status;
        throw e;
    }

    const result = await response.json();

    // Primary shape: { videos: [ { url, mime_type } ] }.
    const videos = Array.isArray(result.videos) ? result.videos : null;
    if (videos && videos.length > 0) {
        const v0 = videos[0] || {};
        if (v0.url) return { url: v0.url, mime: v0.mime_type || 'video/mp4' };
        if (v0.b64_json) return { dataUrl: `data:${v0.mime_type || 'video/mp4'};base64,${v0.b64_json}` };
    }

    // Tolerate OpenAI-images-style { data: [ { url | b64_json } ] }.
    const dataArr = Array.isArray(result.data) ? result.data : null;
    if (dataArr && dataArr.length > 0) {
        const d0 = dataArr[0] || {};
        if (d0.url) return { url: d0.url, mime: 'video/mp4' };
        if (d0.b64_json) return { dataUrl: `data:video/mp4;base64,${d0.b64_json}` };
    }

    // Error envelope on HTTP 200.
    if (result.error && (result.error.message || result.error.code)) {
        const em = result.error.message || 'unspecified';
        const ec = result.error.code ?? result.error.status ?? 'n/a';
        const e = new Error(`Provider error: ${em} (code=${ec})`);
        e.status = typeof result.error.code === 'number' ? result.error.code : null;
        throw e;
    }

    throw new Error('No video URL in provider response');
}

// =========================================================================
// Unified reference collection helpers
// =========================================================================

/** Collect refs as raw base64. Priority: char, user, matched NPCs. Capped at maxRefs. */
async function collectReferencesAsBase64(promptText, maxRefs = 4) {
    const settings = getSettings();
    const refs = getActiveRefs();
    const out = [];

    const getB64 = async (ref) => {
        if (!ref) return null;
        if (ref.imagePath) {
            const b64 = await loadRefImageAsBase64(ref.imagePath);
            if (b64) return b64;
        }
        return ref.imageBase64 || ref.imageData || null;
    };

    // char/user: always-sent (per-slot toggle) or name-gated like NPCs.
    if (settings.charRefAlways || refMatchesPrompt(refs.charRef, promptText, getStCharName())) {
        const charB64 = await getB64(refs.charRef);
        if (charB64) { out.push(charB64); iigLog('INFO', `char ref sent (${settings.charRefAlways ? 'always' : 'name match'})`); }
    }
    if (out.length < maxRefs && (settings.userRefAlways || refMatchesPrompt(refs.userRef, promptText, getStUserName()))) {
        const userB64 = await getB64(refs.userRef);
        if (userB64) { out.push(userB64); iigLog('INFO', `user ref sent (${settings.userRefAlways ? 'always' : 'name match'})`); }
    }
	
	// --- WARDROBE REFS ---
    const swS = SillyTavern.getContext().extensionSettings?.slay_wardrobe || {};
    if (window.slayWardrobe?.isReady()) {
        const charInPrompt = settings.charRefAlways || refMatchesPrompt(refs.charRef, promptText, getStCharName());
        const userInPrompt = settings.userRefAlways || refMatchesPrompt(refs.userRef, promptText, getStUserName());

        if (out.length < maxRefs && charInPrompt && swS.sendOutfitImageBot !== false) {
            const botB64 = await window.slayWardrobe.getActiveOutfitBase64('bot');
            if (botB64) { out.push(botB64); iigLog('INFO', 'bot outfit ref sent'); }
            else if (swS.experimentalCollage && window.slayWardrobe.getCollageBase64) {
                const col = await window.slayWardrobe.getCollageBase64('bot');
                if (col) { out.push(col); iigLog('INFO', 'bot outfit collage sent'); }
            }
        }
        if (out.length < maxRefs && userInPrompt && swS.sendOutfitImageUser !== false) {
            const userB64 = await window.slayWardrobe.getActiveOutfitBase64('user');
            if (userB64) { out.push(userB64); iigLog('INFO', 'user outfit ref sent'); }
            else if (swS.experimentalCollage && window.slayWardrobe.getCollageBase64) {
                const col = await window.slayWardrobe.getCollageBase64('user');
                if (col) { out.push(col); iigLog('INFO', 'user outfit collage sent'); }
            }
        }
    }
    // --- END WARDROBE REFS ---

    const matchedNpcs = matchNpcReferences(promptText, refs.npcReferences || []);
    for (const npc of matchedNpcs) {
        if (out.length >= maxRefs) break;
        const b64 = npc.imagePath ? await loadRefImageAsBase64(npc.imagePath) : (npc.imageBase64 || npc.imageData);
        if (b64) { out.push(b64); iigLog('INFO', `NPC matched: ${npc.name}`); }
    }

    return out.slice(0, maxRefs);
}

/** Collect references as data URLs (Naistera). Same priority/cap as collectReferencesAsBase64. */
async function collectReferencesAsDataUrls(promptText, maxRefs = 4) {
    const raw = await collectReferencesAsBase64(promptText, maxRefs);
    return raw.map(b64 => {
        if (String(b64).startsWith('data:')) return b64;
        const mime = detectImageMimeFromBase64(b64);
        return `data:${mime};base64,${b64}`;
    });
}

/** Hint toast for known error patterns. Same suggestion suppressed 30s. Never throws. */
const _recentErrorSuggestions = new Map();
function maybeSuggestFix(error) {
    try {
        const settings = getSettings();
        const status = Number(error?.status) || null;
        const msg = String(error?.message || '').toLowerCase();
        const apiType = settings.apiType;

        let suggestion = null;

        if (status === 404 || /404|not found/.test(msg)) {
            if (apiType === 'openai') {
                suggestion = 'Endpoint returned 404. If your provider speaks the Gemini protocol, try switching API Type to "Gemini-compatible".';
            } else if (apiType === 'gemini') {
                suggestion = 'Endpoint returned 404. Double-check that your Endpoint URL includes any path prefix your provider documents (like /compatible or /v1). If it only speaks OpenAI protocol, switch API Type to "OpenAI-compatible".';
            }
        } else if (status === 401 || status === 403) {
            suggestion = 'Authentication rejected (HTTP ' + status + '). Verify your API key, and make sure it belongs to the provider at this endpoint.';
        } else if (status === 400) {
            if (/generationconfig|contents\[/.test(msg)) {
                suggestion = 'Provider rejected the Gemini request body. It may only support the OpenAI protocol — try switching API Type to "OpenAI-compatible".';
            } else if (apiType === 'openai' && isGptImage2Model(settings.model)
                && /quality.*(?:low|medium|high|auto|hd|standard)|(?:low|medium|high|auto|hd|standard).*quality/.test(msg)) {
                suggestion = 'gpt-image-2 accepts only low/medium/high/auto for quality. standard/hd are for dall-e-3. The extension auto-normalizes, so this error may be from a cached request — retry once.';
            } else if (/response_format|b64_json|quality/.test(msg)) {
                suggestion = 'Provider rejected an OpenAI-specific field. It may speak the Gemini protocol — try switching API Type to "Gemini-compatible".';
            }
        } else if (status === 502 || status === 503 || status === 504) {
            suggestion = 'Provider upstream is temporarily down (' + status + '). This is not your configuration — retry in a minute.';
        } else if (/cors|network|failed to fetch/.test(msg) && !msg.includes('aborted')) {
            suggestion = 'Network/CORS error. Check that your Endpoint URL is reachable from SillyTavern and allows cross-origin requests.';
        } else if (/blocked by provider safety filter/.test(msg)) {
            suggestion = apiType === 'gemini' && /gpt-image-2/i.test(settings.model || '')
                ? 'Provider safety filter rejected this request. gpt-image-2 via Gemini-compatible proxies has stricter filtering than native Gemini. Try: rephrase the prompt (remove names/traits the filter may flag), or toggle off "Send reference images (Gemini)" in Advanced settings.'
                : 'Provider safety filter rejected this prompt or image. Try rephrasing the prompt, or disable reference images in Advanced settings.';
        } else if (/generation stopped without image/.test(msg)) {
            suggestion = 'Provider returned a response without an image (finishReason). Often a silent safety trip or token-budget issue — rephrase the prompt or retry.';
        } else if (/unknown shape/.test(msg)) {
            suggestion = 'Provider returned an unexpected response shape. Open Export Logs — the envelope keys are logged as a WARN line and will help diagnose the provider quirk.';
        } else if (/empty envelope/.test(msg)) {
            suggestion = apiType === 'gemini' && /gpt-image-2/i.test(settings.model || '')
                ? 'Provider rejected the request pre-inference (0 tokens used, empty envelope). Extension already retried with a stripped payload. If this persists, the issue is account-side: verify gpt-image-2 is enabled on your provider plan, check key scope, or try a different model.'
                : 'Provider returned an empty envelope even after auto-recovery. This usually indicates a model-access or account-tier issue on the provider side.';
        } else if (/^provider error:/i.test(error?.message || '')) {
            suggestion = 'Provider returned an error envelope (HTTP 200 with error body). Check API key scope, quota, and whether the selected model is enabled on your account.';
        }

        if (!suggestion) return;

        const now = Date.now();
        const lastShown = _recentErrorSuggestions.get(suggestion) || 0;
        if (now - lastShown < 30000) return;
        _recentErrorSuggestions.set(suggestion, now);

        toastr.info(suggestion, 'Image Generation — hint', { timeOut: 9000, extendedTimeOut: 4000 });
    } catch (_) { /* swallow — hint is best-effort */ }
}

/** Validate settings before generation; throws with aggregated error list. */
function validateSettings() {
    const settings = getSettings();
    const errors = [];

    switch (settings.apiType) {
        case 'openai':
        case 'gemini': {
            if (!settings.endpoint) errors.push('Endpoint URL not configured');
            if (!settings.apiKey) errors.push('API key not configured');
            if (!settings.model) errors.push('Model not selected');
            break;
        }
        case 'naistera': {
            if (!settings.apiKey) errors.push('API key not configured');
            const m = normalizeNaisteraModel(settings.naisteraModel);
            if (!NAISTERA_MODELS.includes(m)) {
                errors.push('Select Naistera model: Grok / Nano Banana 2 / NovelAI');
            }
            break;
        }
        default:
            errors.push(`Unknown apiType: ${settings.apiType}`);
    }

    if (errors.length > 0) {
        throw new Error(`Settings error: ${errors.join(', ')}`);
    }
}

/** HTML-escape text for safe insertion into element content OR quoted attributes. */
function sanitizeForHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Decode HTML entities in an instruction payload back to raw text. */
function normalizeInstructionPayload(text) {
    return String(text || '')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&#34;/g, '"')
        .replace(/&amp;/g, '&');
}

/** Decode common escape sequences in a relaxed JSON value string. */
function decodeRelaxedInstructionValue(value) {
    return String(value || '')
        .trim()
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .replace(/\\\\/g, '\\');
}

/** Regex key/value fallback for instruction payloads JSON.parse rejects. */
function parseRelaxedInstructionObject(payload) {
    const normalized = normalizeInstructionPayload(payload);
    const keyRegex = /(["'])(style|prompt|aspect_ratio|aspectRatio|preset|image_size|imageSize|quality)\1\s*:\s*(["'])/g;
    const matches = Array.from(normalized.matchAll(keyRegex));
    if (matches.length === 0) return null;

    const result = {};
    for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        const key = match[2];
        const valueQuote = match[3];
        const valueStart = match.index + match[0].length;
        const nextKeyIndex = i + 1 < matches.length ? matches[i + 1].index : normalized.lastIndexOf('}');
        const rawValue = normalized.substring(
            valueStart,
            nextKeyIndex === -1 ? normalized.length : nextKeyIndex
        );
        let value = rawValue.trim();
        if (value.endsWith(',')) value = value.slice(0, -1).trimEnd();
        if (value.endsWith(valueQuote)) value = value.slice(0, -1);
        result[key] = decodeRelaxedInstructionValue(value);
    }
    return Object.keys(result).length > 0 ? result : null;
}

/** Strict JSON.parse → relaxed regex parse fallback for instruction payloads. */
function parseInstructionObject(payload) {
    const normalized = normalizeInstructionPayload(payload);
    try {
        return JSON.parse(normalized);
    } catch (error) {
        const relaxed = parseRelaxedInstructionObject(normalized);
        if (relaxed) return relaxed;
        throw error;
    }
}

/** Escape for use inside single-quoted HTML attributes. */
function sanitizeForSingleQuotedAttribute(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Build a minimal instruction-data object from a parsed tag. */
function buildInstructionData(tag) {
    const data = {};
    if (tag.style) data.style = tag.style;
    if (tag.prompt) data.prompt = tag.prompt;
    if (tag.aspectRatio) data.aspect_ratio = tag.aspectRatio;
    if (tag.preset) data.preset = tag.preset;
    if (tag.imageSize) data.image_size = tag.imageSize;
    if (tag.quality) data.quality = tag.quality;
    return data;
}

/** Get the data-iig-instruction attribute value from a tag. */
function getInstructionAttributeValue(tag) {
    if (tag.isNewFormat && tag.fullMatch) {
        const instructionMatch = tag.fullMatch.match(/data-iig-instruction\s*=\s*(['"])([\s\S]*?)\1/i);
        if (instructionMatch) return instructionMatch[2];
    }
    return JSON.stringify(buildInstructionData(tag));
}

/** Parse image AND video tags from `message.mes`. */
async function parseMessageImageTags(message, options = {}) {
    const src = message?.mes || '';
    const imageTags = await parseImageTags(src, options);
    const videoTags = await parseVideoTags(src, options);
    return [...imageTags, ...videoTags].map(tag => ({ ...tag, sourceKey: 'mes' }));
}

/** Replace tag text across mes, display_text, and every swipe (so swipe-back keeps it). */
function replaceTagInMessageSource(message, tag, replacement) {
    if (!message || !tag) return;
    const find = tag.fullMatch;

    message.mes = (message.mes || '').replace(find, replacement);
    if (message.extra?.display_text) {
        message.extra.display_text = message.extra.display_text.replace(find, replacement);
    }
    if (Array.isArray(message.swipes)) {
        for (let i = 0; i < message.swipes.length; i++) {
            if (typeof message.swipes[i] === 'string') {
                message.swipes[i] = message.swipes[i].replace(find, replacement);
            }
        }
    }
    if (Array.isArray(message.swipe_info)) {
        for (let i = 0; i < message.swipe_info.length; i++) {
            const dt = message.swipe_info[i]?.extra?.display_text;
            if (typeof dt === 'string') {
                message.swipe_info[i].extra.display_text = dt.replace(find, replacement);
            }
        }
    }
}

/** Swap a src across mes, display_text, and every swipe (so regen survives swipe-back). */
function replaceSrcEverywhere(message, oldSrc, newSrc) {
    if (!message || !oldSrc || oldSrc === newSrc) return;
    const rep = (s) => (typeof s === 'string' && s.includes(oldSrc)) ? s.split(oldSrc).join(newSrc) : s;

    if (typeof message.mes === 'string') message.mes = rep(message.mes);
    if (typeof message.extra?.display_text === 'string') message.extra.display_text = rep(message.extra.display_text);
    if (Array.isArray(message.swipes)) {
        for (let i = 0; i < message.swipes.length; i++) message.swipes[i] = rep(message.swipes[i]);
    }
    if (Array.isArray(message.swipe_info)) {
        for (let i = 0; i < message.swipe_info.length; i++) {
            const dt = message.swipe_info[i]?.extra?.display_text;
            if (typeof dt === 'string') message.swipe_info[i].extra.display_text = rep(dt);
        }
    }
}

/**
 * Generate an image with exponential-backoff retry, dispatched by apiType.
 * 5xx always gets >=1 retry regardless of maxRetries; AbortError propagates.
 */
async function generateImageWithRetry(prompt, style, onStatusUpdate, options = {}) {
    validateSettings();

    const settings = getSettings();
    // --- ПОДХВАТ АКТИВНОГО СТИЛЯ ---
    if (settings.activeStyleId) {
        const activeStyle = ensureStyles(settings).find(s => s.id === settings.activeStyleId);
        if (activeStyle && activeStyle.value) {
            style = activeStyle.value; // Перезаписываем стиль из промпта на наш глобальный
        }
    }
    // --- КОНЕЦ ---
    const maxRetries = settings.maxRetries;
    const baseDelay = settings.retryDelay;
	
		// --- WARDROBE DESCRIPTIONS ---
    const swS = SillyTavern.getContext().extensionSettings?.slay_wardrobe || {};
    if (swS.sendOutfitDescription !== false && window.slayWardrobe?.isReady()) {
        const refs = getActiveRefs();
        const charInPrompt = settings.charRefAlways || refMatchesPrompt(refs.charRef, prompt, getStCharName());
        const userInPrompt = settings.userRefAlways || refMatchesPrompt(refs.userRef, prompt, getStUserName());

        const botDesc = window.slayWardrobe.getActiveOutfitDescription('bot');
        const userDesc = window.slayWardrobe.getActiveOutfitDescription('user');

        const wardrobeParts = [];
        if (botDesc && charInPrompt) wardrobeParts.push(`[Clothing reference only, avoid copying the pose] [Character's current outfit: ${botDesc}]`);
        if (userDesc && userInPrompt) wardrobeParts.push(`[Clothing reference only, avoid copying the pose] [User's current outfit: ${userDesc}]`);

        if (wardrobeParts.length > 0) {
            prompt = `${wardrobeParts.join(' ')}\n${prompt}`;
            iigLog('INFO', 'Wardrobe descriptions injected into prompt.');
        }
    }
    // --- END WARDROBE DESCRIPTIONS ---

    // Prompt-driven=off forces UI defaults; strip per-tag overrides.
    if (settings.promptDriven === false) {
        const stripped = Object.keys(options).filter(k => ['aspectRatio','imageSize','quality','preset'].includes(k));
        if (stripped.length > 0) {
            iigLog('INFO', `Prompt-driven=off: ignoring tag overrides (${stripped.join(', ')})`);
            for (const k of stripped) delete options[k];
        }
    }

    // Ref gating by apiType: naistera = model + toggle; gemini = toggle; openai = always.
    let referenceImages = [];
    let referenceDataUrls = [];
    if (settings.apiType === 'naistera') {
        const modelOk = naisteraModelSupportsReferences(settings.naisteraModel);
        const userOk = settings.naisteraSendRefs !== false;
        if (modelOk && userOk) {
            referenceDataUrls = await collectReferencesAsDataUrls(prompt, 4);
        } else {
            iigLog('INFO', `Naistera refs skipped: modelOk=${modelOk}, userOk=${userOk}`);
        }
    } else if (settings.apiType === 'gemini' && settings.geminiSendRefs === false) {
        iigLog('INFO', 'Gemini refs skipped: user toggle off');
    } else {
        referenceImages = await collectReferencesAsBase64(prompt, 4);
    }

    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (options.signal?.aborted) {
            const abortErr = new Error('Generation aborted');
            abortErr.name = 'AbortError';
            abortErr.reason = options.signal.reason;
            throw abortErr;
        }

        try {
            onStatusUpdate?.(`Generating${attempt > 0 ? ` (retry ${attempt}/${maxRetries})` : ''}...`);

            switch (settings.apiType) {
                case 'naistera':
                    return await generateImageNaistera(prompt, style, { ...options, referenceImages: referenceDataUrls });
                case 'gemini':
                    return await generateImageGemini(prompt, style, referenceImages, options);
                case 'openai':
                default:
                    return await generateImageOpenAI(prompt, style, referenceImages, options);
            }
        } catch (error) {
            lastError = error;
            iigLog('ERROR', `Generation attempt ${attempt + 1} failed:`, error.message);

            // Prefer error.status over substring matching (avoids false "429" in URLs).
            const status = typeof error?.status === 'number' ? error.status : null;
            const msg = (error?.message || '').toLowerCase();
            const isAbort = error?.name === 'AbortError' || msg.includes('aborted');
            const isUpstreamDown = status === 502 || status === 503 || status === 504
                                  || /\b(502|503|504)\b/.test(error.message || '');
            const isRetryable = !isAbort && (
                isUpstreamDown
                || status === 429
                || msg.includes('timeout')
                || msg.includes('network')
            );

            // 5xx always retries once even if user set maxRetries=0 (almost always transient).
            const effectiveMax = isUpstreamDown ? Math.max(maxRetries, 1) : maxRetries;

            if (!isRetryable || attempt >= effectiveMax) {
                if (isAbort) break;
                if (isUpstreamDown) {
                    const friendly = new Error(
                        `Provider upstream temporarily unavailable (${status || error.message.match(/\b5\d\d\b/)?.[0] || '5xx'}). ` +
                        `This is on the provider side, not your settings. Try again in a minute.`
                    );
                    friendly.cause = error;
                    if (status) friendly.status = status;
                    throw friendly;
                }
                break;
            }

            const delay = baseDelay * Math.pow(2, attempt);
            onStatusUpdate?.(`Retrying in ${delay / 1000}s...`);
            // Abortable: a user Stop during backoff resolves immediately; the
            // loop's top-of-iteration aborted check then throws AbortError.
            await abortableDelay(delay, options.signal);
        }
    }
    
    throw lastError;
}

/**
 * Generate a video with retry. Video is only supported on openai/gemini-style
 * providers (rout.my). Collects matched refs as data URLs for image-to-video.
 * Retries reuse the same transient-error classification as images, but video
 * renders are long so this stays conservative (respects maxRetries).
 */
async function generateVideoWithRetry(prompt, onStatusUpdate, options = {}) {
    const settings = getSettings();

    if (settings.apiType !== 'openai' && settings.apiType !== 'gemini') {
        throw new Error('Video generation requires API Type "OpenAI-compatible" or "Gemini-compatible" (e.g. rout.my).');
    }
    if (!settings.endpoint) throw new Error('Endpoint URL not configured');
    if (!settings.apiKey) throw new Error('API key not configured');
    if (!(settings.videoModel || '').trim()) {
        throw new Error('No Video model set. Open the extension settings and set a Video model.');
    }

    const maxRetries = settings.maxRetries;
    const baseDelay = settings.retryDelay;

    // Image-to-video source: matched refs as data URLs (honors Gemini refs toggle).
    let referenceDataUrls = [];
    if (settings.apiType === 'gemini' && settings.geminiSendRefs === false) {
        iigLog('INFO', 'Video refs skipped: Gemini send-refs toggle off');
    } else {
        referenceDataUrls = await collectReferencesAsDataUrls(prompt, 4);
    }

    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (options.signal?.aborted) {
            const abortErr = new Error('Generation aborted');
            abortErr.name = 'AbortError';
            abortErr.reason = options.signal.reason;
            throw abortErr;
        }
        try {
            onStatusUpdate?.(`Rendering video${attempt > 0 ? ` (retry ${attempt}/${maxRetries})` : ''}...`);
            return await generateVideo(prompt, { ...options, referenceImages: referenceDataUrls });
        } catch (error) {
            lastError = error;
            iigLog('ERROR', `Video attempt ${attempt + 1} failed:`, error.message);

            const status = typeof error?.status === 'number' ? error.status : null;
            const msg = (error?.message || '').toLowerCase();
            const isAbort = error?.name === 'AbortError' || msg.includes('aborted');
            const isUpstreamDown = status === 502 || status === 503 || status === 504
                                  || /\b(502|503|504)\b/.test(error.message || '');
            const isRetryable = !isAbort && (
                isUpstreamDown || status === 429 || msg.includes('timeout') || msg.includes('network')
            );
            const effectiveMax = isUpstreamDown ? Math.max(maxRetries, 1) : maxRetries;

            if (!isRetryable || attempt >= effectiveMax) {
                if (isAbort) break;
                if (isUpstreamDown) {
                    const friendly = new Error(
                        `Provider upstream temporarily unavailable (${status || '5xx'}). Try again in a minute.`
                    );
                    friendly.cause = error;
                    if (status) friendly.status = status;
                    throw friendly;
                }
                break;
            }

            const delay = baseDelay * Math.pow(2, attempt);
            onStatusUpdate?.(`Retrying in ${delay / 1000}s...`);
            // Abortable: a user Stop during backoff resolves immediately; the
            // loop's top-of-iteration aborted check then throws AbortError.
            await abortableDelay(delay, options.signal);
        }
    }
    throw lastError;
}

/**
 * HEAD cache for image paths. Hits live until tab close; misses expire after a
 * TTL so in-flight uploads aren't poisoned. LRU-capped.
 */
const _fileExistsCache = new Map(); // path -> { exists, ts }
const FILE_EXISTS_NEG_TTL_MS = 60 * 1000;
const FILE_EXISTS_CACHE_CAP = 500;

function _evictFileExistsCacheIfFull(incomingPath) {
    if (_fileExistsCache.size < FILE_EXISTS_CACHE_CAP) return;
    if (_fileExistsCache.has(incomingPath)) return;
    const oldest = _fileExistsCache.keys().next().value;
    if (oldest !== undefined) _fileExistsCache.delete(oldest);
}

async function checkFileExists(path) {
    if (!path) return false;
    const now = Date.now();
    const cached = _fileExistsCache.get(path);
    if (cached) {
        // LRU touch.
        _fileExistsCache.delete(path);
        _fileExistsCache.set(path, cached);
        if (cached.exists) return true;
        if (now - cached.ts < FILE_EXISTS_NEG_TTL_MS) return false;
    }
    try {
        const response = await fetchWithTimeout(path, { method: 'HEAD' }, 10000);
        const exists = response.ok;
        _evictFileExistsCacheIfFull(path);
        _fileExistsCache.set(path, { exists, ts: now });
        return exists;
    } catch (e) {
        _evictFileExistsCacheIfFull(path);
        _fileExistsCache.set(path, { exists: false, ts: now });
        return false;
    }
}

/**
 * Parse image tags from message text. Formats:
 *   <img data-iig-instruction='{...}' src="[IMG:GEN]">  and  [IMG:GEN:{...}]
 */
async function parseImageTags(text, options = {}) {
    const { checkExistence = false, forceAll = false } = options;
    const tags = [];

    if (!text || (!text.includes('data-iig-instruction') && !text.includes('[IMG:GEN:') && !text.includes('[IMG:✓:'))) {
        return tags;
    }

    const imgTagMarker = 'data-iig-instruction=';
    let searchPos = 0;

    while (true) {
        const markerPos = text.indexOf(imgTagMarker, searchPos);
        if (markerPos === -1) break;

        let imgStart = text.lastIndexOf('<img', markerPos);
        if (imgStart === -1 || markerPos - imgStart > 500) {
            searchPos = markerPos + 1;
            continue;
        }
        
        const afterMarker = markerPos + imgTagMarker.length;
        let jsonStart = text.indexOf('{', afterMarker);
        if (jsonStart === -1 || jsonStart > afterMarker + 10) {
            searchPos = markerPos + 1;
            continue;
        }
        
        // Brace-count through the JSON payload, respecting quotes and escapes.
        let braceCount = 0;
        let jsonEnd = -1;
        let inString = false;
        let escapeNext = false;

        for (let i = jsonStart; i < text.length; i++) {
            const char = text[i];
            if (escapeNext) { escapeNext = false; continue; }
            if (char === '\\' && inString) { escapeNext = true; continue; }
            if (char === '"') { inString = !inString; continue; }
            if (!inString) {
                if (char === '{') braceCount++;
                else if (char === '}') {
                    braceCount--;
                    if (braceCount === 0) { jsonEnd = i + 1; break; }
                }
            }
        }

        if (jsonEnd === -1) {
            searchPos = markerPos + 1;
            continue;
        }

        let imgEnd = text.indexOf('>', jsonEnd);
        if (imgEnd === -1) {
            searchPos = markerPos + 1;
            continue;
        }
        imgEnd++;
        
        const fullImgTag = text.substring(imgStart, imgEnd);
        const instructionJson = text.substring(jsonStart, jsonEnd);
        
        const srcMatch = fullImgTag.match(/src\s*=\s*["']?([^"'\s>]+)/i);
        const srcValue = srcMatch ? srcMatch[1] : '';
        
        let needsGeneration = false;
        const hasMarker = srcValue.includes('[IMG:GEN]') || srcValue.includes('[IMG:');
        const hasErrorImage = srcValue.includes('error.svg');
        const hasPath = srcValue && srcValue.startsWith('/') && srcValue.length > 5;

        // Error images regenerate only on explicit user action (force flag).
        if (hasErrorImage && !forceAll) {
            iigLog('INFO', `Skipping error image (use regenerate button): ${srcValue.substring(0, 50)}`);
            searchPos = imgEnd;
            continue;
        }
        
        if (forceAll) {
            needsGeneration = true;
            iigLog('INFO', `Force regeneration mode: including ${srcValue.substring(0, 30)}`);
        } else if (hasMarker || !srcValue) {
            needsGeneration = true;
        } else if (hasPath && checkExistence) {
            const exists = await checkFileExists(srcValue);
            if (!exists) {
                iigLog('WARN', `File does not exist (LLM hallucination?): ${srcValue}`);
                needsGeneration = true;
            } else {
                iigLog('INFO', `Skipping existing image: ${srcValue.substring(0, 50)}`);
            }
        } else if (hasPath) {
            iigLog('INFO', `Skipping path (no existence check): ${srcValue.substring(0, 50)}`);
            searchPos = imgEnd;
            continue;
        }
        
        if (!needsGeneration) {
            searchPos = imgEnd;
            continue;
        }
        
        try {
            const data = parseInstructionObject(instructionJson);
            
            tags.push({
                fullMatch: fullImgTag,
                index: imgStart,
                mediaType: 'image',
                style: data.style || '',
                prompt: data.prompt || '',
                aspectRatio: data.aspect_ratio || data.aspectRatio || null,
                preset: data.preset || null,
                imageSize: data.image_size || data.imageSize || null,
                quality: data.quality || null,
                isNewFormat: true,
                existingSrc: hasPath ? srcValue : null
            });

            iigLog('INFO', `Found tag (img format): ${data.prompt?.substring(0, 50)}`);
        } catch (e) {
            iigLog('WARN', `Failed to parse instruction JSON: ${instructionJson.substring(0, 100)}`, e.message);
        }
        
        searchPos = imgEnd;
    }

    // [IMG:GEN:{...}] form. Same brace-count scanner as above.
    const marker = '[IMG:GEN:';
    let searchStart = 0;

    while (true) {
        const markerIndex = text.indexOf(marker, searchStart);
        if (markerIndex === -1) break;

        const jsonStart = markerIndex + marker.length;

        let braceCount = 0;
        let jsonEnd = -1;
        let inString = false;
        let escapeNext = false;

        for (let i = jsonStart; i < text.length; i++) {
            const char = text[i];
            if (escapeNext) { escapeNext = false; continue; }
            if (char === '\\' && inString) { escapeNext = true; continue; }
            if (char === '"') { inString = !inString; continue; }
            if (!inString) {
                if (char === '{') braceCount++;
                else if (char === '}') {
                    braceCount--;
                    if (braceCount === 0) { jsonEnd = i + 1; break; }
                }
            }
        }

        if (jsonEnd === -1) {
            searchStart = jsonStart;
            continue;
        }

        const jsonStr = text.substring(jsonStart, jsonEnd);

        const afterJson = text.substring(jsonEnd);
        if (!afterJson.startsWith(']')) {
            searchStart = jsonEnd;
            continue;
        }

        const tagOnly = text.substring(markerIndex, jsonEnd + 1);

        try {
            const data = parseInstructionObject(jsonStr);

            tags.push({
                fullMatch: tagOnly,
                index: markerIndex,
                mediaType: 'image',
                style: data.style || '',
                prompt: data.prompt || '',
                aspectRatio: data.aspect_ratio || data.aspectRatio || null,
                preset: data.preset || null,
                imageSize: data.image_size || data.imageSize || null,
                quality: data.quality || null,
                isNewFormat: false
            });

            iigLog('INFO', `Found tag (legacy format): ${data.prompt?.substring(0, 50)}`);
        } catch (e) {
            iigLog('WARN', `Failed to parse legacy tag JSON: ${jsonStr.substring(0, 100)}`, e.message);
        }

        searchStart = jsonEnd + 1;
    }

    return tags;
}

/**
 * Parse video tags (mirrors the image parser). Formats:
 *   <img data-iig-video='{...}' src="[VID:GEN]">  and  [VID:GEN:{...}]
 * Returns tags with mediaType:'video' for the shared orchestrator.
 */
async function parseVideoTags(text, options = {}) {
    const { checkExistence = false, forceAll = false } = options;
    const tags = [];

    if (!text || (!text.includes('data-iig-video') && !text.includes('[VID:GEN:') && !text.includes('[VID:✓:'))) {
        return tags;
    }

    const scanJson = (start) => {
        let braceCount = 0, inString = false, escapeNext = false;
        for (let i = start; i < text.length; i++) {
            const ch = text[i];
            if (escapeNext) { escapeNext = false; continue; }
            if (ch === '\\' && inString) { escapeNext = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (!inString) {
                if (ch === '{') braceCount++;
                else if (ch === '}') { braceCount--; if (braceCount === 0) return i + 1; }
            }
        }
        return -1;
    };

    const pushTag = (fullMatch, index, data, isNewFormat, hasPath, srcValue) => {
        tags.push({
            fullMatch,
            index,
            mediaType: 'video',
            style: data.style || '',
            prompt: data.prompt || '',
            aspectRatio: data.aspect_ratio || data.aspectRatio || null,
            duration: data.duration != null ? data.duration : null,
            resolution: data.resolution || null,
            audio: (typeof data.audio === 'boolean') ? data.audio : null,
            negativePrompt: data.negative_prompt || data.negativePrompt || null,
            // 'reference' (identity, default) or 'first_frame' (animate photo).
            refMode: data.ref_mode || data.refMode || null,
            isNewFormat,
            existingSrc: hasPath ? srcValue : null,
        });
        iigLog('INFO', `Found video tag (${isNewFormat ? 'img' : 'legacy'}): ${String(data.prompt || '').substring(0, 50)}`);
    };

    // <img data-iig-video='{...}' src="[VID:GEN]"> form.
    const marker = 'data-iig-video=';
    let searchPos = 0;
    while (true) {
        const markerPos = text.indexOf(marker, searchPos);
        if (markerPos === -1) break;

        const imgStart = text.lastIndexOf('<img', markerPos);
        if (imgStart === -1 || markerPos - imgStart > 500) { searchPos = markerPos + 1; continue; }

        const afterMarker = markerPos + marker.length;
        const jsonStart = text.indexOf('{', afterMarker);
        if (jsonStart === -1 || jsonStart > afterMarker + 10) { searchPos = markerPos + 1; continue; }

        const jsonEnd = scanJson(jsonStart);
        if (jsonEnd === -1) { searchPos = markerPos + 1; continue; }

        let imgEnd = text.indexOf('>', jsonEnd);
        if (imgEnd === -1) { searchPos = markerPos + 1; continue; }
        imgEnd++;

        const fullTag = text.substring(imgStart, imgEnd);
        const jsonStr = text.substring(jsonStart, jsonEnd);

        const srcMatch = fullTag.match(/src\s*=\s*["']?([^"'\s>]+)/i);
        const srcValue = srcMatch ? srcMatch[1] : '';
        const hasMarker = srcValue.includes('[VID:GEN]') || srcValue.includes('[VID:');
        const hasError = srcValue.includes('error.svg');
        const hasPath = srcValue && srcValue.startsWith('/') && srcValue.length > 5;

        if (hasError && !forceAll) { searchPos = imgEnd; continue; }

        let needsGeneration = false;
        if (forceAll) needsGeneration = true;
        else if (hasMarker || !srcValue) needsGeneration = true;
        else if (hasPath && checkExistence) {
            const exists = await checkFileExists(srcValue);
            needsGeneration = !exists;
        } else if (hasPath) { searchPos = imgEnd; continue; }

        if (!needsGeneration) { searchPos = imgEnd; continue; }

        try {
            const data = parseInstructionObject(jsonStr);
            pushTag(fullTag, imgStart, data, true, hasPath, srcValue);
        } catch (e) {
            iigLog('WARN', `Failed to parse video instruction JSON: ${jsonStr.substring(0, 100)}`, e.message);
        }
        searchPos = imgEnd;
    }

    // [VID:GEN:{...}] form.
    const legacyMarker = '[VID:GEN:';
    let searchStart = 0;
    while (true) {
        const idx = text.indexOf(legacyMarker, searchStart);
        if (idx === -1) break;
        const jsonStart = idx + legacyMarker.length;
        const jsonEnd = scanJson(jsonStart);
        if (jsonEnd === -1) { searchStart = jsonStart; continue; }
        if (!text.substring(jsonEnd).startsWith(']')) { searchStart = jsonEnd; continue; }
        const tagOnly = text.substring(idx, jsonEnd + 1);
        try {
            const data = parseInstructionObject(text.substring(jsonStart, jsonEnd));
            pushTag(tagOnly, idx, data, false, false, '');
        } catch (e) {
            iigLog('WARN', `Failed to parse legacy video tag JSON`, e.message);
        }
        searchStart = jsonEnd + 1;
    }

    return tags;
}

// Resolved-once caches for the install folder and the error.svg path.
let _cachedAssetBase = null;
let _cachedErrorImagePath = null;

// Resolve our install-folder base URL (works regardless of folder name).
// import.meta.url is available because ST loads index.js as a module; falls
// back to DOM/href sniffing, then a hardcoded candidate.
function getAssetBasePath() {
    if (_cachedAssetBase) return _cachedAssetBase;

    // Strategy 0: import.meta.url — works for ANY folder name / fork / rename.
    try {
        const here = import.meta.url; // e.g. https://host/scripts/extensions/third-party/<folder>/index.js
        if (here) {
            const u = new URL(here);
            _cachedAssetBase = u.pathname.substring(0, u.pathname.lastIndexOf('/'));
            return _cachedAssetBase;
        }
    } catch (_) { /* not a module context; fall through */ }

    const scripts = document.querySelectorAll('script[src*="index.js"]');
    for (const script of scripts) {
        const src = script.getAttribute('src') || '';
        if (src.includes('inline_image_gen') || src.includes('sillyimages') || src.includes('notsosillynotsoimages')) {
            _cachedAssetBase = src.substring(0, src.lastIndexOf('/'));
            return _cachedAssetBase;
        }
    }

    const links = document.querySelectorAll('link[rel="stylesheet"][href*="style.css"]');
    for (const link of links) {
        const href = link.getAttribute('href') || '';
        if (href.includes('sillyimages') || href.includes('notsosillynotsoimages') || href.includes('inline_image_gen')) {
            _cachedAssetBase = href.substring(0, href.lastIndexOf('/'));
            return _cachedAssetBase;
        }
    }

    _cachedAssetBase = '/scripts/extensions/third-party/notsosillynotsoimages';
    return _cachedAssetBase;
}

function getErrorImagePath() {
    if (_cachedErrorImagePath) return _cachedErrorImagePath;

    // Strategy 0: folder-robust base (import.meta.url et al.).
    try {
        const base = getAssetBasePath();
        if (base) {
            _cachedErrorImagePath = `${base}/error.svg`;
            return _cachedErrorImagePath;
        }
    } catch (_) { /* fall through to legacy strategies */ }

    const scripts = document.querySelectorAll('script[src*="index.js"]');
    for (const script of scripts) {
        const src = script.getAttribute('src') || '';
        if (src.includes('inline_image_gen') || src.includes('sillyimages') || src.includes('notsosillynotsoimages')) {
            const basePath = src.substring(0, src.lastIndexOf('/'));
            _cachedErrorImagePath = `${basePath}/error.svg`;
            return _cachedErrorImagePath;
        }
    }

    const links = document.querySelectorAll('link[rel="stylesheet"][href*="style.css"]');
    for (const link of links) {
        const href = link.getAttribute('href') || '';
        if (href.includes('sillyimages') || href.includes('notsosillynotsoimages') || href.includes('inline_image_gen')) {
            const basePath = href.substring(0, href.lastIndexOf('/'));
            _cachedErrorImagePath = `${basePath}/error.svg`;
            return _cachedErrorImagePath;
        }
    }

    const settingsEl = document.querySelector('.iig-settings');
    if (settingsEl) {
        const anyImg = document.querySelector('img.iig-error-image[src], img.iig-ref-thumb[src]');
        if (anyImg?.src) {
            const basePath = anyImg.src.substring(0, anyImg.src.lastIndexOf('/'));
            _cachedErrorImagePath = `${basePath}/error.svg`;
            return _cachedErrorImagePath;
        }
    }

    // Covers both default and renamed install folders.
    const possiblePaths = [
        '/scripts/extensions/third-party/notsosillynotsoimages/error.svg',
        '/scripts/extensions/third-party/sillyimages/error.svg',
    ];
    _cachedErrorImagePath = possiblePaths[0];

    // Async HEAD to pick the real one; sync callers get the first candidate meanwhile.
    (async () => {
        for (const path of possiblePaths) {
            try {
                const resp = await fetchWithTimeout(path, { method: 'HEAD' }, 10000);
                if (resp.ok) {
                    _cachedErrorImagePath = path;
                    iigLog('INFO', `error.svg resolved to: ${path}`);
                    return;
                }
            } catch (e) { /* ignore */ }
        }
        iigLog('WARN', 'error.svg not found at any expected path');
    })();

    return _cachedErrorImagePath;
}

/** Escape a path for safe interpolation inside a double-quoted HTML attribute. */
function escapeAttrPath(path) {
    return String(path ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// Inline SVG icons for image action buttons (no external deps).
const SVG_ICON_REGENERATE = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
const SVG_ICON_DOWNLOAD = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
// Stop = rounded filled square (no glyph/font dependency).
const SVG_ICON_STOP = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;

/** Build a <video> element carrying data-iig-video (so it survives reload). */
function buildVideoElement(videoPath, tag) {
    const video = document.createElement('video');
    video.className = 'iig-generated-video';
    video.src = videoPath;
    video.controls = true;
    video.loop = true;
    video.muted = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('preload', 'metadata');
    if (tag?.prompt) video.title = `Prompt: ${tag.prompt}`;

    // Preserve the instruction so regenerate/reload can read it back.
    if (tag?.isNewFormat && tag.fullMatch) {
        const m = tag.fullMatch.match(/data-iig-video\s*=\s*(['"])([\s\S]*?)\1/i);
        if (m) video.setAttribute('data-iig-video', m[2]);
    } else if (tag) {
        video.setAttribute('data-iig-video', JSON.stringify({
            prompt: tag.prompt || '',
            aspect_ratio: tag.aspectRatio || undefined,
            duration: tag.duration ?? undefined,
            resolution: tag.resolution || undefined,
            audio: (typeof tag.audio === 'boolean') ? tag.audio : undefined,
        }));
    }
    return video;
}

/** Wrap a <video> with download/regenerate overlay buttons (no lightbox). */
function wrapVideoWithActions(videoElement) {
    if (videoElement.parentElement?.classList.contains('iig-image-wrapper')) return videoElement.parentElement;

    const wrapper = document.createElement('div');
    wrapper.className = 'iig-image-wrapper iig-video-wrapper';

    const btnRegen = document.createElement('button');
    btnRegen.className = 'iig-action-btn iig-action-regen';
    btnRegen.innerHTML = SVG_ICON_REGENERATE;
    btnRegen.title = 'Regenerate';
    btnRegen.type = 'button';

    const btnDownload = document.createElement('button');
    btnDownload.className = 'iig-action-btn iig-action-download';
    btnDownload.innerHTML = SVG_ICON_DOWNLOAD;
    btnDownload.title = 'Download';
    btnDownload.type = 'button';

    if (videoElement.parentElement) videoElement.replaceWith(wrapper);
    wrapper.appendChild(videoElement);
    wrapper.appendChild(btnRegen);
    wrapper.appendChild(btnDownload);

    btnDownload.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        downloadGeneratedMedia(videoElement);
    });
    btnRegen.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        regenerateSingleVideo(videoElement);
    });

    // Mobile: tap toggles button visibility (skip taps on the controls).
    if (IS_MOBILE) {
        let _autoHideTimer = null;
        wrapper.addEventListener('click', (e) => {
            if (e.target.closest('.iig-action-btn')) return;
            const isVisible = wrapper.classList.contains('iig-actions-visible');
            document.querySelectorAll('.iig-image-wrapper.iig-actions-visible').forEach(w => {
                if (w !== wrapper) w.classList.remove('iig-actions-visible');
            });
            if (isVisible) {
                wrapper.classList.remove('iig-actions-visible');
                clearTimeout(_autoHideTimer);
            } else {
                wrapper.classList.add('iig-actions-visible');
                clearTimeout(_autoHideTimer);
                _autoHideTimer = setTimeout(() => wrapper.classList.remove('iig-actions-visible'), 4000);
            }
        });
    }

    return wrapper;
}

/**
 * Wrap <img> with overlay regen/download buttons. Desktop: hover + lightbox;
 * mobile: tap toggles (4s auto-hide), no lightbox.
 */
function wrapImageWithActions(imgElement) {
    if (imgElement.parentElement?.classList.contains('iig-image-wrapper')) return imgElement.parentElement;

    const wrapper = document.createElement('div');
    wrapper.className = 'iig-image-wrapper';

    const btnRegen = document.createElement('button');
    btnRegen.className = 'iig-action-btn iig-action-regen';
    btnRegen.innerHTML = SVG_ICON_REGENERATE;
    btnRegen.title = 'Regenerate';
    btnRegen.type = 'button';

    const btnDownload = document.createElement('button');
    btnDownload.className = 'iig-action-btn iig-action-download';
    btnDownload.innerHTML = SVG_ICON_DOWNLOAD;
    btnDownload.title = 'Download';
    btnDownload.type = 'button';

    // Replace in-place if attached; otherwise just nest the detached img.
    if (imgElement.parentElement) {
        imgElement.replaceWith(wrapper);
    }
    wrapper.appendChild(imgElement);
    wrapper.appendChild(btnRegen);
    wrapper.appendChild(btnDownload);
	
	// Открытие лайтбокса по клику на картинку
    imgElement.addEventListener('click', (e) => {
        // Защита для мобилок, чтобы не ломать их нативные просмотрщики, если нужно
        if (!IS_MOBILE) {
            e.preventDefault();
            e.stopPropagation();
            openLightbox(imgElement);
        }
    });
	
    btnDownload.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        downloadGeneratedImage(imgElement);
    });

    btnRegen.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        regenerateSingleImage(imgElement);
    });

    // Mobile: tap toggles buttons (4s auto-hide); no lightbox (iOS Safari freezes).
    if (IS_MOBILE) {
        let _autoHideTimer = null;

        wrapper.addEventListener('click', (e) => {
            if (e.target.closest('.iig-action-btn')) return;

            e.preventDefault();
            e.stopPropagation();

            const isVisible = wrapper.classList.contains('iig-actions-visible');

            // Hide other wrappers first.
            document.querySelectorAll('.iig-image-wrapper.iig-actions-visible').forEach(w => {
                if (w !== wrapper) w.classList.remove('iig-actions-visible');
            });

            if (isVisible) {
                wrapper.classList.remove('iig-actions-visible');
                clearTimeout(_autoHideTimer);
            } else {
                wrapper.classList.add('iig-actions-visible');
                clearTimeout(_autoHideTimer);
                _autoHideTimer = setTimeout(() => {
                    wrapper.classList.remove('iig-actions-visible');
                }, 4000);
            }
        });
    }

    return wrapper;
}

/** Open the fullscreen lightbox for the given image element. */
function openLightbox(imgElement) {
    let overlay = document.getElementById('iig_lightbox');
    
    // Если лайтбокса еще нет в DOM — создаем его на лету
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'iig_lightbox';
        overlay.className = 'iig-lightbox';
        overlay.innerHTML = `
            <div class="iig-lightbox-backdrop"></div>
            <div class="iig-lightbox-content">
                <button class="iig-lightbox-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
                <img class="iig-lightbox-img" src="" alt="">
                <div class="iig-lightbox-actions">
                    <button class="iig-lightbox-action-btn iig-lb-regen" title="Regenerate">${SVG_ICON_REGENERATE}</button>
                </div>
                <div class="iig-lightbox-caption"></div>
            </div>
        `;
        document.body.appendChild(overlay);

        // Вешаем закрытие и реген
        overlay.querySelector('.iig-lightbox-close').addEventListener('click', () => overlay.classList.remove('open'));
        overlay.querySelector('.iig-lightbox-backdrop').addEventListener('click', () => overlay.classList.remove('open'));
        overlay.querySelector('.iig-lb-regen').addEventListener('click', () => {
            overlay.classList.remove('open');
            if (overlay._sourceImg) regenerateSingleImage(overlay._sourceImg);
        });
    }

    const lbImg = overlay.querySelector('.iig-lightbox-img');
    const caption = overlay.querySelector('.iig-lightbox-caption');
    const regenBtn = overlay.querySelector('.iig-lb-regen');
    
    lbImg.src = imgElement.src;
    caption.textContent = imgElement.alt || '';
    overlay._sourceImg = imgElement;
    
    if (regenBtn) {
        regenBtn.style.display = imgElement.hasAttribute('data-iig-instruction') ? '' : 'none';
    }
    overlay.classList.add('open');
}

/** Download a generated image. On mobile, opens in new tab (a.download broken on iOS). */
async function downloadGeneratedImage(imgElement) {
    const src = imgElement.src;
    if (!src) return;

    try {
        toastr.info('Downloading...', 'Image Generation', { timeOut: 2000 });

        if (IS_MOBILE) {
            window.open(src, '_blank');
            toastr.success('Image opened — long-press to save', 'Image Generation', { timeOut: 3000 });
            return;
        }

        const response = await fetchWithTimeout(src, {}, 60000);
        const blob = await response.blob();

        const bt = blob.type || '';
        const ext = bt.includes('mp4') ? 'mp4'
            : bt.includes('webm') ? 'webm'
            : bt.includes('png') ? 'png'
            : bt.includes('webp') ? 'webp'
            : bt.startsWith('video/') ? 'mp4'
            : 'jpg';
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `iig_${timestamp}.${ext}`;

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        toastr.success('Image downloaded', 'Image Generation', { timeOut: 2000 });
    } catch (error) {
        iigLog('ERROR', 'Download failed:', error.message);
        toastr.error('Download failed: ' + error.message, 'Image Generation');
    }
}

// Images and videos download identically (fetch blob by src); alias for clarity.
const downloadGeneratedMedia = downloadGeneratedImage;

/** Regenerate a single video in place (mirrors regenerateSingleImage). */
async function regenerateSingleVideo(videoElement) {
    const instruction = videoElement.getAttribute('data-iig-video');
    if (!instruction) {
        toastr.warning('No video instruction found on this element', 'Image Generation');
        return;
    }
    const mesElement = videoElement.closest('.mes[mesid]');
    if (!mesElement) {
        toastr.error('Could not find parent message', 'Image Generation');
        return;
    }
    const messageId = parseInt(mesElement.getAttribute('mesid'), 10);
    const context = getContext();
    const message = context.chat[messageId];
    if (!message) return;

    let data;
    try {
        data = parseInstructionObject(instruction);
    } catch (e) {
        toastr.error('Failed to parse video instruction', 'Image Generation');
        return;
    }

    // Capture the PREVIOUS video up front so a user Stop can restore it.
    const prevVidSrc = videoElement.getAttribute('src') || '';
    const prevVidIsReal = !!prevVidSrc && !prevVidSrc.includes('error.svg') && !prevVidSrc.includes('[VID:');

    const wrapper = videoElement.closest('.iig-image-wrapper');
    const tagId = `iig-single-vregen-${messageId}-${Date.now()}`;
    const loadingPlaceholder = createLoadingPlaceholder(tagId);
    (wrapper || videoElement).replaceWith(loadingPlaceholder);

    const statusEl = loadingPlaceholder.querySelector('.iig-status');
    const setStatus = (text) => { if (statusEl && statusEl.isConnected) statusEl.textContent = text; };

    const fakeTag = { fullMatch: instruction || data.prompt || '', prompt: data.prompt || '' };
    const { controller, key } = beginGeneration(messageId, fakeTag);
    tagAbortControllers.set(tagId, controller); // enable Stop button for this placeholder

    try {
        const media = await generateVideoWithRetry(data.prompt || '', setStatus, {
            aspectRatio: data.aspect_ratio || data.aspectRatio || null,
            duration: data.duration ?? null,
            resolution: data.resolution || null,
            audio: (typeof data.audio === 'boolean') ? data.audio : null,
            negativePrompt: data.negative_prompt || data.negativePrompt || null,
            refMode: data.ref_mode || data.refMode || null,
            signal: controller.signal,
        });

        setStatus('Saving...');
        const saved = await saveVideoToFile(media);
        const newPath = saved.path;

        const newVid = buildVideoElement(newPath, { isNewFormat: true, fullMatch: `data-iig-video='${instruction}'`, prompt: data.prompt || '' });
        // buildVideoElement re-extracts the attr from fullMatch; ensure it's set.
        newVid.setAttribute('data-iig-video', instruction);

        if (loadingPlaceholder._timerInterval) clearInterval(loadingPlaceholder._timerInterval);
        const newWrapper = wrapVideoWithActions(newVid);
        loadingPlaceholder.replaceWith(newWrapper);

        const oldSrc = videoElement.getAttribute('src') || '';
        if (oldSrc) replaceSrcEverywhere(message, oldSrc, newPath);

        sessionGenCount++;
        updateSessionStats();
        await context.saveChat();
        scheduleWrapPass(); // re-wrap after ST re-renders from mes
        toastr.success(saved.persisted ? 'Video regenerated' : 'Video regenerated (temporary link — download to keep)', 'Image Generation', { timeOut: saved.persisted ? 2000 : 5000 });
    } catch (error) {
        const isAbort = error?.name === 'AbortError' || /aborted/i.test(error?.message || '');
        const isUserCancel = error === 'user-cancel' || error?.reason === 'user-cancel' || controller.signal.reason === 'user-cancel';

        // User Stop: restore the PREVIOUS video (mes untouched on cancel).
        if (isUserCancel) {
            iigLog('INFO', 'Single video regeneration stopped by user');
            if (loadingPlaceholder._timerInterval) clearInterval(loadingPlaceholder._timerInterval);
            if (prevVidIsReal) {
                const restored = buildVideoElement(prevVidSrc, { isNewFormat: true, fullMatch: `data-iig-video='${instruction}'`, prompt: data.prompt || '' });
                restored.setAttribute('data-iig-video', instruction);
                loadingPlaceholder.replaceWith(wrapVideoWithActions(restored));
            } else {
                const stopped = document.createElement('img');
                stopped.className = 'iig-error-image';
                stopped.src = getErrorImagePath();
                stopped.alt = 'Generation stopped';
                stopped.title = 'Generation stopped — click retry';
                stopped.setAttribute('data-iig-video', instruction);
                loadingPlaceholder.replaceWith(wrapPlaceholderWithRetry(stopped));
            }
            toastr.info('Generation stopped', 'Image Generation', { timeOut: 2000 });
            return;
        }

        // Superseded by a newer request; silent.
        if (isAbort) {
            iigLog('INFO', 'Single video regeneration aborted (superseded)');
            return;
        }
        iigLog('ERROR', 'Single video regeneration failed:', error.message);
        const errorImg = document.createElement('img');
        errorImg.className = 'iig-error-image';
        errorImg.src = getErrorImagePath();
        errorImg.alt = 'Video generation error';
        errorImg.title = `Error: ${error.message}`;
        errorImg.setAttribute('data-iig-video', instruction);
        if (loadingPlaceholder._timerInterval) clearInterval(loadingPlaceholder._timerInterval);
        loadingPlaceholder.replaceWith(wrapPlaceholderWithRetry(errorImg));
        sessionErrorCount++;
        updateSessionStats();
        toastr.error('Video regeneration failed: ' + error.message, 'Image Generation');
        maybeSuggestFix(error);
    } finally {
        tagAbortControllers.delete(tagId);
        endGeneration(key, controller);
    }
}

/** Regenerate a single image in place (per-image, not whole message). */
async function regenerateSingleImage(imgElement) {
    const instruction = imgElement.getAttribute('data-iig-instruction');
    if (!instruction) {
        toastr.warning('No generation instruction found on this image', 'Image Generation');
        return;
    }

    const mesElement = imgElement.closest('.mes[mesid]');
    if (!mesElement) {
        toastr.error('Could not find parent message', 'Image Generation');
        return;
    }
    const messageId = parseInt(mesElement.getAttribute('mesid'), 10);
    const context = getContext();
    const message = context.chat[messageId];
    if (!message) return;

    let data;
    try {
        data = parseInstructionObject(instruction);
    } catch (e) {
        toastr.error('Failed to parse image instruction', 'Image Generation');
        return;
    }

    // Capture the PREVIOUS image up front (before any DOM swap) so a user Stop
    // can restore it. Only a real generated image counts as restorable.
    const prevSrc = imgElement.getAttribute('src') || '';
    const prevAlt = imgElement.getAttribute('alt') || '';
    const prevTitle = imgElement.getAttribute('title') || '';
    const prevIsRealImage = !!prevSrc && !prevSrc.includes('error.svg') && !prevSrc.includes('[IMG:');

    const wrapper = imgElement.closest('.iig-image-wrapper');
    const tagId = `iig-single-regen-${messageId}-${Date.now()}`;
    const loadingPlaceholder = createLoadingPlaceholder(tagId);

    if (wrapper) {
        wrapper.replaceWith(loadingPlaceholder);
    } else {
        imgElement.replaceWith(loadingPlaceholder);
    }

    const statusEl = loadingPlaceholder.querySelector('.iig-status');
    const setStatus = (text) => {
        if (statusEl && statusEl.isConnected) statusEl.textContent = text;
    };

    // Synthetic tag keyed by instruction so a second click aborts the first request.
    const fakeTag = { fullMatch: instruction || data.prompt || '', prompt: data.prompt || '' };
    const { controller, key } = beginGeneration(messageId, fakeTag);
    tagAbortControllers.set(tagId, controller); // enable Stop button for this placeholder

    try {
        const dataUrl = await generateImageWithRetry(
            data.prompt || '',
            data.style || '',
            setStatus,
            {
                aspectRatio: data.aspect_ratio || data.aspectRatio || null,
                imageSize: data.image_size || data.imageSize || null,
                quality: data.quality || null,
                preset: data.preset || null,
                signal: controller.signal,
            }
        );

        setStatus('Saving...');
        const imagePath = await saveImageToFile(dataUrl);

        const newImg = document.createElement('img');
        newImg.className = 'iig-generated-image';
        newImg.src = imagePath;
        newImg.alt = data.prompt || '';
        newImg.title = `Style: ${data.style || ''}\nPrompt: ${data.prompt || ''}`;
        newImg.setAttribute('data-iig-instruction', instruction);

        if (loadingPlaceholder._timerInterval) clearInterval(loadingPlaceholder._timerInterval);

        const newWrapper = wrapImageWithActions(newImg);
        loadingPlaceholder.replaceWith(newWrapper);

        const oldSrc = imgElement.getAttribute('src') || '';
        if (oldSrc) replaceSrcEverywhere(message, oldSrc, imagePath);

        sessionGenCount++;
        updateSessionStats();
        await context.saveChat();
        scheduleWrapPass(); // re-wrap after ST re-renders from mes
        toastr.success('Image regenerated', 'Image Generation', { timeOut: 2000 });
    } catch (error) {
        const isAbort = error?.name === 'AbortError' || /aborted/i.test(error?.message || '');
        const isUserCancel = error === 'user-cancel' || error?.reason === 'user-cancel' || controller.signal.reason === 'user-cancel';

        // User Stop: restore the PREVIOUS image (mes was never changed, so nothing
        // to persist). Falls back to error.svg only if there was no real image.
        if (isUserCancel) {
            iigLog('INFO', 'Single image regeneration stopped by user');
            if (loadingPlaceholder._timerInterval) clearInterval(loadingPlaceholder._timerInterval);
            if (prevIsRealImage) {
                const restored = document.createElement('img');
                restored.className = 'iig-generated-image';
                restored.src = prevSrc;
                restored.alt = prevAlt;
                if (prevTitle) restored.title = prevTitle;
                restored.setAttribute('data-iig-instruction', instruction);
                loadingPlaceholder.replaceWith(wrapImageWithActions(restored));
            } else {
                const stopped = createErrorPlaceholder(tagId, 'Generation stopped — click retry', { fullMatch: `data-iig-instruction='${instruction}'` });
                loadingPlaceholder.replaceWith(wrapPlaceholderWithRetry(stopped));
            }
            toastr.info('Generation stopped', 'Image Generation', { timeOut: 2000 });
            return;
        }

        // Superseded by a newer request; silent cancel, no error UI.
        if (isAbort) {
            iigLog('INFO', 'Single image regeneration aborted (superseded by newer request)');
            if (loadingPlaceholder._timerInterval) clearInterval(loadingPlaceholder._timerInterval);
            return;
        }
        iigLog('ERROR', 'Single image regeneration failed:', error.message);

        const errorImg = document.createElement('img');
        errorImg.className = 'iig-error-image';
        errorImg.src = getErrorImagePath();
        errorImg.alt = 'Generation error';
        errorImg.title = `Error: ${error.message}`;
        errorImg.setAttribute('data-iig-instruction', instruction);

        if (loadingPlaceholder._timerInterval) clearInterval(loadingPlaceholder._timerInterval);
        loadingPlaceholder.replaceWith(wrapPlaceholderWithRetry(errorImg));

        sessionErrorCount++;
        updateSessionStats();
        toastr.error('Regeneration failed: ' + error.message, 'Image Generation');
        maybeSuggestFix(error);
    } finally {
        tagAbortControllers.delete(tagId);
        endGeneration(key, controller);
    }
}

/** Create a loading-placeholder element with spinner + elapsed timer. */
function createLoadingPlaceholder(tagId) {
    const placeholder = document.createElement('div');
    placeholder.className = 'iig-loading-placeholder';
    placeholder.dataset.tagId = tagId;
    placeholder.innerHTML = `
        <div class="iig-spinner-wrap">
            <div class="iig-spinner"></div>
        </div>
        <div class="iig-status">Generating image...</div>
        <div class="iig-timer"></div>
        <button type="button" class="iig-stop-btn" title="Stop generation" aria-label="Stop generation">
            ${SVG_ICON_STOP}<span class="iig-stop-label">Stop</span>
        </button>
    `;

    // Stop button: cancels only this placeholder's generation.
    const stopBtn = placeholder.querySelector('.iig-stop-btn');
    if (stopBtn) {
        stopBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            stopBtn.disabled = true;
            const lbl = stopBtn.querySelector('.iig-stop-label');
            if (lbl) lbl.textContent = 'Stopping...';
            abortGenerationForTag(tagId);
        });
    }

    const timerEl = placeholder.querySelector('.iig-timer');
    const startTime = Date.now();
    const tSec = FETCH_TIMEOUT / 1000;
    placeholder._timerInterval = setInterval(() => {
        // Self-clear if detached, so the timer doesn't leak against orphan nodes.
        if (!placeholder.isConnected) {
            clearInterval(placeholder._timerInterval);
            return;
        }
        const el = Math.floor((Date.now() - startTime) / 1000);
        if (el >= tSec) { timerEl.textContent = "Timeout..."; clearInterval(placeholder._timerInterval); return; }
        const m = Math.floor(el/60), s = el%60;
        timerEl.textContent = `${m}:${String(s).padStart(2,"0")} / ${Math.floor(tSec/60)}:00${IS_IOS ? " (iOS)" : ""}`;
    }, 1000);
    return placeholder;
}

/** Create an error placeholder <img> (error.svg + hover tooltip). */
function createErrorPlaceholder(tagId, errorMessage, tagInfo) {
    const img = document.createElement('img');
    img.className = 'iig-error-image';
    img.src = getErrorImagePath();
    img.alt = 'Generation error';
    img.title = `Error: ${errorMessage}`;
    img.dataset.tagId = tagId;
    
    if (tagInfo.fullMatch) {
        const instructionMatch = tagInfo.fullMatch.match(/data-iig-instruction\s*=\s*(?:(['"]))([\s\S]*?)\1/i)
            || tagInfo.fullMatch.match(/data-iig-instruction\s*=\s*([{][\s\S]*?[}])(?:\s|>)/i);
        if (instructionMatch) {
            const instructionValue = instructionMatch[2] || instructionMatch[1];
            img.setAttribute('data-iig-instruction', instructionValue);
        }
    }
    
    return img;
}

/**
 * Wrap an error placeholder <img> with a RETRY-ONLY action button (no download).
 * Click retries via the single-image/video regenerator. Retry needs the
 * preserved data-iig-instruction (image) or data-iig-video (video) attribute.
 */
function wrapPlaceholderWithRetry(imgElement) {
    if (imgElement.parentElement?.classList.contains('iig-image-wrapper')) return imgElement.parentElement;

    const isVideo = imgElement.hasAttribute('data-iig-video');
    const canRetry = isVideo || imgElement.hasAttribute('data-iig-instruction');
    if (!canRetry) return imgElement; // nothing to retry with — leave bare

    const wrapper = document.createElement('div');
    wrapper.className = 'iig-image-wrapper iig-placeholder-wrapper';

    const btnRegen = document.createElement('button');
    btnRegen.className = 'iig-action-btn iig-action-regen';
    btnRegen.innerHTML = SVG_ICON_REGENERATE;
    btnRegen.title = 'Retry';
    btnRegen.type = 'button';

    if (imgElement.parentElement) imgElement.replaceWith(wrapper);
    wrapper.appendChild(imgElement);
    wrapper.appendChild(btnRegen);

    btnRegen.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isVideo) regenerateSingleVideo(imgElement);
        else regenerateSingleImage(imgElement);
    });

    // Mobile: tap toggles the button (4s auto-hide), mirroring wrapImageWithActions.
    if (IS_MOBILE) {
        let _autoHideTimer = null;
        wrapper.addEventListener('click', (e) => {
            if (e.target.closest('.iig-action-btn')) return;
            e.preventDefault();
            e.stopPropagation();
            const isVisible = wrapper.classList.contains('iig-actions-visible');
            document.querySelectorAll('.iig-image-wrapper.iig-actions-visible').forEach(w => {
                if (w !== wrapper) w.classList.remove('iig-actions-visible');
            });
            if (isVisible) {
                wrapper.classList.remove('iig-actions-visible');
                clearTimeout(_autoHideTimer);
            } else {
                wrapper.classList.add('iig-actions-visible');
                clearTimeout(_autoHideTimer);
                _autoHideTimer = setTimeout(() => wrapper.classList.remove('iig-actions-visible'), 4000);
            }
        });
    }

    return wrapper;
}

/** Process all image-gen tags in a message: parse, generate, replace in mes, save. */
async function processMessageTags(messageId) {
    const context = getContext();
    const settings = getSettings();

    if (!settings.enabled) return;

    const procKey = buildProcessingKey(messageId);

    if (processingMessages.has(procKey)) {
        iigLog('WARN', `Message ${procKey} is already being processed, skipping`);
        return;
    }

    // Cooldown against the re-render loop that re-fires the event post-processing.
    const lastProcessed = recentlyProcessed.get(procKey);
    if (lastProcessed && (Date.now() - lastProcessed) < REPROCESS_COOLDOWN_MS) {
        iigLog('INFO', `Message ${procKey} was recently processed (${Date.now() - lastProcessed}ms ago), skipping re-trigger`);
        return;
    }

    // Race guard: claim the slot before any await so a second render can't
    // pass the has() check and start a concurrent generation.
    processingMessages.add(procKey);

    try {
        const message = context.chat[messageId];
        if (!message || message.is_user) {
            // Cooldown-stamp so repeated renders on user/empty msgs don't re-enter.
            recentlyProcessed.set(procKey, Date.now());
            return;
        }

        const tags = await parseMessageImageTags(message, { checkExistence: true });
        iigLog('INFO', `parseMessageImageTags returned: ${tags.length} tags`);
        if (tags.length > 0) {
            iigLog('INFO', `First tag: ${JSON.stringify(tags[0]).substring(0, 200)}`);
        }
        if (tags.length === 0) {
            iigLog('INFO', 'No tags found by parser');
            recentlyProcessed.set(procKey, Date.now());
            return;
        }

        iigLog('INFO', `Found ${tags.length} image tag(s) in message ${procKey}`);
        toastr.info(`Found ${tags.length} tag(s). Generating...`, 'Image Generation', { timeOut: 3000 });

        const messageElement = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
        if (!messageElement) {
            iigLog('ERROR', 'Message element not found for ID:', messageId);
            toastr.error('Could not find message element', 'Image Generation');
            return;
        }

        const mesTextEl = messageElement.querySelector('.mes_text');
        if (!mesTextEl) {
            return;
        }

        await _processMessageTagsInner(context, message, messageId, procKey, tags, mesTextEl);
    } finally {
        processingMessages.delete(procKey);
    }
}

/** Split from processMessageTags so the outer try/finally always releases the processing slot. */
async function _processMessageTagsInner(context, message, messageId, procKey, tags, mesTextEl) {
    
    const processTag = async (tag, index) => {
        const tagId = `iig-${messageId}-${index}`;
        
        iigLog('INFO', `Processing tag ${index}: ${tag.fullMatch.substring(0, 50)}`);
        
        const loadingPlaceholder = createLoadingPlaceholder(tagId);
        let targetElement = null;

        const isVideo = tag.mediaType === 'video';

        if (isVideo) {
            // Video tags render as <img data-iig-video=... src="[VID:GEN]">.
            const vidImgs = mesTextEl.querySelectorAll('img[data-iig-video]');
            const promptHead = (tag.prompt || '').substring(0, 30);
            for (const img of vidImgs) {
                if (img.hasAttribute('data-iig-claimed')) continue; // taken by a parallel tag
                const instr = img.getAttribute('data-iig-video') || '';
                const decoded = instr
                    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
                    .replace(/&#39;/g, "'").replace(/&#34;/g, '"').replace(/&amp;/g, '&');
                if (promptHead && decoded.includes(promptHead)) { targetElement = img; img.setAttribute('data-iig-claimed', '1'); break; }
            }
            if (!targetElement) {
                for (const img of vidImgs) {
                    const src = img.getAttribute('src') || '';
                    if (src.includes('[VID:GEN]') || src.includes('[VID:ERROR]') || !src || src === '#') {
                        targetElement = img; break;
                    }
                }
            }
            // [VID:GEN:{...}] form: swap a placeholder span in by raw text.
            if (!targetElement && !tag.isNewFormat) {
                const tagEscaped = tag.fullMatch
                    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                    .replace(/"/g, '(?:"|&quot;)');
                const before = mesTextEl.innerHTML;
                mesTextEl.innerHTML = mesTextEl.innerHTML.replace(
                    new RegExp(tagEscaped, 'g'),
                    `<span data-iig-placeholder="${tagId}"></span>`
                );
                if (before !== mesTextEl.innerHTML) {
                    targetElement = mesTextEl.querySelector(`[data-iig-placeholder="${tagId}"]`);
                }
            }
        } else if (tag.isNewFormat) {
            const allImgs = mesTextEl.querySelectorAll('img[data-iig-instruction]');
            iigLog('INFO', `Searching for img element. Found ${allImgs.length} img[data-iig-instruction] elements in DOM`);
            
            const searchPrompt = tag.prompt.substring(0, 30);
            iigLog('INFO', `Searching for prompt starting with: "${searchPrompt}"`);
            
            for (const img of allImgs) {
                if (img.hasAttribute('data-iig-claimed')) continue; // taken by a parallel tag
                const instruction = img.getAttribute('data-iig-instruction');
                const src = img.getAttribute('src') || '';
                iigLog('INFO', `DOM img - src: "${src.substring(0, 50)}", instruction (first 100): "${instruction?.substring(0, 100)}"`);
                
                if (instruction) {
                    const decodedInstruction = instruction
                        .replace(/&quot;/g, '"')
                        .replace(/&apos;/g, "'")
                        .replace(/&#39;/g, "'")
                        .replace(/&#34;/g, '"')
                        .replace(/&amp;/g, '&');
                    
                    const normalizedSearchPrompt = searchPrompt
                        .replace(/&quot;/g, '"')
                        .replace(/&apos;/g, "'")
                        .replace(/&#39;/g, "'")
                        .replace(/&#34;/g, '"')
                        .replace(/&amp;/g, '&');
                    
                    if (decodedInstruction.includes(normalizedSearchPrompt)) {
                        iigLog('INFO', `Found img element via decoded instruction match`);
                        targetElement = img;
                        img.setAttribute('data-iig-claimed', '1');
                        break;
                    }
                    
                    try {
                        const instructionData = parseInstructionObject(decodedInstruction);
                        if (instructionData.prompt && instructionData.prompt.substring(0, 30) === tag.prompt.substring(0, 30)) {
                            iigLog('INFO', `Found img element via JSON prompt match`);
                            targetElement = img;
                            img.setAttribute('data-iig-claimed', '1');
                            break;
                        }
                    } catch (e) {
                        // Parse failed; try next strategy.
                    }
                    
                    if (instruction.includes(searchPrompt)) {
                        iigLog('INFO', `Found img element via raw instruction match`);
                        targetElement = img;
                        img.setAttribute('data-iig-claimed', '1');
                        break;
                    }
                }
            }
            
            if (!targetElement) {
                iigLog('INFO', `Prompt matching failed, trying src marker matching...`);
                for (const img of allImgs) {
                    const src = img.getAttribute('src') || '';
                    if (src.includes('[IMG:GEN]') || src.includes('[IMG:ERROR]') || src === '' || src === '#') {
                        iigLog('INFO', `Found img element with generation marker in src: "${src}"`);
                        targetElement = img;
                        break;
                    }
                }
            }
            
            if (!targetElement) {
                iigLog('INFO', `Trying broader img search...`);
                const allImgsInMes = mesTextEl.querySelectorAll('img');
                for (const img of allImgsInMes) {
                    const src = img.getAttribute('src') || '';
                    if (src.includes('[IMG:GEN]') || src.includes('[IMG:ERROR]')) {
                        iigLog('INFO', `Found img via broad search with marker src: "${src.substring(0, 50)}"`);
                        targetElement = img;
                        break;
                    }
                }
            }
        } else {
            // [IMG:GEN:{...}] tag — swap in a placeholder span.
            const tagEscaped = tag.fullMatch
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/"/g, '(?:"|&quot;)');
            const tagRegex = new RegExp(tagEscaped, 'g');
            
            const beforeReplace = mesTextEl.innerHTML;
            mesTextEl.innerHTML = mesTextEl.innerHTML.replace(
                tagRegex,
                `<span data-iig-placeholder="${tagId}"></span>`
            );
            
            if (beforeReplace !== mesTextEl.innerHTML) {
                targetElement = mesTextEl.querySelector(`[data-iig-placeholder="${tagId}"]`);
                iigLog('INFO', `Legacy tag replaced with placeholder span`);
            }
            
            if (!targetElement) {
                const allImgs = mesTextEl.querySelectorAll('img');
                for (const img of allImgs) {
                    if (img.src && img.src.includes('[IMG:GEN:')) {
                        targetElement = img;
                        iigLog('INFO', `Found img with legacy tag in src`);
                        break;
                    }
                }
            }
        }
        
        if (targetElement) {
            const parent = targetElement.parentElement;
            if (parent) {
                const parentStyle = window.getComputedStyle(parent);
                if (parentStyle.display === 'flex' || parentStyle.display === 'grid') {
                    loadingPlaceholder.style.alignSelf = 'center';
                }
            }
            targetElement.replaceWith(loadingPlaceholder);
            iigLog('INFO', `Loading placeholder shown (replaced target element)`);
        } else {
            iigLog('WARN', `Could not find target element, appending placeholder as fallback`);
            mesTextEl.appendChild(loadingPlaceholder);
        }
        
        const statusEl = loadingPlaceholder.querySelector('.iig-status');
        const setStatus = (text) => {
            if (statusEl && statusEl.isConnected) statusEl.textContent = text;
        };

        // Abort controller: a manual regenerate during auto-gen cancels us.
        const { controller, key } = beginGeneration(messageId, tag);
        tagAbortControllers.set(tagId, controller); // enable Stop button for this placeholder

        try {
            if (isVideo) {
                const media = await generateVideoWithRetry(
                    tag.prompt,
                    setStatus,
                    {
                        aspectRatio: tag.aspectRatio,
                        duration: tag.duration,
                        resolution: tag.resolution,
                        audio: tag.audio,
                        negativePrompt: tag.negativePrompt,
                        refMode: tag.refMode,
                        signal: controller.signal,
                    }
                );

                setStatus('Saving...');
                const saved = await saveVideoToFile(media);
                const videoPath = saved.path;

                const videoEl = buildVideoElement(videoPath, tag);
                if (loadingPlaceholder._timerInterval) clearInterval(loadingPlaceholder._timerInterval);
                const wrappedVid = wrapVideoWithActions(videoEl);
                loadingPlaceholder.replaceWith(wrappedVid);

                let replacement;
                if (tag.isNewFormat) {
                    replacement = tag.fullMatch.replace(/src\s*=\s*(['"])[^'"]*\1/i, `src="${videoPath}"`);
                } else {
                    replacement = `[VID:✓:${videoPath}]`;
                }

                iigLog('INFO', `Successfully generated video for tag ${index} (persisted=${saved.persisted})`);
                sessionGenCount++;
                updateSessionStats();
                if (!saved.persisted) {
                    toastr.warning(`Video ${index + 1}/${tags.length} ready, but could not be saved to the server — the link is temporary. Download it to keep it.`, 'Image Generation', { timeOut: 6000 });
                } else {
                    toastr.success(`Video ${index + 1}/${tags.length} ready`, 'Image Generation', { timeOut: 2000 });
                }
                return { tag, replacement, ok: true };
            }

            const dataUrl = await generateImageWithRetry(
                tag.prompt,
                tag.style,
                setStatus,
                {
                    aspectRatio: tag.aspectRatio,
                    imageSize: tag.imageSize,
                    quality: tag.quality,
                    preset: tag.preset,
                    signal: controller.signal,
                }
            );

            setStatus('Saving...');
            const imagePath = await saveImageToFile(dataUrl);

            const img = document.createElement('img');
            img.className = 'iig-generated-image';
            img.src = imagePath;
            img.alt = tag.prompt;
            img.title = `Style: ${tag.style}\nPrompt: ${tag.prompt}`;

            if (tag.isNewFormat) {
                const instructionMatch = tag.fullMatch.match(/data-iig-instruction\s*=\s*(['"])([\s\S]*?)\1/i);
                if (instructionMatch) {
                    img.setAttribute('data-iig-instruction', instructionMatch[2]);
                }
            }

            if (loadingPlaceholder._timerInterval) clearInterval(loadingPlaceholder._timerInterval);
            const wrappedImg = wrapImageWithActions(img);
            loadingPlaceholder.replaceWith(wrappedImg);

            // Defer the mes write to the serial-apply loop (avoids R-M-W races).
            let replacement;
            if (tag.isNewFormat) {
                replacement = tag.fullMatch.replace(/src\s*=\s*(['"])[^'"]*\1/i, `src="${imagePath}"`);
            } else {
                replacement = `[IMG:✓:${imagePath}]`;
            }

            iigLog('INFO', `Successfully generated image for tag ${index}`);
            sessionGenCount++;
            updateSessionStats();
            toastr.success(`Image ${index + 1}/${tags.length} ready`, 'Image Generation', { timeOut: 2000 });

            return { tag, replacement, ok: true };
        } catch (error) {
            const isAbort = error?.name === 'AbortError' || /aborted/i.test(error?.message || '');
            const isUserCancel = error === 'user-cancel' || error?.reason === 'user-cancel' || controller.signal.reason === 'user-cancel';

            // Supersede (newer gen took over) — silent; the newer path owns DOM/mes.
            if (isAbort && !isUserCancel) {
                iigLog('INFO', `Tag ${index} aborted (superseded)`);
                if (loadingPlaceholder._timerInterval) clearInterval(loadingPlaceholder._timerInterval);
                return { tag, replacement: null, ok: false, aborted: true };
            }

            // User Stop on a FRESH generation (no previous image) -> error.svg.
            if (isUserCancel) {
                iigLog('INFO', `Tag ${index} stopped by user`);
                const stoppedPlaceholder = createErrorPlaceholder(tagId, 'Generation stopped — click retry', tag);
                if (loadingPlaceholder._timerInterval) clearInterval(loadingPlaceholder._timerInterval);
                loadingPlaceholder.replaceWith(wrapPlaceholderWithRetry(stoppedPlaceholder));
                let replacement;
                if (tag.isNewFormat) {
                    replacement = tag.fullMatch.replace(/src\s*=\s*(['"])[^'"]*\1/i, `src="${escapeAttrPath(getErrorImagePath())}"`);
                } else {
                    replacement = isVideo ? `[VID:ERROR:stopped]` : `[IMG:ERROR:stopped]`;
                }
                toastr.info('Generation stopped', 'Image Generation', { timeOut: 2000 });
                return { tag, replacement, ok: false, aborted: true };
            }

            iigLog('ERROR', `Failed to generate ${isVideo ? 'video' : 'image'} for tag ${index}:`, error.message);

            const errorPlaceholder = createErrorPlaceholder(tagId, error.message, tag);
            if (loadingPlaceholder._timerInterval) clearInterval(loadingPlaceholder._timerInterval);
            loadingPlaceholder.replaceWith(wrapPlaceholderWithRetry(errorPlaceholder));

            let replacement;
            if (tag.isNewFormat) {
                replacement = tag.fullMatch.replace(/src\s*=\s*(['"])[^'"]*\1/i, `src="${escapeAttrPath(getErrorImagePath())}"`);
            } else {
                replacement = isVideo
                    ? `[VID:ERROR:${error.message.substring(0, 50)}]`
                    : `[IMG:ERROR:${error.message.substring(0, 50)}]`;
            }
            iigLog('INFO', `Marked tag as failed in message source`);
            sessionErrorCount++;
            updateSessionStats();

            toastr.error(`Generation error: ${error.message}`, 'Image Generation');
            maybeSuggestFix(error);

            return { tag, replacement, ok: false, error };
        } finally {
            tagAbortControllers.delete(tagId);
            endGeneration(key, controller);
        }
    };

    
    let results = [];
    try {
        // Generate in parallel, collect replacements — don't mutate message.mes yet.
        // Each tag owns its own tagId/placeholder/AbortController, so a per-image
        // Stop targets only that generation.
        results = await Promise.all(tags.map((tag, index) => processTag(tag, index)));
    } finally {
        iigLog('INFO', `Finished processing message ${procKey}`);

        // Clear transient claim markers so a later re-process starts fresh.
        try { mesTextEl?.querySelectorAll('[data-iig-claimed]').forEach(el => el.removeAttribute('data-iig-claimed')); } catch (_) {}

        // Apply replacements serially after all tasks settle; re-read the live
        // message in case ST mutated it during generation.
        const liveMessage = context.chat[messageId] || message;
        let applied = 0;
        for (const r of results) {
            if (r && r.tag && typeof r.replacement === 'string') {
                try {
                    replaceTagInMessageSource(liveMessage, r.tag, r.replacement);
                    applied++;
                } catch (e) {
                    iigLog('WARN', `Failed to apply replacement for tag: ${e.message}`);
                }
            }
        }
        iigLog('INFO', `Applied ${applied}/${results.length} tag replacements to message source`);

        // Stamp cooldown BEFORE saveChat to block CHARACTER_MESSAGE_RENDERED re-entry.
        recentlyProcessed.set(procKey, Date.now());

        await context.saveChat();

        // DO NOT call messageFormatting() or mutate innerHTML here: it can
        // stack-overflow on complex HTML and re-fire CHARACTER_MESSAGE_RENDERED.
        // Images are already swapped in-place; ST re-formats on the next render.
    }
}

/** Regenerate every image in a message (user-triggered). Matches tags to <img> by index. */
async function regenerateMessageImages(messageId) {
    const context = getContext();
    const message = context.chat[messageId];
    
    if (!message) {
        toastr.error('Message not found', 'Image Generation');
        return;
    }
    
    const tags = await parseMessageImageTags(message, { forceAll: true });
    
    if (tags.length === 0) {
        toastr.warning('No tags to regenerate', 'Image Generation');
        return;
    }
    
    iigLog('INFO', `Regenerating ${tags.length} images in message ${messageId}`);
    toastr.info(`Regenerating ${tags.length} image(s)...`, 'Image Generation');

    const regenKey = buildProcessingKey(messageId);
    processingMessages.add(regenKey);

    const messageElement = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    if (!messageElement) {
        processingMessages.delete(regenKey);
        return;
    }

    const mesTextEl = messageElement.querySelector('.mes_text');
    if (!mesTextEl) {
        processingMessages.delete(regenKey);
        return;
    }
    
    const regenTag = async (tag, index) => {
        const tagId = `iig-regen-${messageId}-${index}`;
        // Hoisted so the catch can swap/restore.
        let loadingPlaceholder = null;
        let prevSrc = '', prevAlt = '', prevTitle = '', instruction = null, prevIsRealImage = false;

        try {
            // Match image to tag by prompt, not index (DOM order may differ).
            const allInstructionImgs = mesTextEl.querySelectorAll('img[data-iig-instruction]');
            let existingImg = null;
            const tagPromptHead = (tag.prompt || '').substring(0, 30);
            for (const img of allInstructionImgs) {
                const rawInstr = img.getAttribute('data-iig-instruction') || '';
                const decoded = rawInstr
                    .replace(/&quot;/g, '"')
                    .replace(/&apos;/g, "'")
                    .replace(/&#39;/g, "'")
                    .replace(/&#34;/g, '"')
                    .replace(/&amp;/g, '&');
                if (tagPromptHead && decoded.includes(tagPromptHead)) {
                    existingImg = img;
                    break;
                }
                try {
                    const parsed = parseInstructionObject(decoded);
                    if (parsed?.prompt && parsed.prompt.substring(0, 30) === tagPromptHead) {
                        existingImg = img;
                        break;
                    }
                } catch (_) {}
            }
            // Positional fallback; skip already-claimed imgs so duplicate prompts pick distinct targets.
            if (!existingImg && allInstructionImgs[index] && !allInstructionImgs[index].hasAttribute('data-iig-claimed')) {
                existingImg = allInstructionImgs[index];
            }
            if (existingImg) existingImg.setAttribute('data-iig-claimed', '1');

            if (existingImg) {
                instruction = existingImg.getAttribute('data-iig-instruction');

                // Capture the PREVIOUS image up front so a user Stop can restore it.
                prevSrc = existingImg.getAttribute('src') || '';
                prevAlt = existingImg.getAttribute('alt') || '';
                prevTitle = existingImg.getAttribute('title') || '';
                prevIsRealImage = !!prevSrc && !prevSrc.includes('error.svg') && !prevSrc.includes('[IMG:');

                // Replace the wrapper (if present) or the img itself with loading placeholder
                const existingWrapper = existingImg.closest('.iig-image-wrapper');
                loadingPlaceholder = createLoadingPlaceholder(tagId);
                if (existingWrapper) {
                    existingWrapper.replaceWith(loadingPlaceholder);
                } else {
                    existingImg.replaceWith(loadingPlaceholder);
                }
                
                const statusEl = loadingPlaceholder.querySelector('.iig-status');
                const setStatus = (text) => {
                    // Drop updates silently if placeholder was detached (chat switch, regen spam).
                    if (statusEl && statusEl.isConnected) statusEl.textContent = text;
                };

                // Per-tag abort controller; a second "regenerate all" click cancels in-flight tags.
                const { controller, key } = beginGeneration(messageId, tag);
                tagAbortControllers.set(tagId, controller); // enable Stop button for this placeholder

                try {
                    const dataUrl = await generateImageWithRetry(
                        tag.prompt,
                        tag.style,
                        setStatus,
                        {
                            aspectRatio: tag.aspectRatio,
                            imageSize: tag.imageSize,
                            quality: tag.quality,
                            preset: tag.preset,
                            signal: controller.signal,
                        }
                    );

                    setStatus('Saving...');
                    const imagePath = await saveImageToFile(dataUrl);

                    const img = document.createElement('img');
                    img.className = 'iig-generated-image';
                    img.src = imagePath;
                    img.alt = tag.prompt;
                    if (instruction) {
                        img.setAttribute('data-iig-instruction', instruction);
                    }
                    if (loadingPlaceholder._timerInterval) clearInterval(loadingPlaceholder._timerInterval);
                    const wrappedImg = wrapImageWithActions(img);
                    loadingPlaceholder.replaceWith(wrappedImg);

                    const updatedTag = tag.fullMatch.replace(/src\s*=\s*(['"])[^'"]*\1/i, `src="${imagePath}"`);
                    replaceTagInMessageSource(message, tag, updatedTag);

                    toastr.success(`Image ${index + 1}/${tags.length} ready`, 'Image Generation', { timeOut: 2000 });
                } finally {
                    tagAbortControllers.delete(tagId);
                    endGeneration(key, controller);
                }
            }
        } catch (error) {
            const isUserCancel = error === 'user-cancel' || error?.reason === 'user-cancel';
            const isAbort = isUserCancel || error?.name === 'AbortError' || /aborted/i.test(error?.message || '');

            // User Stop: restore the PREVIOUS image (mes untouched here, so nothing
            // to persist). Falls back to error.svg only if there was no real image.
            if (isUserCancel) {
                iigLog('INFO', `Regeneration tag ${index} stopped by user`);
                if (loadingPlaceholder?._timerInterval) clearInterval(loadingPlaceholder._timerInterval);
                if (loadingPlaceholder?.isConnected) {
                    if (prevIsRealImage) {
                        const restored = document.createElement('img');
                        restored.className = 'iig-generated-image';
                        restored.src = prevSrc;
                        restored.alt = prevAlt;
                        if (prevTitle) restored.title = prevTitle;
                        if (instruction) restored.setAttribute('data-iig-instruction', instruction);
                        loadingPlaceholder.replaceWith(wrapImageWithActions(restored));
                    } else {
                        const stopped = createErrorPlaceholder(tagId, 'Generation stopped — click retry', tag);
                        loadingPlaceholder.replaceWith(wrapPlaceholderWithRetry(stopped));
                    }
                }
                toastr.info('Generation stopped', 'Image Generation', { timeOut: 2000 });
                return;
            }

            // Superseded by a newer request; silent.
            if (isAbort) {
                iigLog('INFO', `Regeneration tag ${index} aborted (superseded)`);
                if (loadingPlaceholder?._timerInterval) clearInterval(loadingPlaceholder._timerInterval);
                return;
            }
            iigLog('ERROR', `Regeneration failed for tag ${index}:`, error.message);

            // Swap the stuck loading placeholder for an error image (else it
            // spins on "Generating..." forever).
            if (loadingPlaceholder) {
                if (loadingPlaceholder._timerInterval) clearInterval(loadingPlaceholder._timerInterval);
                if (loadingPlaceholder.isConnected) {
                    loadingPlaceholder.replaceWith(wrapPlaceholderWithRetry(createErrorPlaceholder(tagId, error.message, tag)));
                }
            }
            // Persist the error path so DOM and mes stay in sync on reload.
            // (This tag was already an error/placeholder image — nothing good is lost.)
            if (tag.isNewFormat) {
                const errorTag = tag.fullMatch.replace(/src\s*=\s*(['"])[^'"]*\1/i, `src="${escapeAttrPath(getErrorImagePath())}"`);
                replaceTagInMessageSource(message, tag, errorTag);
            }

            toastr.error(`Error: ${error.message}`, 'Image Generation');
            maybeSuggestFix(error);
        }
    };

    // Regenerate all tags in PARALLEL (each owns its own placeholder/controller).
    await Promise.all(tags.map((tag, index) => regenTag(tag, index)));
    
    // Clear transient claim markers so the next regen pass starts fresh.
    mesTextEl.querySelectorAll('img[data-iig-claimed]').forEach(img => img.removeAttribute('data-iig-claimed'));

    processingMessages.delete(regenKey);
    recentlyProcessed.set(regenKey, Date.now());
    await context.saveChat();
    iigLog('INFO', `Regeneration complete for message ${messageId}`);
    // Re-wrap after ST re-renders from mes, so action buttons survive.
    scheduleWrapPass();
}

/** Add a regenerate button to a message's .extraMesButtons menu. */
function addRegenerateButton(messageElement, messageId) {
    if (messageElement.querySelector('.iig-regenerate-btn')) return;
    
    const extraMesButtons = messageElement.querySelector('.extraMesButtons');
    if (!extraMesButtons) return;
    
    const btn = document.createElement('div');
    btn.className = 'mes_button iig-regenerate-btn fa-solid fa-images interactable';
    btn.title = 'Regenerate images';
    btn.tabIndex = 0;
    btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await regenerateMessageImages(messageId);
    });
    
    extraMesButtons.appendChild(btn);
}

// Reloaded video tags serialize as a broken <img data-iig-video src="/x.mp4">.
// Convert finished ones to wrapped <video>; leave pending/error tags alone.
function convertReloadedVideoImgs(root = document) {
    const candidates = root.querySelectorAll
        ? root.querySelectorAll('img[data-iig-video]')
        : [];
    let converted = 0;
    for (const img of candidates) {
        if (img.parentElement?.classList.contains('iig-image-wrapper')) continue;
        const src = img.getAttribute('src') || '';
        if (!src || src.includes('[VID:') || src.includes('error.svg')) continue;
        const instruction = img.getAttribute('data-iig-video') || '';
        const video = buildVideoElement(src, { isNewFormat: false });
        if (instruction) video.setAttribute('data-iig-video', instruction);
        img.replaceWith(video);
        wrapVideoWithActions(video);
        converted++;
    }
    if (converted > 0) iigLog('INFO', `Converted ${converted} reloaded video tag(s) to <video>`);
}

/** Wrap already-rendered generated images on chat load/change. */
function wrapExistingImages() {
    convertReloadedVideoImgs(document);

    // Match both freshly-generated (class) and reloaded-from-mes (attribute) images.
    const images = document.querySelectorAll('#chat .iig-generated-image, #chat img[data-iig-instruction]');
    let count = 0;
    for (const img of images) {
        if (img.parentElement?.classList.contains('iig-image-wrapper')) continue;
        const src = img.getAttribute('src') || '';
        if (!src || src === '[IMG:GEN]') continue;
        // Error placeholders persist as plain <img data-iig-instruction
        // src=".../error.svg">. Give them the error class + a RETRY-only button.
        if (src.includes('error.svg')) {
            img.classList.add('iig-error-image');
            img.classList.remove('iig-generated-image');
            wrapPlaceholderWithRetry(img);
            continue;
        }
        if (!img.classList.contains('iig-generated-image')) {
            img.classList.add('iig-generated-image');
        }
        wrapImageWithActions(img);
        count++;
    }
    if (count > 0) iigLog('INFO', `Wrapped ${count} existing images with action buttons`);

    // Wrap any already-present <video> elements (e.g. freshly generated).
    for (const video of document.querySelectorAll('#chat .iig-generated-video')) {
        if (video.parentElement?.classList.contains('iig-image-wrapper')) continue;
        wrapVideoWithActions(video);
    }
}

/** Watch #chat and wrap lazy-rendered generated media. Mutations batched 100ms. */
function initImageWrapObserver() {
    const chat = document.getElementById('chat');
    if (!chat || chat._iigObserver) return;

    let _pendingNodes = [];
    let _debounceTimer = null;

    const processPending = () => {
        _debounceTimer = null;
        const nodes = _pendingNodes;
        _pendingNodes = [];
        let wrapped = 0;
        // Single combined selector per node — one DOM traversal instead of three.
        const SEL = 'img[data-iig-video], video.iig-generated-video, img.iig-generated-image, img[data-iig-instruction]';
        for (const node of nodes) {
            if (!(node instanceof HTMLElement)) continue;

            const self = node.matches?.(SEL) ? [node] : [];
            const descendants = node.querySelectorAll?.(SEL) || [];
            const candidates = self.length ? [node, ...descendants] : descendants;

            for (const el of candidates) {
                // Reloaded video tag (<img data-iig-video src="/x.mp4">) — convert to
                // <video> first; the resulting element is wrapped on a later pass.
                if (el.tagName === 'IMG' && el.hasAttribute('data-iig-video')) {
                    convertReloadedVideoImgs(el.parentElement || document);
                    continue;
                }

                if (el.parentElement?.classList.contains('iig-image-wrapper')) continue;

                // Freshly-added generated <video>.
                if (el.tagName === 'VIDEO') {
                    wrapVideoWithActions(el);
                    wrapped++;
                    continue;
                }

                // Generated / reloaded <img>.
                const src = el.getAttribute('src') || '';
                // Skip not-yet-generated images (still streaming / placeholder).
                if (!src || src === '[IMG:GEN]' || src.startsWith('data:') && src.length < 100) continue;
                // Error placeholders: error class + RETRY-only button.
                if (src.includes('error.svg')) {
                    el.classList.add('iig-error-image');
                    el.classList.remove('iig-generated-image');
                    wrapPlaceholderWithRetry(el);
                    continue;
                }
                if (!el.classList.contains('iig-generated-image')) {
                    el.classList.add('iig-generated-image');
                }
                wrapImageWithActions(el);
                wrapped++;
            }
        }
        if (wrapped > 0) iigLog('INFO', `Observer wrapped ${wrapped} media element(s)`);
    };

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                _pendingNodes.push(node);
            }
        }
        // While streaming, just queue — skip the heavy pass until generation ends
        // (avoids running processPending ~10x/sec for the whole reply).
        if (_iigGenerating) return;
        if (!_debounceTimer) {
            _debounceTimer = setTimeout(processPending, _wrapDebounceMs());
        }
    });

    // Catch-up pass when generation ends: flush whatever queued during streaming.
    _iigFlushWrapQueue = () => {
        if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
        if (_pendingNodes.length) processPending();
    };

    observer.observe(chat, { childList: true, subtree: true });
    chat._iigObserver = observer;
    iigLog('INFO', 'Image wrap MutationObserver initialized (debounced)');
}

/** Add regenerate buttons to all existing AI messages in the chat. */
function addButtonsToExistingMessages() {
    const context = getContext();
    if (!context.chat || context.chat.length === 0) return;
    
    const messageElements = document.querySelectorAll('#chat .mes');
    let addedCount = 0;
    
    for (const messageElement of messageElements) {
        const mesId = messageElement.getAttribute('mesid');
        if (mesId === null) continue;
        
        const messageId = parseInt(mesId, 10);
        const message = context.chat[messageId];
        
        if (message && !message.is_user) {
            addRegenerateButton(messageElement, messageId);
            addedCount++;
        }
    }
    
    iigLog('INFO', `Added regenerate buttons to ${addedCount} existing messages`);
}

/** CHARACTER_MESSAGE_RENDERED handler. Depth-limited to block recursive re-entry. */
async function onMessageReceived(messageId) {
    // ST emits CHARACTER_MESSAGE_RENDERED from several paths; any can fire mid-
    // processing and stack-overflow without this depth guard.
    if (_eventHandlerDepth >= MAX_EVENT_HANDLER_DEPTH) {
        iigLog('WARN', `Blocked recursive onMessageReceived (depth=${_eventHandlerDepth}) for message ${messageId}`);
        return;
    }
    _eventHandlerDepth++;
    
    try {
        iigLog('INFO', `onMessageReceived: ${messageId}`);
        
        const settings = getSettings();
        if (!settings.enabled) {
            iigLog('INFO', 'Extension disabled, skipping');
            return;
        }
        
        const context = getContext();
        
        const messageElement = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
        if (!messageElement) return;
        
        addRegenerateButton(messageElement, messageId);
        
        await processMessageTags(messageId);
    } finally {
        _eventHandlerDepth--;
    }
}

/** Show/hide per-chat controls and update the scope status label. */
function updateRefScopeUI() {
    const perChatMode = getSettings().refScope === 'per-chat';
    const controls = document.getElementById('iig_per_chat_controls');
    if (controls) controls.classList.toggle('iig-hidden', !perChatMode);

    const scopeSel = document.getElementById('iig_ref_scope');
    if (scopeSel) scopeSel.value = perChatMode ? 'per-chat' : 'global';

    const label = document.getElementById('iig_ref_scope_label');
    if (label) {
        if (!perChatMode) { label.textContent = ''; return; }
        let chatLoaded = false, hasOwn = false;
        try {
            const ctx = getContext();
            const chatId = ctx?.chatId ?? ctx?.getCurrentChatId?.();
            chatLoaded = chatId !== undefined && chatId !== null && chatId !== '';
            hasOwn = !!ctx?.chatMetadata?.iig_refs;
        } catch (_) {}
        label.textContent = !chatLoaded
            ? 'No chat loaded — using global refs.'
            : (hasOwn ? 'This chat is using its OWN references.' : 'This chat has no saved refs — using the global set.');
    }
}

/** Render char/user/NPC reference slots in the settings panel (active scope). */
function renderRefSlots() {
    updateRefScopeUI();
    const settings = getActiveRefs();

    const setThumb = (slot, ref) => {
        const thumb = slot?.querySelector('.iig-ref-thumb');
        const wrap = slot?.querySelector('.iig-ref-thumb-wrap');
        if (!thumb) return;
        if (ref?.imagePath) { thumb.src = ref.imagePath; }
        else if (ref?.imageBase64) { thumb.src = 'data:image/jpeg;base64,' + ref.imageBase64; }
        else if (ref?.imageData) { thumb.src = 'data:image/jpeg;base64,' + ref.imageData; }
        else { thumb.src = ''; }
        if (wrap) wrap.classList.toggle('has-image', !!(ref?.imagePath || ref?.imageBase64 || ref?.imageData));
    };

    const charSlot = document.querySelector('.iig-ref-slot[data-ref-type="char"]');
    if (charSlot) {
        setThumb(charSlot, settings.charRef);
        charSlot.querySelector('.iig-ref-name').value = settings.charRef?.name || '';
    }

    const userSlot = document.querySelector('.iig-ref-slot[data-ref-type="user"]');
    if (userSlot) {
        setThumb(userSlot, settings.userRef);
        userSlot.querySelector('.iig-ref-name').value = settings.userRef?.name || '';
    }

    for (let i = 0; i < 4; i++) {
        const slot = document.querySelector(`.iig-ref-slot[data-ref-type="npc"][data-npc-index="${i}"]`);
        if (!slot) continue;
        const npc = settings.npcReferences[i] || null;
        setThumb(slot, npc);
        slot.querySelector('.iig-ref-name').value = npc?.name || '';
    }

    try { renderRecentRefsRibbon(); } catch (_) { /* ribbon not mounted yet on first call */ }
}

// =========================================================================
// Style Picker Logic
// =========================================================================

// --- Всплывающие окна для стилей ---
async function slayPromptInput(title, defaultValue = '') {
    const ctx = SillyTavern.getContext();
    try {
        if (typeof ctx.callGenericPopup === 'function') {
            const INPUT = ctx.POPUP_TYPE?.INPUT ?? 3;
            const res = await ctx.callGenericPopup(title, INPUT, String(defaultValue));
            return (typeof res === 'string') ? res : null;
        }
    } catch (e) { console.warn('callGenericPopup failed:', e.message); }
    const v = window.prompt(title, String(defaultValue));
    return v === null ? null : v;
}

async function slayConfirm(text) {
    const ctx = SillyTavern.getContext();
    try {
        if (typeof ctx.callGenericPopup === 'function') {
            const CONFIRM = ctx.POPUP_TYPE?.CONFIRM ?? 2;
            const res = await ctx.callGenericPopup(text, CONFIRM);
            return res === true || res === 1;
        }
    } catch (e) { console.warn('callGenericPopup failed:', e.message); }
    return window.confirm(text);
}
// --- КОНЕЦ Всплывающие окна ---

let selectedStyleId = '';
let styleSearchQuery = '';

function ensureStyles(settings = getSettings()) {
    if (!Array.isArray(settings.styles)) settings.styles = [];
    settings.styles = settings.styles.map((style, index) => ({
        id: String(style?.id || `iig-style-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`),
        name: String(style?.name || `Стиль ${index + 1}`).trim() || `Стиль ${index + 1}`,
        value: String(style?.value || '').trim(),
        imagePath: String(style?.imagePath || ''), // Новое поле для обложки
        isFavorite: Boolean(style?.isFavorite),    // Новое поле для избранного
        tags: Array.isArray(style?.tags) ? style.tags : [] // Новое поле для фильтров
    }));
    if (!settings.styles.some(style => style.id === settings.activeStyleId)) {
        settings.activeStyleId = '';
    }
    return settings.styles;
}

function createStyle(name = '') {
    const settings = getSettings();
    const styles = ensureStyles(settings);
    const style = {
        id: `iig-style-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: String(name || '').trim() || `Стиль ${styles.length + 1}`,
        value: '',
        imagePath: '',
        isFavorite: false,
        tags: []
    };
    styles.push(style);
    return style;
}

function updateStyle(styleId, patch) {
    const settings = getSettings();
    const style = ensureStyles(settings).find(item => item.id === styleId);
    if (!style) return null;
    if (Object.hasOwn(patch, 'name')) style.name = String(patch.name || '').trim() || style.name;
    if (Object.hasOwn(patch, 'value')) style.value = String(patch.value || '').trim();
    if (Object.hasOwn(patch, 'imagePath')) style.imagePath = String(patch.imagePath || '');
    if (Object.hasOwn(patch, 'isFavorite')) style.isFavorite = Boolean(patch.isFavorite);
    if (Object.hasOwn(patch, 'tags')) style.tags = Array.isArray(patch.tags) ? patch.tags : [];
    return style;
}

function removeStyle(styleId) {
    const settings = getSettings();
    const styles = ensureStyles(settings);
    const index = styles.findIndex(item => item.id === styleId);
    if (index === -1) return false;
    styles.splice(index, 1);
    if (settings.activeStyleId === styleId) settings.activeStyleId = '';
    return true;
}

function getSelectedStyle(settings = getSettings()) {
    const styles = ensureStyles(settings);
    if (!styles.some(style => style.id === selectedStyleId)) {
        selectedStyleId = styles.find(style => style.id === settings.activeStyleId)?.id || styles[0]?.id || '';
    }
    return styles.find(style => style.id === selectedStyleId) || null;
}

function getStylePreview(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return 'Пустой стиль';
    return text.length > 50 ? `${text.slice(0, 50).trimEnd()}...` : text;
}

/** Build and inject the settings panel into #extensions_settings. */
function createSettingsUI() {
    const settings = getSettings();
    const context = getContext();
    
    const container = document.getElementById('extensions_settings');
    if (!container) {
        iigLog('ERROR', 'Settings container not found');
        return;
    }

    let npcSlotsHtml = '';
    for (let i = 0; i < 4; i++) {
        npcSlotsHtml += `
            <div class="iig-ref-slot" data-ref-type="npc" data-npc-index="${i}">
                <div class="iig-ref-thumb-wrap">
                    <img src="" alt="NPC" class="iig-ref-thumb">
                    <div class="iig-ref-empty-icon"><i class="fa-solid fa-user-plus"></i></div>
                    <label class="iig-ref-upload-overlay" title="Upload photo">
                        <i class="fa-solid fa-camera"></i>
                        <input type="file" accept="image/*" class="iig-ref-file-input" style="display:none">
                    </label>
                </div>
                <div class="iig-ref-info">
                    <div class="iig-ref-label">NPC ${i + 1}</div>
                    <input type="text" class="text_pole iig-ref-name" placeholder="Name(s), comma-separated" value="">
                </div>
                <div class="iig-ref-actions">
                    <label class="menu_button iig-ref-upload-btn" title="Upload photo">
                        <i class="fa-solid fa-upload"></i>
                        <input type="file" accept="image/*" class="iig-ref-file-input" style="display:none">
                    </label>
                    <div class="menu_button iig-ref-delete-btn" title="Remove"><i class="fa-solid fa-trash-can"></i></div>
                </div>
            </div>`;
    }

    const html = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><i class="fa-solid fa-leaf"></i> ⊹ INLINE IMAGE GENERATION ⊹</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="iig-settings">
                    <p class="iig-settings-intro">Generate images inline from chat — set up your provider, defaults, and character references below.</p>
                    <label class="checkbox_label">
                        <input type="checkbox" id="iig_enabled" ${settings.enabled ? 'checked' : ''}>
                        <span>Enable image generation</span>
                    </label>
                    <label class="checkbox_label" style="margin-top: 6px;">
                        <input type="checkbox" id="iig_prompt_driven" ${settings.promptDriven ? 'checked' : ''}>
                        <span>Prompt-driven generation (tag overrides UI)</span>
                    </label>
                    <p class="hint">On: tag fields (<code>image_size</code>, <code>quality</code>, <code>preset</code>) win, UI is fallback. Off: UI values always apply. <code>aspect_ratio</code> is always tag-driven.</p>
                    
                    <hr>

                    <details class="iig-section iig-accordion" open>
                        <summary><h4><i class="fa-solid fa-plug"></i> API Configuration</h4></summary>

                        <!-- Preset save/load for quick provider swapping. -->
                        <div class="iig-presets-bar">
                            <select id="iig_preset_select" class="flex1" title="Load a saved API preset">
                                <option value="">-- Presets --</option>
                                ${(settings.presets || []).map(p => `<option value="${sanitizeForHtml(p.name)}" ${settings.activePresetName === p.name ? 'selected' : ''}>${sanitizeForHtml(p.name)}</option>`).join('')}
                            </select>
                            <div id="iig_preset_save" class="menu_button iig-preset-btn" title="Save current API settings as a new preset (or overwrite existing)">
                                <i class="fa-solid fa-floppy-disk"></i>
                            </div>
                            <div id="iig_preset_delete" class="menu_button iig-preset-btn" title="Delete the selected preset">
                                <i class="fa-solid fa-trash-can"></i>
                            </div>
                        </div>
                        <p class="hint">Save <b>apiType, endpoint, key, model</b> per provider for quick swapping. Stored locally in your SillyTavern settings.</p>

                        <div class="flex-row">
                            <label for="iig_api_type">API Type
                                <span class="iig-info" id="iig_api_type_info" tabindex="0" role="button" aria-label="API type info" title="${sanitizeForHtml(API_TYPE_TOOLTIPS[settings.apiType] || '')}">
                                    <i class="fa-solid fa-circle-question"></i>
                                </span>
                            </label>
                            <select id="iig_api_type" class="flex1">
                                <option value="openai" ${settings.apiType === 'openai' ? 'selected' : ''}>OpenAI-compatible</option>
                                <option value="gemini" ${settings.apiType === 'gemini' ? 'selected' : ''}>Gemini-compatible</option>
                                <option value="naistera" ${settings.apiType === 'naistera' ? 'selected' : ''}>Naistera</option>
                            </select>
                        </div>

                        <div class="flex-row" id="iig_endpoint_row">
                            <label for="iig_endpoint">Endpoint URL</label>
                            <input type="text" id="iig_endpoint" class="text_pole flex1"
                                   value="${sanitizeForHtml(settings.endpoint)}"
                                   placeholder="${ENDPOINT_PLACEHOLDERS[settings.apiType] || 'https://your-provider.example'}">
                        </div>
                        <p id="iig_endpoint_hint" class="hint">Include any path prefix your provider documents (e.g. <code>/compatible</code>, <code>/v1</code>); the extension appends the method suffix itself. The model dropdown lists whatever your provider returns.</p>

                        <div class="flex-row" id="iig_api_key_row">
                            <label for="iig_api_key">API Key</label>
                            <input type="password" id="iig_api_key" class="text_pole flex1"
                                   value="${sanitizeForHtml(settings.apiKey)}">
                            <div id="iig_key_toggle" class="menu_button iig-key-toggle" title="Show/Hide">
                                <i class="fa-solid fa-eye"></i>
                            </div>
                        </div>
                        <p id="iig_naistera_hint" class="hint ${settings.apiType === 'naistera' ? '' : 'iig-hidden'}">Naistera: paste token from their service. Endpoint auto-defaults to <code>naistera.org</code> if blank.</p>

                        <div class="flex-row ${settings.apiType === 'naistera' ? 'iig-hidden' : ''}" id="iig_model_row">
                            <label for="iig_model">Model</label>
                            <select id="iig_model" class="flex1">
                                ${settings.model ? `<option value="${sanitizeForHtml(settings.model)}" selected>${sanitizeForHtml(settings.model)}</option>` : '<option value="">-- Select model --</option>'}
                            </select>
                            <div id="iig_refresh_models" class="menu_button iig-refresh-btn" title="Refresh models list">
                                <i class="fa-solid fa-sync"></i>
                            </div>
                        </div>

                        <div id="iig_test_connection" class="menu_button iig-test-connection" title="Test API connection">
                            <i class="fa-solid fa-wifi"></i> Test Connection
                        </div>

                        <!-- Advanced: escape hatches for non-standard providers. -->
                        <details class="iig-advanced" ${settings.pathOverride || settings.showAllModels ? 'open' : ''}>
                            <summary><i class="fa-solid fa-wrench"></i> Advanced</summary>
                            <div class="iig-advanced-body">
                                <div class="flex-row">
                                    <label for="iig_path_override">Path override</label>
                                    <input type="text" id="iig_path_override" class="text_pole flex1"
                                           value="${sanitizeForHtml(settings.pathOverride || '')}"
                                           placeholder="/custom/path (optional)">
                                </div>
                                <p class="hint">Replaces the auto-appended path. Leave blank to use the default path for your API Type.</p>
                                <label class="checkbox_label" style="margin-top: 6px;">
                                    <input type="checkbox" id="iig_show_all_models" ${settings.showAllModels ? 'checked' : ''}>
                                    <span>Show all models (disable keyword filter)</span>
                                </label>
                                <p class="hint">Disables the built-in image-model keyword filter when listing <code>/v1/models</code> or <code>/v1beta/models</code>. Enable this if your provider's model names aren't recognized.</p>
                            </div>
                        </details>
                    </details>
                    
                    <hr>

                    <details class="iig-section iig-accordion">
                        <summary><h4><i class="fa-solid fa-sliders"></i> Generation Settings</h4></summary>

                        <!-- OpenAI params -->
                        <div class="flex-row ${settings.apiType !== 'openai' ? 'iig-hidden' : ''}" id="iig_size_row">
                            <label for="iig_size">Size</label>
                            <select id="iig_size" class="flex1">
                                <option value="1024x1024" ${settings.size === '1024x1024' ? 'selected' : ''}>1024x1024 (Square)</option>
                                <option value="1792x1024" ${settings.size === '1792x1024' ? 'selected' : ''}>1792x1024 (Landscape)</option>
                                <option value="1024x1792" ${settings.size === '1024x1792' ? 'selected' : ''}>1024x1792 (Portrait)</option>
                                <option value="512x512" ${settings.size === '512x512' ? 'selected' : ''}>512x512 (Small)</option>
                            </select>
                        </div>
                        
                        <div class="flex-row ${settings.apiType !== 'openai' ? 'iig-hidden' : ''}" id="iig_quality_row">
                            <label for="iig_quality">Quality</label>
                            <select id="iig_quality" class="flex1">
                                <option value="auto" ${settings.quality === 'auto' ? 'selected' : ''}>auto (gpt-image-*)</option>
                                <option value="low" ${settings.quality === 'low' ? 'selected' : ''}>low (gpt-image-*)</option>
                                <option value="medium" ${settings.quality === 'medium' ? 'selected' : ''}>medium (gpt-image-*)</option>
                                <option value="high" ${settings.quality === 'high' ? 'selected' : ''}>high (gpt-image-*)</option>
                                <option value="standard" ${settings.quality === 'standard' ? 'selected' : ''}>standard (dall-e-3)</option>
                                <option value="hd" ${settings.quality === 'hd' ? 'selected' : ''}>hd (dall-e-3)</option>
                            </select>
                        </div>
                        <p class="hint ${settings.apiType !== 'openai' ? 'iig-hidden' : ''}" id="iig_quality_hint">auto/low/medium/high for <code>gpt-image-*</code> models; standard/hd for <code>dall-e-3</code>. Mismatches are auto-normalized.</p>

                        <!-- Naistera params -->
                        <div class="flex-row ${settings.apiType === 'naistera' ? '' : 'iig-hidden'}" id="iig_naistera_model_row">
                            <label for="iig_naistera_model">Model</label>
                            <select id="iig_naistera_model" class="flex1">
                                ${NAISTERA_MODELS.map(m => `<option value="${sanitizeForHtml(m)}" ${normalizeNaisteraModel(settings.naisteraModel) === m ? 'selected' : ''}>${sanitizeForHtml(naisteraModelDisplayLabel(m))}</option>`).join('')}
                            </select>
                        </div>

                        <div class="flex-row ${settings.apiType === 'naistera' && naisteraModelSupportsPreset(settings.naisteraModel) ? '' : 'iig-hidden'}" id="iig_naistera_preset_row">
                            <label for="iig_naistera_preset">Preset</label>
                            <select id="iig_naistera_preset" class="flex1">
                                <option value="" ${!settings.naisteraPreset ? 'selected' : ''}>None</option>
                                <option value="digital" ${settings.naisteraPreset === 'digital' ? 'selected' : ''}>Digital</option>
                                <option value="realism" ${settings.naisteraPreset === 'realism' ? 'selected' : ''}>Realism</option>
                            </select>
                        </div>
                        <p class="hint ${settings.apiType === 'naistera' && naisteraModelSupportsPreset(settings.naisteraModel) ? '' : 'iig-hidden'}" id="iig_naistera_preset_hint">Grok style preset. Sent as <code>preset: "digital" | "realism"</code>. If you don't see a visual difference between the two, the Naistera upstream may be ignoring the field — try comparing against <b>None</b> to confirm it's doing anything at all.</p>
                        <label class="checkbox_label ${settings.apiType === 'naistera' ? '' : 'iig-hidden'}" id="iig_naistera_refs_row" style="margin-top: 6px;">
                            <input type="checkbox" id="iig_naistera_send_refs" ${settings.naisteraSendRefs !== false ? 'checked' : ''}>
                            <span>Send reference images (Naistera)</span>
                        </label>
                        <p class="hint ${settings.apiType === 'naistera' ? '' : 'iig-hidden'}" id="iig_naistera_refs_hint">Grok sometimes fails with refs attached. NovelAI-via-Naistera ignores refs entirely. Uncheck to skip sending refs under this API type.</p>

                        <!-- Gemini params. Aspect ratio is tag-driven; only resolution is UI. -->
                        <div id="iig_gemini_params" class="${settings.apiType !== 'gemini' ? 'iig-hidden' : ''}">
                            <div class="flex-row">
                                <label for="iig_image_size">Resolution</label>
                                <select id="iig_image_size" class="flex1">
                                    <option value="1K" ${settings.imageSize === '1K' ? 'selected' : ''}>1K (default)</option>
                                    <option value="2K" ${settings.imageSize === '2K' ? 'selected' : ''}>2K</option>
                                    <option value="4K" ${settings.imageSize === '4K' ? 'selected' : ''}>4K</option>
                                </select>
                            </div>
                            <label class="checkbox_label" style="margin-top: 6px;">
                                <input type="checkbox" id="iig_gemini_send_refs" ${settings.geminiSendRefs !== false ? 'checked' : ''}>
                                <span>Send reference images (Gemini)</span>
                            </label>
                            <p class="hint">Aspect ratio is set by the AI per image tag (<code>aspect_ratio</code> field). Override per-generation via OOC. Uncheck <b>Send reference images</b> to force text-only generation for providers/models that reject refs.</p>
                        </div>

                        <!-- Video params (OpenAI/Gemini-style providers, e.g. rout.my). -->
                        <div id="iig_video_params" class="${(settings.apiType === 'openai' || settings.apiType === 'gemini') ? '' : 'iig-hidden'}">
                            <hr>
                            <h4 style="margin-top:2px;"><i class="fa-solid fa-film"></i> Video</h4>
                            <p class="hint iig-video-warning"><i class="fa-solid fa-triangle-exclamation"></i> <b>Experimental / under development.</b> Video generation is unstable and may fail (provider 502s, temporary links). Use at your own risk.</p>
                            <div class="flex-row">
                                <label for="iig_video_model">Video model</label>
                                <input type="text" id="iig_video_model" class="text_pole flex1"
                                       value="${sanitizeForHtml(settings.videoModel || '')}"
                                       placeholder="e.g. google/veo-3.1-fast (blank = video off)">
                            </div>
                            <div class="flex-row">
                                <label for="iig_video_duration">Default duration (s)</label>
                                <input type="number" id="iig_video_duration" class="text_pole flex1"
                                       value="${settings.videoDuration}" min="1" max="60" step="1">
                            </div>
                            <div class="flex-row">
                                <label for="iig_video_resolution">Default resolution</label>
                                <select id="iig_video_resolution" class="flex1">
                                    <option value="480p" ${settings.videoResolution === '480p' ? 'selected' : ''}>480p</option>
                                    <option value="720p" ${settings.videoResolution === '720p' ? 'selected' : ''}>720p</option>
                                    <option value="1080p" ${settings.videoResolution === '1080p' ? 'selected' : ''}>1080p</option>
                                    <option value="4K" ${settings.videoResolution === '4K' ? 'selected' : ''}>4K</option>
                                </select>
                            </div>
                            <label class="checkbox_label" style="margin-top: 6px;">
                                <input type="checkbox" id="iig_video_audio" ${settings.videoAudio ? 'checked' : ''}>
                                <span>Request audio track (when the model supports it)</span>
                            </label>
                            <p class="hint">Set a Video model to enable video generation (AI uses a <code>[VID:GEN]</code> tag; its fields override these defaults). Named refs are sent as <b>identity references</b> by default — these need a reference-capable model (e.g. <code>seedance-2.0-fast</code> or a Wan <code>-r2v</code> model); Veo is text/first-frame only. Videos take a few minutes and are re-hosted on your server.</p>
                        </div>
                    </details>

                    <!-- Reference images — available for all providers. -->
                    <details id="iig_refs_section" class="iig-refs iig-accordion" open>
                        <summary><h4><i class="fa-solid fa-user-group"></i> Character References</h4></summary>
                        <p class="hint">Upload reference photos for consistent results (max 4 per request). Sent only when a slot's name appears in the prompt. Names support <b>comma-separated aliases</b> — e.g. <code>Elodie, Lodi, Ellie</code>.</p>

                        <label class="checkbox_label" style="margin-top: 4px;">
                            <input type="checkbox" id="iig_char_ref_always" ${settings.charRefAlways ? 'checked' : ''}>
                            <span>Always send Char reference (skip name match)</span>
                        </label>
                        <label class="checkbox_label" style="margin-top: 4px;">
                            <input type="checkbox" id="iig_user_ref_always" ${settings.userRefAlways ? 'checked' : ''}>
                            <span>Always send User reference (skip name match)</span>
                        </label>
                        <label class="checkbox_label" style="margin-top: 4px;">
                            <input type="checkbox" id="iig_skip_crop" ${settings.skipCrop ? 'checked' : ''}>
                            <span>Не предлагать обрезку при загрузке рефа</span>
                        </label>

                        <div class="flex-row" style="margin-top: 8px;">
                            <label for="iig_ref_scope">References</label>
                            <select id="iig_ref_scope" class="flex1">
                                <option value="global" ${settings.refScope !== 'per-chat' ? 'selected' : ''}>Global (same for every chat)</option>
                                <option value="per-chat" ${settings.refScope === 'per-chat' ? 'selected' : ''}>Per-chat (each chat remembers its own)</option>
                            </select>
                        </div>
                        <div id="iig_per_chat_controls" class="${settings.refScope === 'per-chat' ? '' : 'iig-hidden'}">
                            <p id="iig_ref_scope_label" class="hint" style="margin-top:2px;"></p>
                            <div class="iig-maintenance-row">
                                <div id="iig_refs_reset_to_global" class="menu_button iig-maint-btn" title="Delete THIS chat's own reference set (and remove its unshared image files) so it falls back to the global refs. Other chats are unaffected.">
                                    <i class="fa-solid fa-rotate-left"></i> Reset this chat to global
                                </div>
                            </div>
                        </div>
                        <p class="hint"><b>Per-chat</b> mode: each chat keeps its own reference set; editing a slot forks a copy for this chat, and chats without one fall back to global. <b>Reset this chat to global</b> clears only this chat's set.</p>

                        <div class="iig-refs-grid">
                            <div class="iig-refs-row iig-refs-main">
                                <div class="iig-ref-slot" data-ref-type="char">
                                    <div class="iig-ref-thumb-wrap">
                                        <img src="" alt="Char" class="iig-ref-thumb">
                                        <div class="iig-ref-empty-icon"><i class="fa-solid fa-user"></i></div>
                                        <label class="iig-ref-upload-overlay" title="Upload photo">
                                            <i class="fa-solid fa-camera"></i>
                                            <input type="file" accept="image/*" class="iig-ref-file-input" style="display:none">
                                        </label>
                                    </div>
                                    <div class="iig-ref-info">
                                        <div class="iig-ref-label">{{char}}</div>
                                        <input type="text" class="text_pole iig-ref-name" placeholder="Name(s), comma-separated" value="">
                                    </div>
                                    <div class="iig-ref-actions">
                                        <label class="menu_button iig-ref-upload-btn" title="Upload photo">
                                            <i class="fa-solid fa-upload"></i>
                                            <input type="file" accept="image/*" class="iig-ref-file-input" style="display:none">
                                        </label>
                                        <div class="menu_button iig-ref-delete-btn" title="Remove"><i class="fa-solid fa-trash-can"></i></div>
                                    </div>
                                </div>
                                
                                <!-- User slot -->
                                <div class="iig-ref-slot" data-ref-type="user">
                                    <div class="iig-ref-thumb-wrap">
                                        <img src="" alt="User" class="iig-ref-thumb">
                                        <div class="iig-ref-empty-icon"><i class="fa-solid fa-user"></i></div>
                                        <label class="iig-ref-upload-overlay" title="Upload photo">
                                            <i class="fa-solid fa-camera"></i>
                                            <input type="file" accept="image/*" class="iig-ref-file-input" style="display:none">
                                        </label>
                                    </div>
                                    <div class="iig-ref-info">
                                        <div class="iig-ref-label">{{user}}</div>
                                        <input type="text" class="text_pole iig-ref-name" placeholder="Name(s), comma-separated" value="">
                                    </div>
                                    <div class="iig-ref-actions">
                                        <label class="menu_button iig-ref-upload-btn" title="Upload photo">
                                            <i class="fa-solid fa-upload"></i>
                                            <input type="file" accept="image/*" class="iig-ref-file-input" style="display:none">
                                        </label>
                                        <div class="menu_button iig-ref-delete-btn" title="Remove"><i class="fa-solid fa-trash-can"></i></div>
                                    </div>
                                </div>
                            </div>

                            <div class="iig-refs-divider"><span>NPCs</span></div>

                            <div class="iig-refs-row iig-refs-npcs">
                                ${npcSlotsHtml}
                            </div>

                            <!-- Recent refs ribbon: last used ref images, tap → assign popup, drag → onto a slot -->
                            <div id="iig_recent_refs_ribbon" class="iig-recent-refs-ribbon"></div>
                            <!-- Assign popup: moved to <body> on first show (see showAssignPopup), position:fixed needs an unclipped ancestor -->
                            <div id="iig_assign_popup" class="iig-assign-popup"></div>
                        </div>
                    </details>
					
					<!-- Wardrobe -->
<details class="iig-section iig-accordion">
    <summary><h4><i class="fa-solid fa-shirt"></i> Гардероб</h4></summary>
    <p class="hint" id="slay_wardrobe_hint">Загрузите аутфиты для бота и юзера. Изображение активного аутфита отправится как референс, а словесное описание будет добавлено в промпт.</p>
    <div class="flex-row"><div id="slay_sw_open_wardrobe" class="menu_button" style="width:100%;"><i class="fa-solid fa-shirt"></i> Открыть гардероб</div></div>
    <label class="checkbox_label" style="margin-top:8px;"><input type="checkbox" id="slay_sw_auto_describe"><span>Авто-описание аутфитов через ИИ</span></label>
    
    <div id="slay_sw_describe_prompt_section" style="margin-top:6px;">
        <div class="flex-row"><label>Стиль описания</label><select id="slay_sw_describe_prompt_style" class="flex1"><option value="detailed">Детальный (costume designer)</option><option value="simple">Простой (краткий)</option></select></div>
    </div>

    <div id="slay_sw_describe_api_section" style="margin-top:8px;padding:12px;border-radius:10px;background:rgba(244,114,182,0.04);border:1px solid rgba(244,114,182,0.1);">
        <div class="flex-row"><label>Способ</label><select id="slay_sw_describe_mode" class="flex1"><option value="direct">Прямой API</option><option value="chat">Через чат-API</option></select></div>
        <div id="slay_sw_direct_api_section">
            <div class="flex-row" style="margin-top:6px;"><label>Формат API</label><select id="slay_sw_describe_api_format" class="flex1"><option value="auto">Авто (по имени модели)</option><option value="gemini">Gemini</option><option value="openai">OpenAI-compatible</option></select></div>
            <div class="flex-row" style="margin-top:6px;"><label>Endpoint</label><input type="text" id="slay_sw_describe_endpoint" class="text_pole flex1" placeholder="Из основных настроек"></div>
            <div class="flex-row" style="margin-top:6px;"><label>API Key</label><input type="password" id="slay_sw_describe_key" class="text_pole flex1" placeholder="Из основных настроек"><div id="slay_sw_describe_key_toggle" class="menu_button iig-key-toggle" title="Show/Hide"><i class="fa-solid fa-eye"></i></div></div>
            <div class="flex-row" style="margin-top:6px;"><label>Модель</label><input type="text" id="slay_sw_describe_model" class="text_pole flex1" list="slay_sw_describe_model_list" autocomplete="off" spellcheck="false"><datalist id="slay_sw_describe_model_list"></datalist><div id="slay_sw_describe_refresh" class="menu_button iig-refresh-btn" title="Обновить список"><i class="fa-solid fa-sync"></i></div></div>
            <div id="slay_sw_describe_test" class="menu_button iig-test-connection" style="margin-top:8px;"><i class="fa-solid fa-wifi"></i> Тест</div>
        </div>
    </div>

    <p class="hint" style="margin-top:10px;font-weight:600;color:var(--slay-pink,#f472b6);">Настройки гардероба:</p>
    <label class="checkbox_label" style="margin-top:4px;"><input type="checkbox" id="slay_sw_send_outfit_desc"><span>Отправлять текстовое описание аутфита</span></label>
    <label class="checkbox_label" style="margin-top:4px;"><input type="checkbox" id="slay_sw_send_outfit_image_bot"><span>Отправлять картинку одежды бота</span></label>
    <label class="checkbox_label" style="margin-top:4px;"><input type="checkbox" id="slay_sw_send_outfit_image_user"><span>Отправлять картинку одежды юзера</span></label>
    <label class="checkbox_label" style="margin-top:4px;"><input type="checkbox" id="slay_sw_collage"><span>ЭКСПЕРИМЕНТАЛЬНО: склеивать в коллаж</span></label>
    <label class="checkbox_label" style="margin-top:8px;"><input type="checkbox" id="slay_sw_skip_desc_warn"><span>Не спрашивать про описание при надевании</span></label>
    <label class="checkbox_label" style="margin-top:4px;"><input type="checkbox" id="slay_sw_show_float"><span>Плавающая кнопка в чате</span></label>
    <div class="flex-row" style="margin-top:6px;"><label>Макс. размер (px)</label><input type="number" id="slay_sw_max_dim" class="text_pole flex1" min="128" max="1024" step="64"></div>
    <div class="flex-row" style="margin-top:6px;"><label>Размер гардероба (ПК)</label><select id="slay_sw_modal_width" class="flex1"><option value="compact">Компактный (480px)</option><option value="normal">Обычный (560px)</option><option value="wide">Широкий (800px)</option><option value="xwide">Очень широкий (1100px)</option><option value="full">Во весь экран</option></select></div>
</details>

<!-- Styles -->
<div class="iig-section">
    <h4><i class="fa-solid fa-palette"></i> Библиотека стилей</h4>
    <p class="hint">Управляйте промптами стилей в отдельном окне с превью и тегами.</p>
    <div class="flex-row">
        <div id="iig_open_style_library" class="menu_button" style="width:100%;">
            <i class="fa-solid fa-swatchbook"></i> Открыть библиотеку
        </div>
    </div>
</div>

                    <details class="iig-section iig-accordion">
                        <summary><h4><i class="fa-solid fa-rotate"></i> Retry Settings</h4></summary>
                        
                        <div class="flex-row">
                            <label for="iig_max_retries">Max Retries</label>
                            <input type="number" id="iig_max_retries" class="text_pole flex1" 
                                   value="${settings.maxRetries}" min="0" max="5">
                        </div>
                        
                        <div class="flex-row">
                            <label for="iig_retry_delay">Delay (ms)</label>
                            <input type="number" id="iig_retry_delay" class="text_pole flex1" 
                                   value="${settings.retryDelay}" min="500" max="10000" step="500">
                        </div>
                        <p class="hint">Auto-retry on 429/502/503/504 errors. Set to 0 for manual retry only.</p>
                    </details>

                    <details class="iig-section iig-accordion">
                        <summary><h4><i class="fa-solid fa-bolt"></i> Performance</h4></summary>
                        <label class="checkbox_label">
                            <input type="checkbox" id="iig_low_power" ${settings.lowPowerMode ? 'checked' : ''}>
                            <span>Low-power mode</span>
                        </label>
                        <p class="hint">Reduces animations and background work to lower CPU, battery, and heat on weaker devices.</p>
                        <label class="checkbox_label" style="margin-top:6px;">
                            <input type="checkbox" id="iig_lp_anim" ${settings.lpDisableAnimations !== false ? 'checked' : ''} ${settings.lowPowerMode ? '' : 'disabled'}>
                            <span>Disable animations</span>
                        </label>
                        <label class="checkbox_label" style="margin-top:6px;">
                            <input type="checkbox" id="iig_lp_slow" ${settings.lpSlowUpdates !== false ? 'checked' : ''} ${settings.lowPowerMode ? '' : 'disabled'}>
                            <span>Slower background updates</span>
                        </label>
                        <p class="hint">Sub-options apply only while Low-power mode is on. The system "Reduce Motion" accessibility setting also disables animations automatically.</p>
                    </details>

                    <details class="iig-section iig-accordion">
                        <summary><h4><i class="fa-solid fa-bug"></i> Debug</h4></summary>
                        <div id="iig_export_logs" class="menu_button iig-export-logs-btn">
                            <i class="fa-solid fa-download"></i> Export Logs
                        </div>
                        <p class="hint">Download extension logs for troubleshooting.</p>
                    </details>
                    
                    <!-- Maintenance: force-flush settings + clear server ref folder. -->
                    <div class="iig-maintenance-row">
                        <div id="iig_manual_save" class="menu_button iig-maint-btn" title="Force-save extension settings now (bypasses debounce). Mobile browsers sometimes kill pending writes when the tab is backgrounded; this button guarantees a durable write.">
                            <i class="fa-solid fa-floppy-disk"></i> Save settings
                        </div>
                        <div id="iig_clear_refs_folder" class="menu_button iig-maint-btn iig-maint-danger" title="Delete every file in the iig_refs folder on the SillyTavern server. Useful if you want to start fresh; all currently-used ref slots will be uploaded again on next use.">
                            <i class="fa-solid fa-broom"></i> Clear refs folder
                        </div>
                    </div>
                    <p id="iig_save_status" class="hint" style="text-align:center;font-size:0.85em;"></p>

                    <!-- Shown only if ST-ImageManager is installed (feature-detected at render). -->
                    <div id="iig_open_image_manager" class="menu_button iig-open-im-btn iig-hidden" title="Open the Image Manager extension to browse, sort, and clean up your generated images.">
                        <i class="fa-solid fa-images"></i> Open Image Manager
                    </div>

                    <p class="hint" style="text-align:center;opacity:0.5;margin-top:4px;">
                        v${IIG_VERSION} by <a href="https://github.com/aceeenvw/notsosillynotsoimages" target="_blank" style="color:inherit;text-decoration:underline;">aceeenvw</a>
                    </p>
                    <p id="iig_session_stats" class="hint" style="text-align:center;opacity:0.35;margin-top:2px;font-size:0.8em;"></p>
                </div>
            </div>
        </div>
    `;
    
    container.insertAdjacentHTML('beforeend', html);
    
    bindSettingsEvents();
    renderRefSlots();
    applyLowPowerMode();
	renderStyleSettings();
}

/** Wire name/upload/delete handlers for all 6 ref slots (char, user, 4 NPCs). */
// ═══════════════════════════════════════════════════════════════════════
// Crop-before-upload (ported from SLAY, renamed to this file's iig-
// convention — slayCropImage → iigCropImage, .slay-crop-* → .iig-crop-*).
// Returns a data URL (cropped or whole), or null if the user backed out.
// ═══════════════════════════════════════════════════════════════════════
function iigCropImage(dataUrl, opts = {}) {
    const aspectDefault = typeof opts.aspect === 'number' ? opts.aspect : 0; // w/h, 0 = free
    const title = opts.title || 'Обрезать перед загрузкой';
    const subtitle = opts.subtitle || '';

    return new Promise((resolve) => {
        const ov = document.createElement('div');
        ov.className = 'iig-crop-ov';
        ov.innerHTML = `
            <div class="iig-crop-box" role="dialog" aria-label="${sanitizeForHtml(title)}">
                <div class="iig-crop-head">
                    <div>
                        <div class="iig-crop-t">${sanitizeForHtml(title)}</div>
                        ${subtitle ? `<div class="iig-crop-s">${sanitizeForHtml(subtitle)}</div>` : ''}
                    </div>
                    <button class="iig-crop-x" type="button" aria-label="Отмена"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="iig-crop-asp">
                    <button class="iig-asp" data-a="0.75">3:4</button>
                    <button class="iig-asp" data-a="1">1:1</button>
                    <button class="iig-asp" data-a="0.667">2:3</button>
                    <button class="iig-asp" data-a="1.333">4:3</button>
                    <button class="iig-asp on" data-a="0">Свободно</button>
                </div>
                <div class="iig-crop-stage">
                    <img class="iig-crop-img" alt="">
                    <div class="iig-crop-rect">
                        <span class="iig-crop-h nw" data-h="nw"></span><span class="iig-crop-h ne" data-h="ne"></span>
                        <span class="iig-crop-h sw" data-h="sw"></span><span class="iig-crop-h se" data-h="se"></span>
                    </div>
                </div>
                <div class="iig-crop-info"><span class="iig-crop-size">—</span><span class="iig-crop-cut"></span></div>
                <div class="iig-crop-btns">
                    <button class="iig-crop-b primary" data-act="crop">Обрезать</button>
                    <button class="iig-crop-b" data-act="whole">Взять целиком</button>
                    <button class="iig-crop-b ghost" data-act="reset" title="Сбросить рамку"><i class="fa-solid fa-rotate-left"></i></button>
                </div>
            </div>`;
        document.body.appendChild(ov);

        const stage  = ov.querySelector('.iig-crop-stage');
        const img    = ov.querySelector('.iig-crop-img');
        const rect   = ov.querySelector('.iig-crop-rect');
        const sizeEl = ov.querySelector('.iig-crop-size');
        const cutEl  = ov.querySelector('.iig-crop-cut');

        let aspect = aspectDefault;
        let b = { x: 0, y: 0, w: 0, h: 0 };   // stage pixels, for display
        let nb = { x: 0, y: 0, w: 1, h: 1 };  // fractions of the picture — authoritative
        const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

        const markAspect = () => {
            for (const el of ov.querySelectorAll('.iig-asp')) {
                el.classList.toggle('on', parseFloat(el.dataset.a) === aspect);
            }
        };

        // Where the picture actually sits inside the stage (a flex box that
        // centres the image — a portrait in a wide stage leaves bars either side).
        function imgBox() {
            const sr = stage.getBoundingClientRect();
            const ir = img.getBoundingClientRect();
            return { x: ir.left - sr.left, y: ir.top - sr.top, w: ir.width, h: ir.height };
        }

        function fit() {
            const box0 = imgBox();
            if (!box0.w || !box0.h) return;
            let w, h;
            if (!aspect) { w = box0.w; h = box0.h; }
            else if (box0.w / box0.h > aspect) { h = box0.h; w = h * aspect; }
            else { w = box0.w; h = w / aspect; }
            b = { x: box0.x + (box0.w - w) / 2, y: box0.y + (box0.h - h) / 2, w, h };
            draw();
        }

        function draw() {
            const box0 = imgBox();
            if (!box0.w || !box0.h) return;
            b.w = clamp(b.w, 32, box0.w); b.h = clamp(b.h, 32, box0.h);
            b.x = clamp(b.x, box0.x, box0.x + box0.w - b.w);
            b.y = clamp(b.y, box0.y, box0.y + box0.h - b.h);
            rect.style.left = b.x + 'px'; rect.style.top = b.y + 'px';
            rect.style.width = b.w + 'px'; rect.style.height = b.h + 'px';
            nb = {
                x: (b.x - box0.x) / box0.w,
                y: (b.y - box0.y) / box0.h,
                w: b.w / box0.w,
                h: b.h / box0.h,
            };
            if (img.naturalWidth) {
                const sw = Math.round(nb.w * img.naturalWidth);
                const sh = Math.round(nb.h * img.naturalHeight);
                sizeEl.textContent = `${sw} × ${sh}`;
                const cut = Math.max(0, Math.round((1 - nb.w * nb.h) * 100));
                cutEl.textContent = cut ? `отброшено ${cut}%` : 'вся картинка';
            }
        }

        let drag = null;
        stage.addEventListener('pointerdown', (e) => {
            const h = e.target.closest('.iig-crop-h');
            const inside = e.target === rect || rect.contains(e.target);
            if (!h && !inside) return;
            try { stage.setPointerCapture(e.pointerId); } catch (_) {}
            drag = { h: h ? h.dataset.h : null, sx: e.clientX, sy: e.clientY, b: { ...b } };
            e.preventDefault();
        });
        stage.addEventListener('pointermove', (e) => {
            if (!drag) return;
            const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy, o = drag.b;
            if (!drag.h) { b.x = o.x + dx; b.y = o.y + dy; draw(); return; }
            let nx = o.x, ny = o.y, nw = o.w, nh = o.h;
            if (drag.h === 'se') { nw = o.w + dx; nh = aspect ? nw / aspect : o.h + dy; }
            if (drag.h === 'sw') { nw = o.w - dx; nh = aspect ? nw / aspect : o.h + dy; nx = o.x + o.w - nw; }
            if (drag.h === 'ne') { nw = o.w + dx; nh = aspect ? nw / aspect : o.h - dy; ny = o.y + o.h - nh; }
            if (drag.h === 'nw') { nw = o.w - dx; nh = aspect ? nw / aspect : o.h - dy; nx = o.x + o.w - nw; ny = o.y + o.h - nh; }
            if (nw < 32 || nh < 32) return;
            b = { x: nx, y: ny, w: nw, h: nh };
            draw();
        });
        const endDrag = (e) => { if (drag) { drag = null; try { stage.releasePointerCapture(e.pointerId); } catch (_) {} } };
        stage.addEventListener('pointerup', endDrag);
        stage.addEventListener('pointercancel', endDrag);

        function reshape() {
            if (!aspect) { draw(); return; }
            const box0 = imgBox();
            if (!box0.w || !box0.h) return;
            const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
            let w = Math.min(b.w, box0.w);
            let h = w / aspect;
            if (h > box0.h) { h = box0.h; w = h * aspect; }
            b = { x: cx - w / 2, y: cy - h / 2, w, h };
            draw();
        }

        ov.querySelector('.iig-crop-asp').addEventListener('click', (e) => {
            const btn = e.target.closest('.iig-asp'); if (!btn) return;
            aspect = parseFloat(btn.dataset.a);
            markAspect();
            reshape();
        });

        let settled = false;
        const cleanups = [];
        const finish = (val) => {
            for (const fn of cleanups) { try { fn(); } catch (_) {} }
            if (settled) return;
            settled = true;
            ov.remove();
            document.removeEventListener('keydown', onKey, true);
            resolve(val);
        };
        const onKey = (e) => {
            if (e.key !== 'Escape' && e.key !== 'Enter') return;
            e.stopPropagation();
            e.preventDefault();
            if (e.key === 'Escape') finish(null);
            else doCrop();
        };
        document.addEventListener('keydown', onKey, true);

        function doCrop() {
            if (!img.naturalWidth) return finish(dataUrl);
            const NW = img.naturalWidth, NH = img.naturalHeight;
            const cl = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
            let sx = Math.round(cl(nb.x, 0, 1) * NW);
            let sy = Math.round(cl(nb.y, 0, 1) * NH);
            let sw = Math.round(cl(nb.w, 0, 1) * NW);
            let sh = Math.round(cl(nb.h, 0, 1) * NH);
            sw = Math.max(1, Math.min(sw, NW - sx));
            sh = Math.max(1, Math.min(sh, NH - sy));
            // Whole picture selected — hand back the original bytes untouched.
            if (sx <= 1 && sy <= 1 && sw >= NW - 2 && sh >= NH - 2) return finish(dataUrl);
            try {
                const c = document.createElement('canvas');
                c.width = sw; c.height = sh;
                c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
                const mime = /^data:image\/png/i.test(dataUrl) ? 'image/png' : 'image/jpeg';
                finish(c.toDataURL(mime, mime === 'image/jpeg' ? 0.92 : undefined));
            } catch (err) {
                iigLog('WARN', `crop failed, using original: ${err?.message}`);
                finish(dataUrl);
            }
        }

        ov.querySelector('.iig-crop-btns').addEventListener('click', (e) => {
            const btn = e.target.closest('.iig-crop-b'); if (!btn) return;
            if (btn.dataset.act === 'crop') doCrop();
            if (btn.dataset.act === 'whole') finish(dataUrl);
            if (btn.dataset.act === 'reset') fit();
        });
        ov.querySelector('.iig-crop-x').addEventListener('click', () => finish(null));

        // Overlay is a child of <body>, so its clicks also reach document-level
        // "clicked outside" handlers (e.g. the assign popup's dismiss listener) —
        // swallow the whole family here so pressing a crop button doesn't close
        // something else underneath. Ignore backdrop taps for a moment after
        // opening (iOS fires a pointerdown here when the native photo picker closes).
        const openedAt = Date.now();
        for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend']) {
            ov.addEventListener(type, (e) => {
                if (type === 'pointerdown' && e.target === ov && Date.now() - openedAt > 400) finish(null);
                e.stopPropagation();
            });
        }

        img.addEventListener('load', () => { markAspect(); fit(); });
        img.addEventListener('error', () => {
            iigLog('WARN', 'crop: image failed to decode, continuing without cropping');
            toastr.info('Не удалось открыть картинку для обрезки — загружаю как есть', 'Image Generation', { timeOut: 3000 });
            finish(dataUrl);
        });
        img.src = dataUrl;
        addEventListener('resize', fit, { passive: true });
        cleanups.push(() => removeEventListener('resize', fit));
    });
}

function iigCropEnabled() {
    try { return getSettings().skipCrop !== true; } catch (_) { return true; }
}

// Convenience wrapper for upload paths: takes/returns raw base64 (not a data
// URL), which is what every caller already works with. null = user cancelled,
// caller must abort the upload.
async function iigMaybeCrop(rawBase64, opts = {}) {
    if (!iigCropEnabled()) return rawBase64;
    const mime = detectImageMimeFromBase64(rawBase64);
    const out = await iigCropImage(`data:${mime};base64,${rawBase64}`, opts);
    if (out === null) return null;
    return String(out).split(',')[1] || rawBase64;
}

// ═══════════════════════════════════════════════════════════════════════
// Recent refs (ported from SLAY v4.2): rolling window of the last N
// ref-image paths assigned to any slot, surfaced as a ribbon under the
// refs grid — tap a thumb → assign popup, or drag it onto a slot.
// Stored globally (not per-chat): it's a convenience "what did I just use"
// list, not part of the actual ref data per-chat mode forks.
// ═══════════════════════════════════════════════════════════════════════
const RECENT_REFS_MAX = 10;

function pushRecentRef(path) {
    if (!path) return;
    const settings = getSettings();
    if (!Array.isArray(settings.recentRefs)) settings.recentRefs = [];
    settings.recentRefs = settings.recentRefs.filter(r => (typeof r === 'string' ? r : r.path) !== path);
    settings.recentRefs.unshift({ path, lastUsed: Date.now() });
    if (settings.recentRefs.length > RECENT_REFS_MAX) settings.recentRefs.length = RECENT_REFS_MAX;
    saveSettings();
    try { renderRecentRefsRibbon(); } catch (_) { /* not mounted yet */ }
}

function getRecentRefs() {
    const settings = getSettings();
    const list = Array.isArray(settings.recentRefs) ? settings.recentRefs : [];
    return list.map(r => typeof r === 'string' ? { path: r, lastUsed: 0 } : r).filter(r => r.path);
}

function removeRecentRef(path) {
    const settings = getSettings();
    if (!Array.isArray(settings.recentRefs)) return;
    settings.recentRefs = settings.recentRefs.filter(r => (typeof r === 'string' ? r : r.path) !== path);
    saveSettings();
    try { renderRecentRefsRibbon(); } catch (_) {}
}

// Write a saved path into a slot's live state + thumbnail. Shared by the
// assign popup and the ribbon's drag-and-drop handler; respects the same
// global/per-chat scoping as the rest of the ref system.
function applyPathToSlot(slotEl, refType, npcIndex, savedPath) {
    const s = getActiveRefsForWrite();
    if (refType === 'char') { s.charRef.imageBase64 = ''; s.charRef.imagePath = savedPath; }
    else if (refType === 'user') { s.userRef.imageBase64 = ''; s.userRef.imagePath = savedPath; }
    else if (refType === 'npc') {
        if (!s.npcReferences[npcIndex]) s.npcReferences[npcIndex] = { name: '', imageBase64: '', imagePath: '' };
        s.npcReferences[npcIndex].imageBase64 = '';
        s.npcReferences[npcIndex].imagePath = savedPath;
    }
    saveActiveRefs();
    if (slotEl) {
        const thumb = slotEl.querySelector('.iig-ref-thumb'); if (thumb) thumb.src = savedPath;
        const tw = slotEl.querySelector('.iig-ref-thumb-wrap'); if (tw) tw.classList.add('has-image');
    }
}

function findAllSlotsByKey(key) {
    if (!key) return [];
    if (key === 'char' || key === 'user') {
        return [...document.querySelectorAll(`.iig-ref-slot[data-ref-type="${key}"]`)];
    }
    const m = key.match(/^npc-(\d+)$/);
    if (!m) return [];
    return [...document.querySelectorAll(`.iig-ref-slot[data-ref-type="npc"][data-npc-index="${m[1]}"]`)];
}

function closeAllRefPopups() {
    document.getElementById('iig_assign_popup')?.classList.remove('show');
}

// Shift a fixed-position popup back into the viewport if it'd render off-screen.
function clampPopupToViewport(popup) {
    if (!popup || !popup.classList.contains('show')) return;
    const rect = popup.getBoundingClientRect();
    const margin = 8;
    let left = rect.left, top = rect.top;
    if (rect.right > innerWidth - margin) left -= (rect.right - innerWidth + margin);
    if (rect.left < margin) left = margin;
    if (rect.bottom > innerHeight - margin) top -= (rect.bottom - innerHeight + margin);
    if (rect.top < margin) top = margin;
    popup.style.left = Math.max(margin, left) + 'px';
    popup.style.top = Math.max(margin, top) + 'px';
}

let _iigPopupAutoDismissArmed = false;
function armPopupContainment(popup) {
    // Clicks inside the popup must not bubble to the document-level
    // "clicked outside" handler below (that handler is what closes it).
    if (popup.dataset.iigContained === '1') return;
    popup.dataset.iigContained = '1';
    popup.addEventListener('click', (e) => e.stopPropagation());
    popup.addEventListener('pointerdown', (e) => e.stopPropagation());
    if (!_iigPopupAutoDismissArmed) {
        _iigPopupAutoDismissArmed = true;
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#iig_assign_popup, .iig-recent-thumb')) closeAllRefPopups();
        });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllRefPopups(); });
        // Popups are position:fixed and anchored to a thumb's on-screen rect —
        // scroll/resize detaches them from what they point at, so dismiss
        // instead of trying to re-anchor.
        window.addEventListener('scroll', () => closeAllRefPopups(), { capture: true, passive: true });
        window.addEventListener('resize', () => closeAllRefPopups(), { passive: true });
    }
}

// "Куда применить?" — offers char/user/NPC-N slot buttons for a recent ref path.
function showAssignPopup(anchor, path) {
    const popup = document.getElementById('iig_assign_popup');
    if (!popup) return;
    if (popup.classList.contains('show') && popup.dataset.path === path) {
        popup.classList.remove('show');
        return;
    }
    if (popup.parentElement !== document.body) document.body.appendChild(popup);
    armPopupContainment(popup);

    const slotButtons = [];
    slotButtons.push(`<button class="iig-assign-btn" data-key="char">{{char}}</button>`);
    slotButtons.push(`<button class="iig-assign-btn" data-key="user">{{user}}</button>`);
    const seenNpc = new Set();
    document.querySelectorAll('.iig-ref-slot[data-ref-type="npc"]').forEach((slot, i) => {
        const idx = String(slot.dataset.npcIndex ?? i);
        if (seenNpc.has(idx)) return;
        seenNpc.add(idx);
        slotButtons.push(`<button class="iig-assign-btn" data-key="npc-${idx}">NPC ${Number(idx) + 1}</button>`);
    });
    popup.innerHTML = `
        <button class="iig-popup-close" type="button" title="Закрыть" aria-label="Закрыть"><i class="fa-solid fa-xmark"></i></button>
        <div class="iig-assign-title">Куда применить?</div>
        <div class="iig-assign-preview"><img src="${String(path).replace(/"/g, '&quot;')}" alt=""></div>
        <div class="iig-assign-buttons">${slotButtons.join('')}</div>
    `;
    popup.querySelector('.iig-popup-close')?.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        closeAllRefPopups();
    });
    const rect = anchor.getBoundingClientRect();
    popup.style.left = rect.left + 'px';
    popup.style.top = (rect.bottom + 6) + 'px';
    popup.classList.add('show');
    popup.dataset.path = path;
    requestAnimationFrame(() => clampPopupToViewport(popup));

    for (const btn of popup.querySelectorAll('.iig-assign-btn')) {
        btn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            const key = btn.dataset.key;
            const slots = findAllSlotsByKey(key);
            if (!slots.length) { closeAllRefPopups(); return; }
            const refType = slots[0].dataset.refType;
            const npcIndex = parseInt(slots[0].dataset.npcIndex, 10);
            for (const sl of slots) applyPathToSlot(sl, refType, npcIndex, path);
            const slot = slots[slots.length - 1];
            pushRecentRef(path);
            slot.classList.add('iig-slot-flash');
            setTimeout(() => slot.classList.remove('iig-slot-flash'), 600);
            closeAllRefPopups();
            toastr.success('Реф применён', 'Image Generation', { timeOut: 1500 });
        });
    }
}

function renderRecentRefsRibbon() {
    const host = document.getElementById('iig_recent_refs_ribbon');
    if (!host) return;
    const items = getRecentRefs();
    if (items.length === 0) {
        host.innerHTML = '';
        host.classList.remove('has-items');
        return;
    }
    host.classList.add('has-items');
    let html = `<div class="iig-recent-refs-head">
        <span class="iig-recent-refs-title"><i class="fa-solid fa-clock-rotate-left"></i> Недавние</span>
        <span class="iig-recent-refs-hint">Tap → куда применить • drag на слот</span>
    </div>
    <div class="iig-recent-refs-track">`;
    for (const item of items) {
        const safeSrc = String(item.path).replace(/"/g, '&quot;');
        html += `<div class="iig-recent-thumb" draggable="true" data-path="${safeSrc}" title="${safeSrc}">
            <img src="${safeSrc}" alt="" loading="lazy">
            <button class="iig-recent-remove" title="Убрать из недавних" data-path="${safeSrc}">×</button>
        </div>`;
    }
    html += '</div>';
    host.innerHTML = html;
    bindRecentRefsEvents(host);
}

function bindRecentRefsEvents(host) {
    for (const thumb of host.querySelectorAll('.iig-recent-thumb')) {
        const path = thumb.dataset.path;
        thumb.addEventListener('click', (e) => {
            if (e.target.closest('.iig-recent-remove')) return;
            e.stopPropagation();
            showAssignPopup(e.currentTarget, path);
        });
        thumb.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', path);
            e.dataTransfer.effectAllowed = 'copy';
            thumb.classList.add('dragging');
            window._iigRecentDragPath = path;
        });
        thumb.addEventListener('dragend', () => {
            thumb.classList.remove('dragging');
            window._iigRecentDragPath = null;
        });
    }
    for (const rm of host.querySelectorAll('.iig-recent-remove')) {
        rm.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            removeRecentRef(rm.dataset.path);
        });
    }
    // Drop targets = all ref slots (char/user/NPC alike).
    for (const slot of document.querySelectorAll('.iig-ref-slot')) {
        if (slot.dataset.iigDropBound === '1') continue;
        slot.dataset.iigDropBound = '1';
        slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('iig-slot-drop-hover'); });
        slot.addEventListener('dragleave', () => slot.classList.remove('iig-slot-drop-hover'));
        slot.addEventListener('drop', (e) => {
            e.preventDefault();
            slot.classList.remove('iig-slot-drop-hover');
            const path = e.dataTransfer.getData('text/plain') || window._iigRecentDragPath;
            if (!path) return;
            const refType = slot.dataset.refType;
            const npcIndex = parseInt(slot.dataset.npcIndex, 10);
            applyPathToSlot(slot, refType, npcIndex, path);
            pushRecentRef(path);
            toastr.success('Реф применён', 'Image Generation', { timeOut: 1500 });
        });
    }
}

function bindRefSlotEvents() {
    const allSlots = document.querySelectorAll('.iig-ref-slot');

    for (const slot of allSlots) {
        const refType = slot.dataset.refType;
        const npcIndex = parseInt(slot.dataset.npcIndex, 10);

        const nameInput = slot.querySelector('.iig-ref-name');
        nameInput?.addEventListener('input', (e) => {
            const s = getActiveRefsForWrite();
            if (refType === 'char') {
                s.charRef.name = e.target.value;
            } else if (refType === 'user') {
                s.userRef.name = e.target.value;
            } else if (refType === 'npc') {
                if (!s.npcReferences[npcIndex]) s.npcReferences[npcIndex] = { name: '', imageBase64: '' };
                s.npcReferences[npcIndex].name = e.target.value;
            }
            saveActiveRefs();
        });

        // Rename-on-blur: download → re-upload under slug → delete old.
        // Skipped if filename already matches iig_ref_<refType>_<slug>(_N)?.jpeg.
        // Failures are silent (log-only); the old file keeps working.
        let _renameInProgress = false;
        nameInput?.addEventListener('blur', async () => {
            if (_renameInProgress) return;
            const perChat = isPerChatRefs();
            const s = getActiveRefsForWrite();
            const currentName = (nameInput.value || '').trim();
            if (!currentName) return;

            let slotRef;
            if (refType === 'char') slotRef = s.charRef;
            else if (refType === 'user') slotRef = s.userRef;
            else if (refType === 'npc') slotRef = s.npcReferences[npcIndex];

            if (!slotRef?.imagePath) return;

            const currentPath = slotRef.imagePath;
            const currentFilename = currentPath.split('/').pop() || '';
            const nameSlug = sanitizeRefNameForFilename(currentName);
            if (!nameSlug) return;

            // Skip if filename is already the exact form or a numeric-collision
            // variant (_2, _3, ...). A looser startsWith check would incorrectly
            // match distinct names that happen to share a slug prefix.
            const expectedPrefix = `iig_ref_${refType}_${nameSlug}`;
            if (currentFilename === `${expectedPrefix}.jpeg`) return;
            const escapedPrefix = expectedPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const collisionForm = new RegExp(`^${escapedPrefix}_\\d+\\.jpeg$`);
            if (collisionForm.test(currentFilename)) return;

            _renameInProgress = true;
            iigLog('INFO', `Renaming ref file to match name "${currentName}": ${currentFilename} → iig_ref_${refType}_${nameSlug}.jpeg (or _N)`);

            try {
                const newFilename = await pickUniqueRefFilename(refType, nameSlug, currentPath);

                const currentB64 = await loadRefImageAsBase64(currentPath);
                if (!currentB64) {
                    iigLog('WARN', 'Rename aborted: could not load current file');
                    return;
                }

                const label = refType === 'npc' ? `npc${npcIndex}` : refType;
                const newPath = await saveRefImageToFile(currentB64, label, newFilename);

                slotRef.imagePath = newPath;
                invalidateRefB64Cache(currentPath);
                invalidateRefB64Cache(newPath);
                saveActiveRefs();

                const thumb = slot.querySelector('.iig-ref-thumb');
                if (thumb) thumb.src = newPath;

                // Global: delete the old file (best-effort; orphan if it fails).
                // Per-chat: delete the old file too, but ONLY if the global set
                // doesn't still reference it (that would make it shared/the seed
                // source). Keeps the folder clean without breaking global.
                if (!perChat) {
                    await deleteRefFileOnServer(currentPath);
                } else {
                    await deletePerChatRefFileIfUnshared(currentPath);
                }

                iigLog('INFO', `Rename complete: ${newPath}`);
            } catch (e) {
                iigLog('ERROR', `Rename failed: ${e.message}`);
            } finally {
                _renameInProgress = false;
            }
        });

        // Bind ALL file inputs in the slot (button + thumbnail overlay)
        const fileInputs = slot.querySelectorAll('.iig-ref-file-input');
        const fileHandler = async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            try {
                const rawBase64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const b64 = reader.result.split(',')[1];
                        resolve(b64);
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });

                // Crop before compressing/hashing anything downstream — the
                // cropped bytes are what actually gets saved and reused.
                const croppedBase64 = await iigMaybeCrop(rawBase64, {
                    aspect: 0,
                    title: 'Обрезать реф',
                    subtitle: refType === 'npc' ? `NPC ${npcIndex + 1}` : (refType === 'char' ? '{{char}}' : '{{user}}'),
                });
                if (croppedBase64 === null) { e.target.value = ''; return; } // user cancelled

                const compressed = await compressBase64Image(croppedBase64, 768, 0.8);

                // Save ref as file on server, store only the lightweight path
                const label = refType === 'npc' ? `npc${npcIndex}` : refType;

                // if the user already typed a name in the ref slot
                // before hitting upload, bake it into the filename directly
                // so we skip a rename round-trip. Otherwise fall through to
                // the default timestamp-based naming — if a name gets typed
                // later, the blur handler renames it then.
                const currentTypedName = slot.querySelector('.iig-ref-name')?.value?.trim() || '';
                const nameSlug = sanitizeRefNameForFilename(currentTypedName);
                const customFilename = nameSlug
                    ? await pickUniqueRefFilename(refType, nameSlug)
                    : null;
                const savedPath = await saveRefImageToFile(compressed, label, customFilename);

                const s = getActiveRefsForWrite();
                let prevPath = '';
                if (refType === 'char') {
                    prevPath = s.charRef.imagePath || '';
                    s.charRef.imageBase64 = '';
                    s.charRef.imagePath = savedPath;
                } else if (refType === 'user') {
                    prevPath = s.userRef.imagePath || '';
                    s.userRef.imageBase64 = '';
                    s.userRef.imagePath = savedPath;
                } else if (refType === 'npc') {
                    if (!s.npcReferences[npcIndex]) s.npcReferences[npcIndex] = { name: '', imageBase64: '', imagePath: '' };
                    prevPath = s.npcReferences[npcIndex].imagePath || '';
                    s.npcReferences[npcIndex].imageBase64 = '';
                    s.npcReferences[npcIndex].imagePath = savedPath;
                }
                if (prevPath && prevPath !== savedPath) invalidateRefB64Cache(prevPath);
                invalidateRefB64Cache(savedPath);
                saveActiveRefs();
                const thumb = slot.querySelector('.iig-ref-thumb');
                if (thumb) thumb.src = savedPath;

                iigLog('INFO', `Ref slot ${label}: saved to ${savedPath}`);
                toastr.success('Photo saved to server', 'Image Generation', { timeOut: 2000 });
                pushRecentRef(savedPath);

                // Fire-and-forget delete of the previous file to prevent iig_refs
                // bloat. Global: always delete. Per-chat: delete only if global
                // doesn't still reference it (avoids breaking the shared source).
                if (prevPath && prevPath !== savedPath) {
                    if (isPerChatRefs()) deletePerChatRefFileIfUnshared(prevPath);
                    else deleteRefFileOnServer(prevPath);
                }
            } catch (err) {
                const label = refType === 'npc' ? `NPC ${npcIndex}` : refType;
                iigLog('ERROR', `Ref slot ${label}: upload failed`, err.message);
                toastr.error('Photo upload failed', 'Image Generation');
            }

            e.target.value = '';
            const thumbWrap = slot.querySelector('.iig-ref-thumb-wrap');
            if (thumbWrap) thumbWrap.classList.add('has-image');
        };
        for (const fi of fileInputs) fi.addEventListener('change', fileHandler);

        const deleteBtn = slot.querySelector('.iig-ref-delete-btn');
        deleteBtn?.addEventListener('click', () => {
            const perChat = isPerChatRefs();
            const s = getActiveRefsForWrite();
            let prevPath = '';
            if (refType === 'char') {
                prevPath = s.charRef?.imagePath || '';
                s.charRef = { name: '', imageBase64: '', imagePath: '' };
            } else if (refType === 'user') {
                prevPath = s.userRef?.imagePath || '';
                s.userRef = { name: '', imageBase64: '', imagePath: '' };
            } else if (refType === 'npc') {
                prevPath = s.npcReferences[npcIndex]?.imagePath || '';
                s.npcReferences[npcIndex] = { name: '', imageBase64: '', imagePath: '' };
            }
            if (prevPath) invalidateRefB64Cache(prevPath);
            saveActiveRefs();

            const thumb = slot.querySelector('.iig-ref-thumb');
            if (thumb) thumb.src = '';
            const thumbWrap = slot.querySelector('.iig-ref-thumb-wrap');
            if (thumbWrap) thumbWrap.classList.remove('has-image');
            const nameEl = slot.querySelector('.iig-ref-name');
            if (nameEl) nameEl.value = '';

            const label = refType === 'npc' ? `NPC ${npcIndex}` : refType;
            iigLog('INFO', `Ref slot ${label}: cleared`);
            toastr.info('Slot cleared', 'Image Generation', { timeOut: 2000 });

            // Cleanup: global deletes always; per-chat deletes only if unshared.
            if (prevPath) {
                if (perChat) deletePerChatRefFileIfUnshared(prevPath);
                else deleteRefFileOnServer(prevPath);
            }
        });
    }
}

/**
 * Detect whether the ST-ImageManager extension is installed, so we can show
 * an optional launcher. Two independent signals; either is sufficient.
 */
function isImageManagerInstalled() {
    try {
        if (document.getElementById('im_wand_button')) return true;
        const ctx = getContext();
        const cmds = ctx?.SlashCommandParser?.commands;
        if (cmds && (cmds['image-manager'] || cmds['im'])) return true;
    } catch (_) {}
    return false;
}

/** Run a slash command defensively across ST API variants (no-op if unavailable). */
function runSlashCommand(text) {
    try {
        const ctx = getContext();
        if (typeof ctx.executeSlashCommandsWithOptions === 'function') {
            ctx.executeSlashCommandsWithOptions(text);
            return true;
        }
        if (typeof ctx.executeSlashCommands === 'function') {
            ctx.executeSlashCommands(text);
            return true;
        }
    } catch (e) {
        iigLog('WARN', `runSlashCommand failed: ${e.message}`);
    }
    return false;
}

/** Wire up all settings-panel event handlers and visibility toggles. */
function bindSettingsEvents() {
    const settings = getSettings();

    const updateVisibility = () => {
        const apiType = settings.apiType;
        const isNaistera = apiType === 'naistera';
        const isGemini = apiType === 'gemini';
        const isOpenAI = apiType === 'openai';

        document.getElementById('iig_naistera_hint')?.classList.toggle('iig-hidden', !isNaistera);

        // Model row hidden for Naistera — it uses its own dropdown below.
        document.getElementById('iig_model_row')?.classList.toggle('iig-hidden', isNaistera);

        document.getElementById('iig_size_row')?.classList.toggle('iig-hidden', !isOpenAI);
        document.getElementById('iig_quality_row')?.classList.toggle('iig-hidden', !isOpenAI);
        document.getElementById('iig_quality_hint')?.classList.toggle('iig-hidden', !isOpenAI);

        document.getElementById('iig_naistera_model_row')?.classList.toggle('iig-hidden', !isNaistera);
        // Preset is Grok-only; other Naistera upstreams ignore the field.
        const presetAllowed = isNaistera && naisteraModelSupportsPreset(settings.naisteraModel);
        document.getElementById('iig_naistera_preset_row')?.classList.toggle('iig-hidden', !presetAllowed);
        document.getElementById('iig_naistera_preset_hint')?.classList.toggle('iig-hidden', !presetAllowed);
        document.getElementById('iig_naistera_refs_row')?.classList.toggle('iig-hidden', !isNaistera);
        document.getElementById('iig_naistera_refs_hint')?.classList.toggle('iig-hidden', !isNaistera);

        document.getElementById('iig_gemini_params')?.classList.toggle('iig-hidden', !isGemini);
        // Video is supported on OpenAI/Gemini-style providers only.
        document.getElementById('iig_video_params')?.classList.toggle('iig-hidden', !(isOpenAI || isGemini));

        const endpointInput = document.getElementById('iig_endpoint');
        if (endpointInput) {
            endpointInput.placeholder = ENDPOINT_PLACEHOLDERS[apiType] || 'https://your-provider.example';
        }

        const infoEl = document.getElementById('iig_api_type_info');
        if (infoEl) infoEl.setAttribute('title', API_TYPE_TOOLTIPS[apiType] || '');

        document.getElementById('iig_refs_section')?.classList.remove('iig-hidden');
    };
    
    document.getElementById('iig_enabled')?.addEventListener('change', (e) => {
        settings.enabled = e.target.checked;
        saveSettings();
        updateHeaderStatusDot();
    });

    document.getElementById('iig_prompt_driven')?.addEventListener('change', (e) => {
        settings.promptDriven = e.target.checked;
        saveSettings();
    });

    // Low-power toggles. Master greys out the subs when off.
    document.getElementById('iig_low_power')?.addEventListener('change', (e) => {
        settings.lowPowerMode = e.target.checked;
        const animEl = document.getElementById('iig_lp_anim');
        const slowEl = document.getElementById('iig_lp_slow');
        if (animEl) animEl.disabled = !e.target.checked;
        if (slowEl) slowEl.disabled = !e.target.checked;
        saveSettings();
        applyLowPowerMode();
    });
    document.getElementById('iig_lp_anim')?.addEventListener('change', (e) => {
        settings.lpDisableAnimations = e.target.checked;
        saveSettings();
        applyLowPowerMode();
    });
    document.getElementById('iig_lp_slow')?.addEventListener('change', (e) => {
        settings.lpSlowUpdates = e.target.checked;
        saveSettings();
    });
    
    document.getElementById('iig_api_type')?.addEventListener('change', (e) => {
        const nextApiType = e.target.value;
        const endpointInput = document.getElementById('iig_endpoint');

        // Auto-swap endpoint when switching to Naistera from an incompatible URL.
        if (shouldReplaceEndpointForApiType(nextApiType, settings.endpoint)) {
            settings.endpoint = normalizeConfiguredEndpoint(nextApiType, '');
            if (endpointInput) endpointInput.value = settings.endpoint;
        } else if (nextApiType === 'naistera') {
            settings.endpoint = normalizeConfiguredEndpoint(nextApiType, settings.endpoint);
            if (endpointInput) endpointInput.value = settings.endpoint;
        }

        settings.apiType = nextApiType;
        saveSettings();
        updateVisibility();
    });
    
    document.getElementById('iig_endpoint')?.addEventListener('input', (e) => {
        settings.endpoint = normalizeConfiguredEndpoint(settings.apiType, e.target.value);
        // Debounced reflect of the normalized value (avoids cursor jumping).
        clearTimeout(e.target._normalizeTimer);
        e.target._normalizeTimer = setTimeout(() => {
            if (e.target.value !== settings.endpoint) {
                e.target.value = settings.endpoint;
            }
        }, 1500);
        saveSettings();
    });
    
    document.getElementById('iig_api_key')?.addEventListener('input', (e) => {
        settings.apiKey = e.target.value;
        saveSettings();
    });
    
    document.getElementById('iig_key_toggle')?.addEventListener('click', () => {
        const input = document.getElementById('iig_api_key');
        const icon = document.querySelector('#iig_key_toggle i');
        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.replace('fa-eye', 'fa-eye-slash');
        } else {
            input.type = 'password';
            icon.classList.replace('fa-eye-slash', 'fa-eye');
        }
    });
    
    document.getElementById('iig_model')?.addEventListener('change', (e) => {
        settings.model = e.target.value;
        saveSettings();
        updateVisibility();
    });
    
    document.getElementById('iig_refresh_models')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.classList.add('loading');
        
        try {
            const models = await fetchModels();
            const select = document.getElementById('iig_model');
            const currentModel = settings.model;
            
            select.innerHTML = '<option value="">-- Select model --</option>';
            
            for (const model of models) {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                option.selected = model === currentModel;
                select.appendChild(option);
            }
            
            toastr.success(`Found ${models.length} model(s)`, 'Image Generation');
        } catch (error) {
            toastr.error('Failed to load models', 'Image Generation');
        } finally {
            btn.classList.remove('loading');
        }
    });
    
    document.getElementById('iig_size')?.addEventListener('change', (e) => {
        settings.size = e.target.value;
        saveSettings();
    });
    
    document.getElementById('iig_quality')?.addEventListener('change', (e) => {
        settings.quality = e.target.value;
        saveSettings();
    });
    
    document.getElementById('iig_image_size')?.addEventListener('change', (e) => {
        settings.imageSize = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_video_model')?.addEventListener('input', (e) => {
        settings.videoModel = e.target.value.trim();
        saveSettings();
    });
    document.getElementById('iig_video_duration')?.addEventListener('input', (e) => {
        const v = parseInt(e.target.value, 10);
        settings.videoDuration = Number.isFinite(v) ? Math.max(1, Math.min(60, v)) : 4;
        saveSettings();
    });
    document.getElementById('iig_video_resolution')?.addEventListener('change', (e) => {
        settings.videoResolution = e.target.value;
        saveSettings();
    });
    document.getElementById('iig_video_audio')?.addEventListener('change', (e) => {
        settings.videoAudio = !!e.target.checked;
        saveSettings();
    });

    document.getElementById('iig_naistera_model')?.addEventListener('change', (e) => {
        settings.naisteraModel = normalizeNaisteraModel(e.target.value);
        updateVisibility(); // preset row depends on new model (Grok-only).
        saveSettings();
    });

    document.getElementById('iig_naistera_preset')?.addEventListener('change', (e) => {
        settings.naisteraPreset = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_naistera_send_refs')?.addEventListener('change', (e) => {
        settings.naisteraSendRefs = !!e.target.checked;
        saveSettings();
    });

    document.getElementById('iig_gemini_send_refs')?.addEventListener('change', (e) => {
        settings.geminiSendRefs = !!e.target.checked;
        saveSettings();
    });

    document.getElementById('iig_char_ref_always')?.addEventListener('change', (e) => {
        settings.charRefAlways = !!e.target.checked;
        saveSettings();
    });

    document.getElementById('iig_user_ref_always')?.addEventListener('change', (e) => {
        settings.userRefAlways = !!e.target.checked;
        saveSettings();
    });

    document.getElementById('iig_skip_crop')?.addEventListener('change', (e) => {
        settings.skipCrop = !!e.target.checked;
        saveSettings();
    });

    document.getElementById('iig_ref_scope')?.addEventListener('change', (e) => {
        settings.refScope = (e.target.value === 'per-chat') ? 'per-chat' : 'global';
        saveSettings();
        // Seed this chat from global on first switch so slots aren't empty.
        if (settings.refScope === 'per-chat') getChatRefsContainer({ seedIfMissing: true });
        updateRefScopeUI();
        renderRefSlots();
    });

    document.getElementById('iig_refs_reset_to_global')?.addEventListener('click', async () => {
        const ctx = getContext();
        const bucket = ctx?.chatMetadata?.iig_refs;
        if (bucket) {
            // Collect this chat's ref files; delete the ones global doesn't share.
            const chatPaths = [];
            const add = (r) => { if (r && r.imagePath) chatPaths.push(r.imagePath); };
            add(bucket.charRef);
            add(bucket.userRef);
            for (const npc of (bucket.npcReferences || [])) add(npc);

            delete ctx.chatMetadata.iig_refs;
            try { ctx.saveMetadata?.(); } catch (_) {}

            let deleted = 0;
            for (const p of chatPaths) {
                if (!collectGlobalRefPaths().has(p)) {
                    const ok = await deleteRefFileOnServer(p);
                    if (ok) deleted++;
                }
                invalidateRefB64Cache(p);
            }
            iigLog('INFO', `Reset to global: removed ${deleted} chat-owned ref file(s)`);
        }
        clearAllRefB64Cache();
        renderRefSlots();
        updateRefScopeUI();
        toastr.info('This chat now uses the global references', 'Image Generation', { timeOut: 2500 });
    });

    // Advanced handlers
    document.getElementById('iig_path_override')?.addEventListener('input', (e) => {
        settings.pathOverride = e.target.value.trim();
        saveSettings();
    });
    document.getElementById('iig_show_all_models')?.addEventListener('change', (e) => {
        settings.showAllModels = e.target.checked;
        saveSettings();
    });

    // Preset handlers: load replaces live fields + re-renders, save snapshots, delete removes.
    const refreshPresetDropdown = () => {
        const sel = document.getElementById('iig_preset_select');
        if (!sel) return;
        const presets = Array.isArray(settings.presets) ? settings.presets : [];
        const currentValue = settings.activePresetName || '';
        sel.innerHTML = '<option value="">-- Presets --</option>'
            + presets.map(p => {
                const name = sanitizeForHtml(p.name);
                const selected = p.name === currentValue ? ' selected' : '';
                return `<option value="${name}"${selected}>${name}</option>`;
            }).join('');
    };

    document.getElementById('iig_preset_select')?.addEventListener('change', (e) => {
        const name = e.target.value;
        if (!name) {
            settings.activePresetName = '';
            saveSettings();
            return;
        }
        const preset = findPreset(settings, name);
        if (!preset) {
            toastr.error(`Preset "${name}" not found`, 'Image Generation');
            refreshPresetDropdown();
            return;
        }
        applyPresetToSettings(settings, preset);
        settings.activePresetName = preset.name;
        saveSettings();

        // Reflect loaded values into the live UI (best-effort).
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
        setVal('iig_api_type', settings.apiType);
        setVal('iig_endpoint', settings.endpoint);
        setVal('iig_api_key', settings.apiKey);
        setVal('iig_path_override', settings.pathOverride);
        setVal('iig_naistera_model', settings.naisteraModel);
        setVal('iig_video_model', settings.videoModel);
        const showAll = document.getElementById('iig_show_all_models');
        if (showAll) showAll.checked = !!settings.showAllModels;
        const sendRefs = document.getElementById('iig_naistera_send_refs');
        if (sendRefs) sendRefs.checked = settings.naisteraSendRefs !== false;
        const gSendRefs = document.getElementById('iig_gemini_send_refs');
        if (gSendRefs) gSendRefs.checked = settings.geminiSendRefs !== false;
        // Keep the saved model selectable even if not yet in the options list.
        const modelSel = document.getElementById('iig_model');
        if (modelSel) {
            if (settings.model && !Array.from(modelSel.options).some(o => o.value === settings.model)) {
                const opt = document.createElement('option');
                opt.value = settings.model;
                opt.textContent = settings.model;
                opt.selected = true;
                modelSel.appendChild(opt);
            }
            modelSel.value = settings.model || '';
        }
        updateVisibility();
        toastr.success(`Preset "${preset.name}" loaded`, 'Image Generation', { timeOut: 2500 });
    });

    document.getElementById('iig_preset_save')?.addEventListener('click', () => {
        // Pre-fill with active preset name so "save over existing" is one-click.
        const suggested = settings.activePresetName || '';
        const name = (window.prompt('Preset name:', suggested) || '').trim();
        if (!name) return;

        if (!Array.isArray(settings.presets)) settings.presets = [];
        const snap = snapshotApiConfig(settings);
        snap.name = name;

        const idx = settings.presets.findIndex(p => p && p.name === name);
        if (idx >= 0) {
            if (!window.confirm(`Preset "${name}" exists. Overwrite?`)) return;
            settings.presets[idx] = snap;
            toastr.success(`Preset "${name}" overwritten`, 'Image Generation', { timeOut: 2500 });
        } else {
            settings.presets.push(snap);
            toastr.success(`Preset "${name}" saved`, 'Image Generation', { timeOut: 2500 });
        }
        settings.activePresetName = name;
        saveSettings({ sync: true });
        refreshPresetDropdown();
    });

    document.getElementById('iig_preset_delete')?.addEventListener('click', () => {
        const sel = document.getElementById('iig_preset_select');
        const name = sel?.value;
        if (!name) {
            toastr.info('Select a preset to delete first', 'Image Generation', { timeOut: 2500 });
            return;
        }
        if (!window.confirm(`Delete preset "${name}"?`)) return;
        settings.presets = (settings.presets || []).filter(p => p && p.name !== name);
        if (settings.activePresetName === name) settings.activePresetName = '';
        saveSettings({ sync: true });
        refreshPresetDropdown();
        toastr.info(`Preset "${name}" deleted`, 'Image Generation', { timeOut: 2500 });
    });
    
    document.getElementById('iig_max_retries')?.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        settings.maxRetries = Number.isNaN(val) ? 0 : Math.max(0, Math.min(5, val));
        saveSettings();
    });
    
    document.getElementById('iig_retry_delay')?.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        settings.retryDelay = Number.isNaN(val) ? 1000 : Math.max(500, val);
        saveSettings();
    });
    
    document.getElementById('iig_export_logs')?.addEventListener('click', () => {
        exportLogs();
    });

    // Optional launcher: only reveal + wire if ST-ImageManager is present.
    const openImBtn = document.getElementById('iig_open_image_manager');
    if (openImBtn && isImageManagerInstalled()) {
        openImBtn.classList.remove('iig-hidden');
        openImBtn.addEventListener('click', () => {
            if (!runSlashCommand('/image-manager')) {
                toastr.warning('Could not open Image Manager (slash command unavailable).', 'Image Generation');
            }
        });
    }

    // Manual save: force-write extension settings via all available paths.
    document.getElementById('iig_manual_save')?.addEventListener('click', async () => {
        const btn = document.getElementById('iig_manual_save');
        const status = document.getElementById('iig_save_status');
        btn.style.opacity = '0.6';
        status.style.color = '';
        status.textContent = 'Saving…';

        let ok = false;
        const errors = [];

        // 1. Non-debounced window.saveSettings if present.
        if (typeof window.saveSettings === 'function') {
            try {
                await window.saveSettings();
                ok = true;
                iigLog('INFO', 'Manual save: window.saveSettings OK');
            } catch(e) {
                errors.push('window.saveSettings: ' + e.message);
            }
        }

        // 2. Debounced save as belt-and-suspenders.
        try {
            SillyTavern.getContext().saveSettingsDebounced();
        } catch(e) { errors.push('debounced: ' + e.message); }

        // 3. localStorage backup.
        persistRefsToLocalStorage();

        // 4. Direct POST /api/settings/save fallback.
        if (!ok) {
            try {
                const ctx = SillyTavern.getContext();
                const payload = {};
                for (const k of ['power_user','oai_settings','extension_settings']) {
                    if (window[k] !== undefined) payload[k] = window[k];
                }
                payload['extension_settings'] = ctx.extensionSettings;
                const resp = await fetchWithTimeout('/api/settings/save', {
                    method: 'POST',
                    headers: ctx.getRequestHeaders(),
                    body: JSON.stringify(payload)
                }, 30000);
                if (resp.ok) { ok = true; iigLog('INFO', 'Manual save: API OK'); }
                else { errors.push('API: HTTP ' + resp.status); }
            } catch(e) { errors.push('API: ' + e.message); }
        }

        btn.style.opacity = '1';
        if (ok) {
            status.style.color = '#4caf50';
            status.textContent = '✓ Saved';
            setTimeout(() => { status.textContent = ''; }, 3000);
        } else {
            status.style.color = '#f44336';
            status.textContent = '✗ Error: ' + errors.join('; ');
            iigLog('ERROR', 'Manual save failed:', errors.join('; '));
        }
    });

    /**
     * Clear refs folder: wipe every file in /iig_refs on the ST server.
     * Folder prefix is derived from a live ref path (handles hosted setups
     * where ST's user prefix is unknown); falls back to /user/images/iig_refs/.
     * Slots pointing at deleted files silently become empty until next upload.
     */
    document.getElementById('iig_clear_refs_folder')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (!window.confirm('Delete every file in the iig_refs folder on the SillyTavern server? Currently-used ref slots will have their underlying files removed and will need to be re-uploaded.')) return;
        btn.style.opacity = '0.6';
        try {
            const files = await listIigRefsFolder();
            if (files.length === 0) {
                toastr.info('iig_refs folder is already empty', 'Image Generation', { timeOut: 2500 });
                return;
            }

            const refs = getCurrentCharacterRefs();
            const sampleRef = [refs.charRef, refs.userRef, ...(refs.npcReferences || [])]
                .find(r => r && r.imagePath && r.imagePath.includes('/iig_refs/'));
            let folderPrefix = '/user/images/iig_refs/';
            if (sampleRef) {
                const idx = sampleRef.imagePath.indexOf('/iig_refs/');
                if (idx >= 0) folderPrefix = sampleRef.imagePath.slice(0, idx + '/iig_refs/'.length);
            }

            let deleted = 0;
            let failed = 0;
            for (const name of files) {
                const path = `${folderPrefix}${name}`;
                const ok = await deleteRefFileOnServer(path);
                if (ok) deleted++; else failed++;
            }
            clearAllRefB64Cache();
            toastr.success(`Cleared iig_refs: ${deleted} deleted${failed ? `, ${failed} failed` : ''}`, 'Image Generation', { timeOut: 3500 });
            iigLog('INFO', `Clear refs folder: deleted=${deleted}, failed=${failed}, prefix=${folderPrefix}`);
        } catch (err) {
            iigLog('ERROR', 'Clear refs folder failed:', err.message);
            toastr.error('Clear failed: ' + err.message, 'Image Generation');
        } finally {
            btn.style.opacity = '1';
        }
    });

    // Test connection: per-apiType probe with distinct error diagnostics.
    document.getElementById('iig_test_connection')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (btn.classList.contains('testing')) return;
        btn.classList.add('testing');
        const icon = btn.querySelector('i');
        const origClass = icon.className;
        icon.className = 'fa-solid fa-spinner';

        try {
            const s = getSettings();
            iigLog('INFO', `Test connection: apiType=${s.apiType}, endpoint=${s.endpoint}, apiKey=${s.apiKey ? 'set' : 'empty'}`);

            switch (s.apiType) {
                case 'naistera': {
                    if (!s.apiKey) throw new Error('Set API key first');
                    const testUrl = getEffectiveEndpoint(s);
                    const resp = await fetchWithTimeout(testUrl, { method: 'HEAD' }, 20000).catch(() => null);
                    if (!resp) throw new Error('Endpoint unreachable (network or CORS)');
                    if (resp.ok) {
                        toastr.success('Connection OK', 'Image Generation');
                    } else {
                        toastr.warning(`Endpoint returned HTTP ${resp.status}`, 'Image Generation');
                    }
                    break;
                }
                case 'openai':
                case 'gemini': {
                    if (!s.endpoint) throw new Error('Set endpoint first');
                    if (!s.apiKey) throw new Error('Set API key first');
                    const models = await fetchModels();
                    if (models.length > 0) {
                        toastr.success(`Connection OK — ${models.length} model(s) found`, 'Image Generation');
                    } else {
                        toastr.warning('Connected but no models returned — try Advanced → Show all models, or check your endpoint', 'Image Generation');
                    }
                    break;
                }
                default:
                    throw new Error(`Unknown API type: ${s.apiType}`);
            }

            btn.classList.add('test-success');
            setTimeout(() => btn.classList.remove('test-success'), 700);
        } catch (error) {
            toastr.error(`Connection failed: ${error.message}`, 'Image Generation');
            btn.classList.add('test-fail');
            setTimeout(() => btn.classList.remove('test-fail'), 700);
        } finally {
            btn.classList.remove('testing');
            icon.className = origClass;
        }
    });
// --- WARDROBE INIT & HANDLERS ---
    const swSettings = SillyTavern.getContext().extensionSettings.slay_wardrobe || {};
    
    const setChecked = (id, val, def = false) => { const el = document.getElementById(id); if (el) el.checked = val !== undefined ? val : def; };
    const setVal = (id, val, def = '') => { const el = document.getElementById(id); if (el) el.value = val !== undefined ? val : def; };

    setChecked('slay_sw_auto_describe', swSettings.autoDescribe, true);
    setVal('slay_sw_describe_prompt_style', swSettings.describePromptStyle, 'detailed');
    setVal('slay_sw_describe_mode', swSettings.describeMode, 'direct');
    setVal('slay_sw_describe_api_format', swSettings.describeApiFormat, 'auto');
    setVal('slay_sw_describe_endpoint', swSettings.describeEndpoint);
    setVal('slay_sw_describe_key', swSettings.describeKey);
    setVal('slay_sw_describe_model', swSettings.describeModel, 'gemini-2.5-flash');
    setChecked('slay_sw_send_outfit_desc', swSettings.sendOutfitDescription, true);
    setChecked('slay_sw_send_outfit_image_bot', swSettings.sendOutfitImageBot, true);
    setChecked('slay_sw_send_outfit_image_user', swSettings.sendOutfitImageUser, true);
    setChecked('slay_sw_collage', swSettings.experimentalCollage, false);
    setChecked('slay_sw_skip_desc_warn', swSettings.skipDescriptionWarning, false);
    setChecked('slay_sw_show_float', swSettings.showFloatingBtn, false);
    setVal('slay_sw_max_dim', swSettings.maxDimension, 512);
    setVal('slay_sw_modal_width', swSettings.modalWidth, 'normal');

    document.getElementById('slay_sw_describe_api_section')?.classList.toggle('iig-hidden', swSettings.autoDescribe === false);
    document.getElementById('slay_sw_describe_prompt_section')?.classList.toggle('iig-hidden', swSettings.autoDescribe === false);
    document.getElementById('slay_sw_direct_api_section')?.classList.toggle('iig-hidden', swSettings.describeMode === 'chat');

    document.getElementById('slay_sw_open_wardrobe')?.addEventListener('click', () => {
        if (window.slayWardrobe?.isReady()) window.slayWardrobe.openModal();
        else toastr.error('Гардероб не загружен', 'Гардероб');
    });

    ['auto_describe', 'send_outfit_desc', 'send_outfit_image_bot', 'send_outfit_image_user', 'collage', 'skip_desc_warn', 'show_float'].forEach(key => {
        document.getElementById(`slay_sw_${key}`)?.addEventListener('change', (e) => {
            const s = SillyTavern.getContext().extensionSettings.slay_wardrobe;
            const mappedKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
            const finalKey = mappedKey === 'autoDescribe' ? 'autoDescribe' : mappedKey === 'collage' ? 'experimentalCollage' : mappedKey;
            if (s) { s[finalKey] = e.target.checked; SillyTavern.getContext().saveSettingsDebounced(); }
            if (key === 'auto_describe') {
                document.getElementById('slay_sw_describe_api_section')?.classList.toggle('iig-hidden', !e.target.checked);
                document.getElementById('slay_sw_describe_prompt_section')?.classList.toggle('iig-hidden', !e.target.checked);
            }
            if (key === 'show_float') $('#sw-bar-btn').toggle(e.target.checked);
        });
    });

    ['describe_prompt_style', 'describe_mode', 'describe_api_format', 'describe_endpoint', 'describe_model', 'max_dim', 'modal_width'].forEach(key => {
        document.getElementById(`slay_sw_${key}`)?.addEventListener(key.includes('endpoint') || key.includes('model') ? 'input' : 'change', (e) => {
            const s = SillyTavern.getContext().extensionSettings.slay_wardrobe;
            let val = e.target.value;
            if (key === 'max_dim') val = Math.max(128, Math.min(1024, parseInt(val) || 512));
            if (key === 'describe_endpoint' || key === 'describe_model') val = val.trim();
            const mappedKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
            const finalKey = mappedKey === 'maxDim' ? 'maxDimension' : mappedKey;
            if (s) { s[finalKey] = val; SillyTavern.getContext().saveSettingsDebounced(); }
            if (key === 'describe_mode') document.getElementById('slay_sw_direct_api_section')?.classList.toggle('iig-hidden', val !== 'direct');
            if (key === 'modal_width') window.slayWardrobe?.applyModalWidth?.();
        });
    });

    document.getElementById('slay_sw_describe_key')?.addEventListener('input', (e) => {
        const s = SillyTavern.getContext().extensionSettings.slay_wardrobe;
        if (s) { s.describeKey = String(e.target.value || '').replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').trim(); SillyTavern.getContext().saveSettingsDebounced(); }
    });
    
    document.getElementById('slay_sw_describe_key_toggle')?.addEventListener('click', () => {
        const input = document.getElementById('slay_sw_describe_key'); const icon = document.querySelector('#slay_sw_describe_key_toggle i');
        if (input.type === 'password') { input.type = 'text'; icon.classList.replace('fa-eye', 'fa-eye-slash'); } 
        else { input.type = 'password'; icon.classList.replace('fa-eye-slash', 'fa-eye'); }
    });
    // --- END WARDROBE HANDLERS ---
	
	document.getElementById('slay_sw_describe_refresh')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget; btn.classList.add('loading');
        try {
            const swS = SillyTavern.getContext().extensionSettings.slay_wardrobe || {};
            const ep = swS.describeEndpoint || getSettings().endpoint || '';
            const key = swS.describeKey || getSettings().apiKey || '';
            if (!ep || !key) throw new Error('Укажите endpoint и API key');
            
            const url = `${ep.replace(/\/+$/, '').replace(/\/v1(beta)?$/i, '')}/v1/models`;
            const resp = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${key}` } });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            
            const models = (data.data || []).map(m => m.id).sort();
            const dl = document.getElementById('slay_sw_describe_model_list');
            if (dl) { 
                dl.innerHTML = ''; 
                models.forEach(m => { const o = document.createElement('option'); o.value = m; dl.appendChild(o); }); 
            }
            toastr.success(`Найдено моделей: ${models.length}`, 'Гардероб');
        } catch (error) { toastr.error(`Ошибка: ${error.message}`, 'Гардероб'); }
        finally { btn.classList.remove('loading'); }
    });

    document.getElementById('slay_sw_describe_test')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget; if (btn.classList.contains('testing')) return;
        btn.classList.add('testing'); const icon = btn.querySelector('i'); const orig = icon.className; icon.className = 'fa-solid fa-spinner iig-spin-anim';
        try {
            const swS = SillyTavern.getContext().extensionSettings.slay_wardrobe || {};
            const ep = swS.describeEndpoint || getSettings().endpoint || '';
            const key = swS.describeKey || getSettings().apiKey || '';
            if (!ep || !key) throw new Error('Укажите endpoint и API key');

            const url = `${ep.replace(/\/+$/, '').replace(/\/v1(beta)?$/i, '')}/v1/models`;
            const resp = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${key}` } });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            
            toastr.success(`Connection OK — ${(data.data || []).length} моделей доступно`, 'Гардероб');
            btn.classList.add('test-success'); setTimeout(() => btn.classList.remove('test-success'), 700);
        } catch (error) {
            toastr.error(`Ошибка: ${error.message}`, 'Гардероб');
            btn.classList.add('test-fail'); setTimeout(() => btn.classList.remove('test-fail'), 700);
        } finally { btn.classList.remove('testing'); icon.className = orig; }
    });
	
	document.getElementById('iig_open_style_library')?.addEventListener('click', openStyleModal);

    bindRefSlotEvents();
    updateVisibility();
}

/** Fullscreen image lightbox. Click image to open; Escape or backdrop to close. */
function initLightbox() {
    if (document.getElementById('iig_lightbox')) return;

    const overlay = document.createElement('div');
    overlay.id = 'iig_lightbox';
    overlay.className = 'iig-lightbox';
    overlay.innerHTML = `
        <div class="iig-lightbox-backdrop"></div>
        <div class="iig-lightbox-content">
            <img class="iig-lightbox-img" src="" alt="Full-size preview">
            <div class="iig-lightbox-actions">
                <button class="iig-lightbox-action-btn iig-lb-download" title="Download">${SVG_ICON_DOWNLOAD}</button>
                <button class="iig-lightbox-action-btn iig-lb-regen" title="Regenerate">${SVG_ICON_REGENERATE}</button>
            </div>
            <div class="iig-lightbox-caption"></div>
            <button class="iig-lightbox-close" title="Close"><i class="fa-solid fa-xmark"></i></button>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay._sourceImg = null;

    const close = () => { overlay.classList.remove('open'); overlay._sourceImg = null; };
    overlay.querySelector('.iig-lightbox-backdrop').addEventListener('click', close);
    overlay.querySelector('.iig-lightbox-close').addEventListener('click', close);

    overlay.querySelector('.iig-lb-download').addEventListener('click', (e) => {
        e.stopPropagation();
        if (overlay._sourceImg) downloadGeneratedImage(overlay._sourceImg);
    });
    overlay.querySelector('.iig-lb-regen').addEventListener('click', (e) => {
        e.stopPropagation();
        if (overlay._sourceImg) {
            close();
            regenerateSingleImage(overlay._sourceImg);
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('open')) close();
    });

    // Desktop only: click a generated image to open lightbox. Mobile uses action buttons instead.
    document.getElementById('chat')?.addEventListener('click', (e) => {
        if (IS_MOBILE) return;
        if (e.target.closest('.iig-action-btn')) return;

        const img = e.target.closest('.iig-generated-image');
        if (!img) return;

        e.preventDefault();
        e.stopPropagation();
        openLightbox(img);
    });

    iigLog('INFO', 'Lightbox initialized');
}

/** Toggle the drawer-header status dot based on settings.enabled. */
function updateHeaderStatusDot() {
    const settings = getSettings();
    const header = document.querySelector('.inline-drawer-header');
    if (!header) return;

    let dot = header.querySelector('.iig-header-dot');
    if (!dot) {
        dot = document.createElement('span');
        dot.className = 'iig-header-dot';
        const chevron = header.querySelector('.inline-drawer-icon');
        if (chevron) {
            header.insertBefore(dot, chevron);
        } else {
            header.appendChild(dot);
        }
    }

    dot.classList.toggle('active', settings.enabled);
    dot.title = settings.enabled ? 'Generation enabled' : 'Generation disabled';
}

// =========================================================================
// Modal & Floating Button Logic
// =========================================================================

let currentStyleFilter = 'all';

function openStyleModal() {
    if (document.getElementById('iig-style-modal-overlay')) return;
    const ov = document.createElement('div');
    ov.id = 'iig-style-modal-overlay';
    ov.innerHTML = `
        <div id="iig-style-modal">
            <div class="sw-modal-header">
                <span><i class="fa-solid fa-palette"></i> Библиотека стилей</span>
                <div class="sw-modal-close" id="iig-style-close"><i class="fa-solid fa-xmark"></i></div>
            </div>
            <div class="iig-style-modal-body">
                <div class="iig-style-sidebar">
                    <div class="iig-style-filters" id="iig-style-filters">
                        <!-- Фильтры генерируются динамически -->
                    </div>
                    <div class="iig-style-list-container" id="iig_style_modal_list"></div>
                    <div style="padding: 10px; border-top: 1px solid rgba(255,255,255,0.1);">
                        <button id="iig_style_modal_add" class="menu_button" style="width:100%;"><i class="fa-solid fa-plus"></i> Новый стиль</button>
                    </div>
                </div>
                <div class="iig-style-editor-area" id="iig_style_modal_editor"></div>
            </div>
        </div>
    `;
    document.body.appendChild(ov);
    document.getElementById('iig-style-close').addEventListener('click', () => ov.remove());
    
    document.getElementById('iig-style-filters').addEventListener('click', (e) => {
        if(e.target.classList.contains('iig-style-filter-btn')) {
            currentStyleFilter = e.target.getAttribute('data-filter');
            renderStyleModal();
        }
    });
    document.getElementById('iig_style_modal_add').addEventListener('click', async () => {
        const name = await slayPromptInput('Новое название:', 'Мой стиль');
        if (name && name.trim()) {
            const s = createStyle(name);
            selectedStyleId = s.id; saveSettings(); renderStyleModal();
        }
    });
    
    renderStyleModal();
}

function renderStyleModal() {
    const settings = getSettings();
    const styles = ensureStyles(settings);
    const listEl = document.getElementById('iig_style_modal_list');
    const editorEl = document.getElementById('iig_style_modal_editor');
    const filtersEl = document.getElementById('iig-style-filters');
    if (!listEl || !editorEl) return;

    // Динамический сбор всех существующих тегов
    const allTags = [...new Set(styles.flatMap(s => s.tags))];
    filtersEl.innerHTML = `
        <div class="iig-style-filter-btn ${currentStyleFilter === 'all' ? 'active' : ''}" data-filter="all">Все</div>
        <div class="iig-style-filter-btn ${currentStyleFilter === 'fav' ? 'active' : ''}" data-filter="fav"><i class="fa-solid fa-star"></i></div>
        ${allTags.map(tag => `<div class="iig-style-filter-btn ${currentStyleFilter === tag ? 'active' : ''}" data-filter="${tag}">${sanitizeForHtml(tag)}</div>`).join('')}
    `;

    const visibleStyles = styles.filter(s => {
        if (currentStyleFilter === 'all') return true;
        if (currentStyleFilter === 'fav') return s.isFavorite;
        return s.tags.includes(currentStyleFilter);
    });

    listEl.innerHTML = visibleStyles.map(s => `
        <div class="iig-style-list-item ${s.id === selectedStyleId ? 'selected' : ''}" data-id="${s.id}">
            <div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                ${s.isFavorite ? '<i class="fa-solid fa-star" style="color:#fbbf24; font-size:10px;"></i> ' : ''}${sanitizeForHtml(s.name)}
            </div>
            ${s.id === settings.activeStyleId ? '<i class="fa-solid fa-circle-check" style="color:var(--slay-pink);"></i>' : ''}
        </div>
    `).join('');

    listEl.querySelectorAll('.iig-style-list-item').forEach(item => {
        item.addEventListener('click', () => {
            selectedStyleId = item.getAttribute('data-id');
            renderStyleModal();
        });
    });

    const sel = styles.find(s => s.id === selectedStyleId);
    if (!sel) {
        editorEl.innerHTML = '<div class="hint" style="text-align:center; margin-top:50px;">Выберите стиль слева или создайте новый</div>';
        return;
    }

    const isActive = sel.id === settings.activeStyleId;
    const imgBg = sel.imagePath ? `url('${sel.imagePath.replace(/"/g, '\\"')}')` : 'none';

    editorEl.innerHTML = `
        <div class="iig-style-editor-top">
            <div class="iig-style-cover-wrap" id="iig-style-cover" style="background-image: ${imgBg}; background-size: cover; background-position: center;">
                ${!sel.imagePath ? '<i class="fa-solid fa-image" style="font-size:2.5em; opacity:0.3;"></i>' : ''}
				<button class="iig-style-zoom-btn" title="На весь экран"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
                <div class="iig-style-cover-overlay"><i class="fa-solid fa-camera"></i></div>
            </div>
            <div class="iig-style-controls">
                <input type="text" id="iig-sm-name" class="text_pole" value="${sanitizeForHtml(sel.name)}" placeholder="Название">
                <input type="text" id="iig-sm-tags" class="text_pole" value="${sanitizeForHtml(sel.tags.join(', '))}" placeholder="Теги через запятую (например: NB, Novel)">
                <div style="display:flex; gap:6px; margin-top:auto;">
                    <button class="menu_button ${isActive ? 'redWarningBG' : ''}" id="iig-sm-toggle" style="flex:1;" title="${isActive ? 'Отключить стиль' : 'Активировать этот стиль для всех генераций'}">
                        <i class="fa-solid ${isActive ? 'fa-ban' : 'fa-circle-check'}"></i> ${isActive ? 'Отключить' : 'Включить'}
                    </button>
                    <button class="menu_button" id="iig-sm-fav" title="В избранное" style="color:${sel.isFavorite ? '#fbbf24' : ''}">
                        <i class="fa-solid fa-star"></i>
                    </button>
                    <button class="menu_button" id="iig-sm-dup" title="Дублировать стиль"><i class="fa-solid fa-copy"></i></button>
                    <button class="menu_button redWarningBG" id="iig-sm-del" title="Удалить стиль"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        </div>
        <textarea id="iig-sm-prompt" class="text_pole iig-settings-textarea" style="flex:1;" placeholder="Введите промпт стиля...">${sanitizeForHtml(sel.value)}</textarea>
    `;

    document.getElementById('iig-style-cover').addEventListener('click', () => uploadStyleCover(sel.id));
    
    const saveEdits = () => {
        const name = document.getElementById('iig-sm-name').value;
        const prompt = document.getElementById('iig-sm-prompt').value;
        const tags = document.getElementById('iig-sm-tags').value.split(',').map(t => t.trim()).filter(Boolean);
        updateStyle(sel.id, { name, value: prompt, tags });
        saveSettings();
    };

    document.getElementById('iig-sm-name').addEventListener('input', saveEdits);
    document.getElementById('iig-sm-prompt').addEventListener('input', saveEdits);
    document.getElementById('iig-sm-tags').addEventListener('blur', () => { saveEdits(); renderStyleModal(); }); // Обновляем фильтры по блюру

    document.getElementById('iig-sm-toggle').addEventListener('click', () => {
        settings.activeStyleId = isActive ? '' : sel.id;
        saveSettings(); renderStyleModal(); updateStyleFloatingBtn();
    });
    document.getElementById('iig-sm-fav').addEventListener('click', () => {
        updateStyle(sel.id, { isFavorite: !sel.isFavorite });
        saveSettings(); renderStyleModal();
    });
    document.getElementById('iig-sm-dup').addEventListener('click', () => {
        const copy = createStyle(`Копия ${sel.name}`);
        updateStyle(copy.id, { value: sel.value, tags: sel.tags, imagePath: sel.imagePath });
        selectedStyleId = copy.id; saveSettings(); renderStyleModal();
    });
    document.getElementById('iig-sm-del').addEventListener('click', async () => {
        if (await slayConfirm(`Удалить стиль "${sel.name}"?`)) {
            removeStyle(sel.id); saveSettings(); renderStyleModal(); updateStyleFloatingBtn();
        }
    });
}

async function uploadStyleCover(styleId) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            toastr.info('Загрузка обложки...', 'Стили');
            const reader = new FileReader();
            reader.onload = async (ev) => {
                const dataUrl = ev.target.result;
                const path = await saveImageToFile(dataUrl);
                updateStyle(styleId, { imagePath: path });
                saveSettings(); renderStyleModal();
                toastr.success('Обложка сохранена!', 'Стили');
            };
            reader.readAsDataURL(file);
        } catch (err) { toastr.error('Ошибка загрузки', 'Стили'); }
    };
    input.click();
}

function initStyleFloatingBtn() {
    let $btn = $('#iig-style-bar-btn');
    if ($btn.length === 0) {
        // Добавили класс interactable, чтобы кнопка не раздувалась и выглядела нативной
        $btn = $('<div id="iig-style-bar-btn" class="interactable" title="Библиотека стилей"><i class="fa-solid fa-palette"></i></div>');
        const btnEl = $btn.get(0);
        
        btnEl.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            openStyleModal();
        });

        let hoverTimer;
        btnEl.addEventListener('mouseenter', () => {
            hoverTimer = setTimeout(() => {
                const settings = getSettings();
                const activeStyle = ensureStyles(settings).find(s => s.id === settings.activeStyleId);
                if (!activeStyle || !activeStyle.imagePath) return;

                const previewHtml = `
                    <div id="iig-style-hover-preview" class="sw-pp-peek sw-pp-peek-show" style="width: 150px; z-index: 99999;">
                        <div class="sw-pp-peek-img" style="background-image: url('${activeStyle.imagePath.replace(/"/g, '\\"')}'); height: 150px;"></div>
                        <div class="sw-pp-peek-name" style="padding: 6px; font-size: 11px; text-align: center;">${sanitizeForHtml(activeStyle.name)}</div>
                    </div>
                `;
                $('body').append(previewHtml);
                
                const peek = document.getElementById('iig-style-hover-preview');
                const r = btnEl.getBoundingClientRect();
                peek.style.left = Math.max(8, r.left + r.width / 2 - 75) + 'px';
                peek.style.top = Math.max(8, r.top - 190) + 'px';
            }, 400);
        });
        btnEl.addEventListener('mouseleave', () => {
            clearTimeout(hoverTimer);
            $('#iig-style-hover-preview').remove();
        });

        // Железобетонная привязка: ищем кнопку гардероба и встаем сразу после нее
        const $wardrobeBtn = $('#sw-bar-btn');
        if ($wardrobeBtn.length) {
            $wardrobeBtn.after($btn);
        } else {
            const $left = $('#leftSendForm');
            if ($left.length) $left.append($btn); else $('body').append($btn);
        }
    }
    updateStyleFloatingBtn();
    $btn.show();
}

function updateStyleFloatingBtn() {
    const settings = getSettings();
    $('#iig-style-bar-btn').toggleClass('iig-style-bar-active', !!settings.activeStyleId);
}

// Extension init. Runs once at module load.
(function init() {
    // Primer: populate context cache for the rest of the module.
    const context = getContext();

    // Capture ST's window.saveSettings before our declaration shadows it
    // (the non-debounced path matters for durable mobile writes).
    if (!_stSaveSettingsCaptured) {
        const candidate = window.saveSettings;
        if (typeof candidate === 'function' && candidate !== saveSettings) {
            _stSaveSettings = candidate;
        }
        _stSaveSettingsCaptured = true;
    }

    iigLog('INFO', `Initializing Inline Image Generation v${IIG_VERSION} by aceeenvw`);
    iigLog('INFO', `Platform: ${IS_IOS ? 'iOS' : 'Desktop'}, Timeout: ${FETCH_TIMEOUT/1000}s`);

    getSettings();
    
    context.eventSource.on(context.event_types.APP_READY, () => {
        // One-shot base64 migration, fire-and-forget.
        migrateBase64Refs().catch(e => iigLog('ERROR', `migrateBase64Refs crashed: ${e.message}`));

        restoreRefsFromLocalStorage();
        createSettingsUI();
        addButtonsToExistingMessages();
		initStyleFloatingBtn();
        wrapExistingImages();
        initLightbox();
        updateHeaderStatusDot();
        initMobileSaveListeners();
        initImageWrapObserver();
        iigLog('INFO', 'Inline Image Generation extension loaded');
    });
    
    // Coalesced CHAT_CHANGED handler. Single guarded timer; MutationObserver covers late-rendered images.
    let _chatChangedTimer = null;
    context.eventSource.on(context.event_types.CHAT_CHANGED, () => {
        iigLog('INFO', 'CHAT_CHANGED event');
        invalidateContextCache();
        // Clear per-chat processing state so a same-index message in the new chat isn't skipped.
        clearProcessingStateForChatChange();
        clearAllRefB64Cache();

        if (_chatChangedTimer) clearTimeout(_chatChangedTimer);
        _chatChangedTimer = setTimeout(() => {
            _chatChangedTimer = null;
            restoreRefsFromLocalStorage();
            addButtonsToExistingMessages();
            wrapExistingImages();
            renderRefSlots();
        }, 300);
    });

    // Pause the image-wrap observer's heavy DOM pass while ST streams a reply
    // (per-token CPU saver), then flush its queue when streaming ends. The gate
    // only covers streaming text; a guaranteed wrap pass after our own media
    // generation (scheduleWrapPass) is what restores action buttons live.
    if (context.event_types.GENERATION_STARTED) {
        context.eventSource.on(context.event_types.GENERATION_STARTED, () => {
            _iigGenerating = true;
        });
    }
    if (context.event_types.GENERATION_ENDED) {
        context.eventSource.on(context.event_types.GENERATION_ENDED, () => {
            _iigGenerating = false;
            try { _iigFlushWrapQueue?.(); } catch (_) {}
        });
    }

    const handleMessage = async (messageId) => {
        iigLog('INFO', `Event triggered for message: ${messageId}`);
        // Streaming is done — clear the gate and flush any queued wraps.
        _iigGenerating = false;
        try { _iigFlushWrapQueue?.(); } catch (_) {}
        await onMessageReceived(messageId);
        // Our media generation is async; after it lands ST re-renders the
        // message into a bare <img>. Re-wrap so the action buttons reappear
        // without needing a page reload.
        scheduleWrapPass();
    };

    // Render handler. Swipe-back only re-wraps buttons (never regenerates).
    context.eventSource.makeLast(context.event_types.CHARACTER_MESSAGE_RENDERED, handleMessage);

    if (context.event_types.MESSAGE_SWIPED) {
        context.eventSource.on(context.event_types.MESSAGE_SWIPED, () => {
            scheduleWrapPass();
        });
    }

    // Safe public handshake for collaborating extensions (no keys/setters exposed).
    try {
        window.IIG = {
            version: IIG_VERSION,
            openSettings() {
                try {
                    const drawer = document.querySelector('.inline-drawer:has(.iig-settings)');
                    if (!drawer) return false;
                    const content = drawer.querySelector('.inline-drawer-content');
                    const header = drawer.querySelector('.inline-drawer-toggle');
                    // ST hides collapsed drawers via display:none on the content.
                    if (content && getComputedStyle(content).display === 'none') header?.click();
                    drawer.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    return true;
                } catch (_) { return false; }
            },
            getLastGenerated() {
                return _lastGenerated ? { ..._lastGenerated } : null;
            },
        };
    } catch (_) { /* never block init on the optional public API */ }

    iigLog('INFO', 'Inline Image Generation extension initialized');
})();
