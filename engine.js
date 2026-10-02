/* =========================================================
   Logo de Memória — motor compartilhado (jogo + ADM)
   - Quadro de desenho estilo Gartic (ocupa o espaço disponível)
   - Desafios por rodada: tamanho do canvas, cores, ferramentas
   - Gravação de ações (traços e balde)
   - Roteiro: transforma a gravação num caminho que o cursor
     falso percorre conforme o jogador mexe o mouse
   ========================================================= */
(function (global) {
  'use strict';

  const DEFAULT_PALETTE = [
    '#000000', '#5c5c5c', '#a8a8a8', '#ffffff', '#ff1f3d', '#ff7a00', '#ffd400', '#7ee000', '#00b84a', '#00d6c8',
    '#00a2ff', '#0047ff', '#1b1464', '#8a2be2', '#ff4fd8', '#ff9ecb', '#8b4a1c', '#e0a96d', '#b30000', '#005c2e'
  ];
  const SIZES = [3, 7, 12, 20, 32];
  const SIZE_NAMES = ['Fininho', 'Fino', 'Médio', 'Grosso', 'Enorme'];
  const TOOLS = [['brush', '✏️', 'Pincel'], ['bucket', '🪣', 'Balde'], ['eraser', '🧽', 'Borracha']];
  const BASE_W = 800, BASE_H = 500; // espaço das gravações antigas

  /* ---------- utilidades ---------- */
  function hashStr(s) {
    let h = 1779033703 ^ s.length;
    for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = typeof seed === 'number' ? seed >>> 0 : hashStr(String(seed));
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hexToRgb(h) {
    h = String(h || '#000').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function dist2(a, b) { const [r, g, bl] = hexToRgb(a), [r2, g2, b2] = hexToRgb(b); return (r - r2) ** 2 + (g - g2) ** 2 + (bl - b2) ** 2; }
  function nearestIdx(pal, hex) { let bi = 0, bd = 1e9; pal.forEach((c, i) => { const d = dist2(c, hex); if (d < bd) { bd = d; bi = i; } }); return bi; }
  function nearestSize(px) { let bi = 0, bd = 1e9; SIZES.forEach((s, i) => { const d = Math.abs(s - px); if (d < bd) { bd = d; bi = i; } }); return bi; }
  function asArray(v) { return Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []; }

  // Normaliza uma "versão" vinda do Firebase: {label, actions, cw, ch}
  function normVersion(v, i) {
    v = v || {};
    return {
      label: v.label || ('Versão ' + ((i | 0) + 1)),
      cw: +v.cw || BASE_W, ch: +v.ch || BASE_H, dur: +v.dur || 0,
      actions: asArray(v.actions).filter(Boolean).map(a => (a.p && !Array.isArray(a.p) ? Object.assign({}, a, { p: asArray(a.p) }) : a))
    };
  }
  function versionsOf(l) {
    if (!l) return [];
    let v = asArray(l.versions).filter(Boolean);
    if (!v.length && l.actions) v = [{ label: 'Versão 1', actions: l.actions }];
    return v.map(normVersion);
  }
  // Desafio da logo (com padrões)
  function challengeOf(l) {
    const c = (l && l.challenge) || {};
    const colors = asArray(c.colors).filter(Boolean);
    return {
      time: +c.time || 0,
      scale: clamp(+c.scale || 1, 0.3, 1),
      colors: colors.length ? colors : null,
      bucket: c.bucket !== false,
      eraser: c.eraser !== false,
      fixedSize: c.fixedSize === '' || c.fixedSize == null ? null : clamp(+c.fixedSize, 0, SIZES.length - 1),
      note: c.note || '',
      announce: c.announce || ''
    };
  }
  // Texto grande que aparece depois da contagem (se vazio, usa os desafios)
  function announceText(l, defTime) {
    const ch = challengeOf(l);
    if (ch.announce) return ch.announce.trim() === '-' ? '' : ch.announce;
    return challengeChips(ch, defTime).join('  •  ');
  }
  function challengeChips(ch, defTime) {
    const out = [];
    if (ch.time && defTime && ch.time < defTime) out.push('⏱️ Só ' + ch.time + ' segundos!');
    else if (ch.time && defTime && ch.time > defTime) out.push('⏱️ Tempo extra: ' + ch.time + 's');
    if (ch.scale < 0.99) out.push('🔍 Canvas ' + (ch.scale <= 0.6 ? 'minúsculo' : 'menor'));
    if (ch.colors) out.push('🎨 Só ' + ch.colors.length + (ch.colors.length === 1 ? ' cor' : ' cores'));
    if (!ch.bucket) out.push('🚫 Sem balde');
    if (!ch.eraser) out.push('🚫 Sem borracha');
    if (ch.fixedSize != null) out.push('✏️ Só pincel ' + SIZE_NAMES[ch.fixedSize].toLowerCase());
    if (ch.note) out.push(ch.note);
    return out;
  }

  // linha do tempo da abertura de cada rodada (cortina fecha, 3-2-1, cortina abre, título, desafios caindo)
  // abertura da rodada: cortina fecha → título e regras caem na tela (sobre a cortina) → cortina abre → JÁ!
  function introPlan(l, cfg) {
    cfg = cfg || {};
    const def = +cfg.drawTime || 60, ch = challengeOf(l), chips = challengeChips(ch, def).slice(), time = ch.time || def;
    if (!chips.some(c => c.indexOf('⏱️') === 0)) { const tt = cfg.introTime == null ? '⏱️ {s} segundos' : String(cfg.introTime); if (tt) chips.unshift(tt.replace(/\{s\}/g, time)); }
    const title = ch.announce && ch.announce.trim() !== '-' ? ch.announce.trim() : '';
    const hold = clamp(cfg.introHold === '' || cfg.introHold == null ? 1 : +cfg.introHold, 0, 10) * 1000; // tempo extra parado no fim
    const p = { close: 1300, chips, title, chip: 900 };
    p.titleAt = p.close + 200; p.chipsAt = p.titleAt + 1600;
    p.openAt = p.chipsAt + chips.length * p.chip + hold;
    p.total = p.openAt + 1500;
    return p;
  }

  /* ---------- desenho básico ---------- */
  function drawSeg(ctx, x1, y1, x2, y2, color, w) {
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = w;
    if (x1 === x2 && y1 === y2) { ctx.beginPath(); ctx.arc(x1, y1, w / 2, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  }

  // Balde de tinta. Retorna a área pintada (px). Se maxArea for informado e a
  // região for maior, não pinta nada e retorna um número negativo.
  function floodFill(ctx, x, y, color, maxArea) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    const [fr, fg, fb] = hexToRgb(color);
    const s0 = (y * w + x) * 4, tr = d[s0], tg = d[s0 + 1], tb = d[s0 + 2];
    if (Math.abs(tr - fr) + Math.abs(tg - fg) + Math.abs(tb - fb) < 12) return 0;
    const TOL = 90, N = w * h;
    const mark = new Uint8Array(N), stack = new Int32Array(N), region = new Int32Array(N);
    let sp = 0, rn = 0;
    const ok = p => { const j = p << 2; return Math.abs(d[j] - tr) + Math.abs(d[j + 1] - tg) + Math.abs(d[j + 2] - tb) <= TOL; };
    const p0 = y * w + x; mark[p0] = 1; stack[sp++] = p0;
    while (sp) {
      const p = stack[--sp]; region[rn++] = p;
      if (maxArea && rn > maxArea) return -rn;
      const px = p % w;
      if (px > 0) { const q = p - 1; if (!mark[q] && ok(q)) { mark[q] = 1; stack[sp++] = q; } }
      if (px < w - 1) { const q = p + 1; if (!mark[q] && ok(q)) { mark[q] = 1; stack[sp++] = q; } }
      if (p >= w) { const q = p - w; if (!mark[q] && ok(q)) { mark[q] = 1; stack[sp++] = q; } }
      if (p < N - w) { const q = p + w; if (!mark[q] && ok(q)) { mark[q] = 1; stack[sp++] = q; } }
    }
    const paint = p => { const j = p << 2; d[j] = fr; d[j + 1] = fg; d[j + 2] = fb; d[j + 3] = 255; };
    for (let i = 0; i < rn; i++) paint(region[i]);
    for (let i = 0; i < rn; i++) { // expande 1px para cobrir a borda serrilhada
      const p = region[i], px = p % w;
      if (px > 0 && !mark[p - 1]) { mark[p - 1] = 2; paint(p - 1); }
      if (px < w - 1 && !mark[p + 1]) { mark[p + 1] = 2; paint(p + 1); }
      if (p >= w && !mark[p - w]) { mark[p - w] = 2; paint(p - w); }
      if (p < N - w && !mark[p + w]) { mark[p + w] = 2; paint(p + w); }
    }
    ctx.putImageData(img, 0, 0);
    return rn;
  }

  // Mapeia coordenadas gravadas (cw0 x ch0) para um canvas (cw x ch), centralizado
  function mapper(cw0, ch0, cw, ch) {
    const k = Math.min(cw / cw0, ch / ch0), ox = (cw - cw0 * k) / 2, oy = (ch - ch0 * k) / 2;
    return { k, ox, oy, f: (x, y) => [ox + x * k, oy + y * k] };
  }
  function renderVersion(ctx, ver) {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!ver) return;
    const m = mapper(ver.cw || BASE_W, ver.ch || BASE_H, ctx.canvas.width, ctx.canvas.height);
    const W = ctx.canvas.width, H = ctx.canvas.height, und = [], red = [];
    for (const a of (ver.actions || [])) {
      if (a.k === 'u') { if (und.length) { red.push(ctx.getImageData(0, 0, W, H)); ctx.putImageData(und.pop(), 0, 0); } continue; }
      if (a.k === 'r') { if (red.length) { und.push(ctx.getImageData(0, 0, W, H)); ctx.putImageData(red.pop(), 0, 0); } continue; }
      if (a.k === 's' || a.k === 'f') { und.push(ctx.getImageData(0, 0, W, H)); if (und.length > 40) und.shift(); red.length = 0; }
      if (a.k === 's') {
        const c = a.tool === 'eraser' ? '#ffffff' : a.c, w = Math.max(1.2, (SIZES[a.s] || 7) * m.k), p = a.p || [];
        if (p.length < 2) continue;
        let [x0, y0] = m.f(p[0], p[1]); drawSeg(ctx, x0, y0, x0, y0, c, w);
        for (let i = 2; i < p.length; i += 2) { const [x, y] = m.f(p[i], p[i + 1]); drawSeg(ctx, x0, y0, x, y, c, w); x0 = x; y0 = y; }
      } else if (a.k === 'f') { const [x, y] = m.f(a.x, a.y); floodFill(ctx, x, y, a.c, 0); }
    }
  }
  function renderToDataURL(ver, w, h, q) {
    const c = document.createElement('canvas'); c.width = w || ver.cw || BASE_W; c.height = h || ver.ch || BASE_H;
    renderVersion(c.getContext('2d', { willReadFrequently: true }), ver);
    return c.toDataURL('image/jpeg', q || 0.85);
  }
  // Reescala as ações de uma versão para outro tamanho de canvas
  function rescaleVersion(ver, cw, ch) {
    if (!ver.actions.length || (ver.cw === cw && ver.ch === ch)) { ver.cw = cw; ver.ch = ch; return ver; }
    const m = mapper(ver.cw, ver.ch, cw, ch);
    ver.actions = ver.actions.map(a => {
      if (a.k === 's') { const p = []; for (let i = 0; i < a.p.length; i += 2) { const [x, y] = m.f(a.p[i], a.p[i + 1]); p.push(Math.round(x * 2) / 2, Math.round(y * 2) / 2); } return Object.assign({}, a, { p, s: nearestSize((SIZES[a.s] || 7) * m.k) }); }
      if (a.k === 'f') { const [x, y] = m.f(a.x, a.y); return Object.assign({}, a, { x: Math.round(x), y: Math.round(y), a: Math.round((a.a || 0) * m.k * m.k) }); }
      return a;
    });
    ver.cw = cw; ver.ch = ch; return ver;
  }

  /* ---------- estilos do quadro (estilo Gartic, bem colorido) ---------- */
  let cssDone = false;
  function injectCSS() {
    if (cssDone) return; cssDone = true;
    const css = `
.bd{position:absolute;inset:0;padding:calc(var(--vgap,0px) + 10px) calc(var(--gap,0px) + 10px);display:grid;grid-template-columns:var(--side,196px) var(--colw,1fr);justify-content:center;grid-template-rows:auto 1fr auto;gap:10px;font-family:'Nunito',system-ui,sans-serif;color:#0a2e4d;user-select:none;-webkit-user-select:none}
.bd *{box-sizing:border-box}
.bd-panel{background:#fff;border:4px solid #0a2e4d;border-radius:22px;box-shadow:0 7px 0 #0a2e4d}
/* topo no meio, cobrindo o centro; cantos de cima livres (câmeras) */
.bd-top{grid-column:2;display:flex;align-items:stretch;gap:10px;min-height:76px}
.bd-brand{display:none;align-items:center;justify-content:center;text-align:center;font-family:'Lilita One','Nunito',sans-serif;font-size:26px;line-height:.95;color:#fff;background:linear-gradient(180deg,#00e0ff,#0077ff);letter-spacing:1px;text-shadow:0 3px 0 #0a2e4d}
.bd-hint{flex:1;display:flex;align-items:center;gap:14px;padding:6px 18px;min-width:0}
.bd-round{flex:none;font-family:'Lilita One',sans-serif;font-size:20px;color:#fff;background:#0096c7;border-radius:14px;padding:6px 14px;box-shadow:0 4px 0 #0a2e4d}
.bd-word{flex:1;display:flex;flex-direction:column;align-items:center;min-width:0}
.bd-sub{font-size:12px;font-weight:900;letter-spacing:2px;color:#0096c7;text-transform:uppercase}
.bd-name{font-family:'Lilita One',sans-serif;font-size:36px;line-height:1;color:#0a2e4d;text-transform:uppercase;letter-spacing:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.bd-chal{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-top:4px}
.bd-chal span{font-size:14px;font-weight:900;background:#ffd400;border:3px solid #0a2e4d;border-radius:20px;padding:0 10px;animation:bdwig 1.2s ease-in-out infinite}
@keyframes bdwig{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(2deg) scale(1.05)}}
.bd-clock{flex:none;width:80px;display:flex;align-items:center;justify-content:center;position:relative;padding:0}
.bd-clock svg{position:absolute;inset:6px;width:calc(100% - 12px);height:calc(100% - 12px);transform:rotate(-90deg)}
.bd-clock circle{fill:none;stroke-width:9;stroke-linecap:round}
.bd-clock .bg{stroke:#cdf4ff}.bd-clock .fg{stroke:#00b84a;transition:stroke .3s}
.bd-clock.low .fg{stroke:#ff1f3d}
.bd-time{position:relative;font-family:'Lilita One',sans-serif;font-size:24px;color:#0a2e4d}
.bd-clock.low .bd-time{color:#ff1f3d;animation:bdpulse .5s infinite alternate}
@keyframes bdpulse{to{transform:scale(1.15)}}
.bd-side{grid-row:1/4;display:flex;flex-direction:column;gap:8px;padding:10px;overflow:hidden}
.bd-side-list{display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden}
.bd-side-act{display:flex;flex-direction:column;gap:10px;margin-top:auto;padding-top:12px;border-top:3px dashed #bfeefc}
.bd-ur{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.bd-btn.bd-act{height:62px;background:#fff;color:#0a2e4d;box-shadow:0 5px 0 #0a2e4d}
.bd-act svg{width:38px;height:38px;display:block;pointer-events:none}
.bd-btn.bd-act:active{transform:translateY(3px);box-shadow:0 2px 0 #0a2e4d}
.bd-btn.bd-act.dim{opacity:.4}
.bd-btn.bd-done{height:66px;font-family:'Lilita One',sans-serif;font-size:24px;letter-spacing:1px;background:linear-gradient(#22e47c,#00b850);color:#fff;text-shadow:0 2px 0 #0a7a3a,0 0 1px #0a7a3a;box-shadow:0 5px 0 #0a2e4d,inset 0 3px 0 rgba(255,255,255,.35);border-color:#0a2e4d}
.bd-btn.bd-done:active{transform:translateY(3px);box-shadow:0 2px 0 #0a2e4d}
.bd-done.hide{visibility:hidden}
.bd-center{position:relative;display:flex;align-items:center;justify-content:center;min-height:0;min-width:0}
.bd-canvaswrap{position:relative;border:4px solid #0a2e4d;border-radius:14px;box-shadow:0 7px 0 #0a2e4d;background:#fff;overflow:hidden}
.bd-canvaswrap canvas{display:block;touch-action:none}
.bd.manual .bd-canvaswrap canvas{cursor:crosshair}
.bd.manual .bd-btn,.bd.manual .bd-sw{cursor:pointer}
.bd-ref{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;pointer-events:none;display:none}
.bd-bar{display:flex;align-items:center;justify-content:center;gap:10px;padding:8px 12px;flex-wrap:nowrap;min-width:0}
.bd-group{display:flex;gap:6px;align-items:center}
.bd-sep{width:3px;align-self:stretch;background:#cdf4ff;border-radius:3px}
.bd-btn{border:3px solid #0a2e4d;background:#e6fbff;border-radius:14px;font:inherit;color:inherit;padding:0;display:flex;align-items:center;justify-content:center;transition:transform .08s;box-shadow:0 3px 0 #0a2e4d}
.bd-tool{width:50px;height:50px;flex-direction:column;font-size:10px;font-weight:900;line-height:1}
.bd-tool .ic{font-size:21px;line-height:1.1}
.bd-size{width:36px;height:36px}
.bd-size i{display:block;border-radius:50%;background:#0a2e4d}
.bd-btn.sel{background:#ffd400;transform:translateY(-3px);box-shadow:0 6px 0 #0a2e4d}
.bd-swatches{display:grid;grid-auto-flow:column;grid-template-rows:repeat(var(--rows,2),24px);gap:4px}
.bd-swatches.one{grid-template-rows:44px}
.bd-swatches.one .bd-sw{width:44px;height:44px}
.bd-sw{width:24px;height:24px;border-radius:7px;border:3px solid #0a2e4d;padding:0;transition:transform .08s}
.bd-sw.sel{transform:scale(1.25);box-shadow:0 0 0 3px #ffd400,0 0 0 6px #0a2e4d;z-index:1;position:relative}
.bd-cur{width:42px;height:42px;border-radius:50%;border:4px solid #0a2e4d;flex:none;box-shadow:0 3px 0 #0a2e4d}
.bd .pressed{transform:scale(.82)!important}
.bd-btn.dim{opacity:.45}
.bd-cursor{position:absolute;left:0;top:0;width:32px;height:32px;pointer-events:none;z-index:130;display:none;will-change:transform}
.bd-ring{position:absolute;left:0;top:0;border-radius:50%;border:1.5px solid rgba(0,0,0,.55);box-shadow:0 0 0 1px rgba(255,255,255,.75);pointer-events:none;z-index:129;display:none}
`;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }

  const CURSOR_SVG = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M3 2 L3 21 L8 16.5 L11.5 24 L14.6 22.6 L11.1 15.3 L17.6 15.3 Z" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  // Mouse customizado (o MESMO desenho é usado no mouse de verdade e no mouse "fake")
  const CUSTOM_CURSOR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M4 3 L4 25 L10 20 L14 29 L18.5 27 L14.6 18.6 L22.5 18.6 Z" fill="#ffffff" stroke="#0a2e4d" stroke-width="2.6" stroke-linejoin="round"/><path d="M6.6 8 L6.6 19.5 L9.6 17" fill="none" stroke="#00c8ff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CUSTOM_HAND_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M11 3.2c1.4 0 2.4 1 2.4 2.4V14l1.1-.2c1.3-.2 2.4.5 2.6 1.6l.1.4.6-.1c1.3-.2 2.4.5 2.6 1.6l.1.5.5-.1c1.4-.2 2.6.7 2.6 2.1v4.6c0 3.6-2.9 6.4-6.4 6.4h-3.7c-2 0-3.8-1-4.9-2.6L4.3 21.4c-.7-1-.5-2.3.5-3 .9-.6 2.1-.5 2.8.3l1 1.2V5.6c0-1.4 1-2.4 2.4-2.4z" fill="#ffffff" stroke="#0a2e4d" stroke-width="2.2" stroke-linejoin="round"/><path d="M14 15.6v4.6M17.3 16.6v4M20.5 17.8v3.2" stroke="#00c8ff" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const CUSTOM_WAIT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M4 3 L4 25 L10 20 L14 29 L18.5 27 L14.6 18.6 L22.5 18.6 Z" fill="#ffffff" stroke="#0a2e4d" stroke-width="2.6" stroke-linejoin="round"/><circle cx="24" cy="24" r="6.3" fill="#ffffff" stroke="#0a2e4d" stroke-width="2.2"/><path d="M24 19.4a4.6 4.6 0 0 1 4.6 4.6" stroke="#00c8ff" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M19.4 24a4.6 4.6 0 0 1 1.4-3.3" stroke="#ffd400" stroke-width="2.6" fill="none" stroke-linecap="round"/></svg>';
  const CUSTOM_TEXT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M11.5 4.5h3l1.5 1.5 1.5-1.5h3M16 6v20M11.5 27.5h3l1.5-1.5 1.5 1.5h3" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.5 4.5h3l1.5 1.5 1.5-1.5h3M16 6v20M11.5 27.5h3l1.5-1.5 1.5 1.5h3" fill="none" stroke="#0a2e4d" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const GENERIC_HAND_SVG = CUSTOM_HAND_SVG.replace(/#0a2e4d/g, '#000000').replace(/#00c8ff/g, '#000000').replace('stroke-width="1.8"', 'stroke-width="1.2"');
  const svgCss = (svg, x, y, fb) => 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '") ' + x + ' ' + y + ', ' + fb;
  const CUSTOM_CURSOR_CSS = svgCss(CUSTOM_CURSOR_SVG, 4, 3, 'auto');
  const CUSTOM_HAND_CSS = svgCss(CUSTOM_HAND_SVG, 11, 3, 'pointer');
  const CUSTOM_WAIT_CSS = svgCss(CUSTOM_WAIT_SVG, 4, 3, 'progress');
  const CUSTOM_TEXT_CSS = svgCss(CUSTOM_TEXT_SVG, 16, 16, 'text');

  /* ---------- quadro de desenho ---------- */
  // opts: { palette, bucket, eraser, fixedSize, brand }
  function createBoard(host, opts) {
    opts = opts || {};
    injectCSS();
    const palette = (opts.palette && opts.palette.length ? opts.palette : DEFAULT_PALETTE).slice(0, 24);
    const tools = TOOLS.filter(([id]) => id === 'brush' || (id === 'bucket' ? opts.bucket !== false : opts.eraser !== false));
    const fixedSize = opts.fixedSize == null ? null : opts.fixedSize;
    const sizes = fixedSize == null ? SIZES.map((s, i) => i) : [fixedSize];
    const root = document.createElement('div');
    root.className = 'bd';
    root.innerHTML = `
      <div class="bd-top">
        <div class="bd-panel bd-brand">${opts.brand || 'LOGO<br>DE MEMÓRIA'}</div>
        <div class="bd-panel bd-hint"><div class="bd-round"></div><div class="bd-word"><span class="bd-sub">desenhe a logo</span><span class="bd-name"></span><div class="bd-chal"></div></div></div>
        <div class="bd-panel bd-clock"><svg viewBox="0 0 80 80"><circle class="bg" cx="40" cy="40" r="34"/><circle class="fg" cx="40" cy="40" r="34" stroke-dasharray="213.6" stroke-dashoffset="0"/></svg><span class="bd-time"></span></div>
      </div>
      <div class="bd-panel bd-side"><div class="bd-side-list"></div><div class="bd-side-act">
        <div class="bd-ur"><button class="bd-btn bd-act" data-key="act:undo" title="Desfazer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg></button><button class="bd-btn bd-act" data-key="act:redo" title="Refazer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg></button></div>
        <button class="bd-btn bd-done" data-key="act:done">FINALIZEI</button>
      </div></div>
      <div class="bd-center"><div class="bd-canvaswrap"><canvas width="10" height="10"></canvas><img class="bd-ref" alt=""></div></div>
      <div class="bd-panel bd-bar"></div>
      <div class="bd-ring"></div>
      <div class="bd-cursor">${opts.customCursor ? CUSTOM_CURSOR_SVG : CURSOR_SVG}</div>`;
    host.appendChild(root);
    const $ = s => root.querySelector(s);
    const canvas = $('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true }), wrap = $('.bd-canvaswrap');
    $('.bd-bar').innerHTML =
      `<div class="bd-group">${tools.map(([id, ic, lb]) => `<button class="bd-btn bd-tool" data-key="tool:${id}"><span class="ic">${ic}</span>${lb}</button>`).join('')}</div>` +
      `<div class="bd-sep"></div><div class="bd-group">${sizes.map(i => `<button class="bd-btn bd-size" data-key="size:${i}"><i style="width:${Math.min(SIZES[i], 26)}px;height:${Math.min(SIZES[i], 26)}px"></i></button>`).join('')}</div>` +
      `<div class="bd-sep"></div><div class="bd-cur"></div><div class="bd-swatches ${palette.length <= 4 ? 'one' : ''}" style="--rows:${palette.length > 12 ? 3 : 2}">${palette.map((c, i) => `<button class="bd-sw" data-key="color:${i}" style="background:${c}"></button>`).join('')}</div>`;

    const firstColor = Math.max(0, palette.findIndex(c => dist2(c, '#ffffff') > 3000));
    let hist = [], redoS = [], onDone = null;
    const snap = () => ctx.getImageData(0, 0, canvas.width, canvas.height);
    function pushHist() { hist.push(snap()); if (hist.length > 40) hist.shift(); redoS = []; syncUR(); }
    function undo() { if (!hist.length) return false; redoS.push(snap()); ctx.putImageData(hist.pop(), 0, 0); syncUR(); return true; }
    function redo() { if (!redoS.length) return false; hist.push(snap()); ctx.putImageData(redoS.pop(), 0, 0); syncUR(); return true; }
    function clearHist() { hist = []; redoS = []; syncUR(); }
    function syncUR() { const u = root.querySelector('[data-key="act:undo"]'), r = root.querySelector('[data-key="act:redo"]'); if (u) u.classList.toggle('dim', !hist.length); if (r) r.classList.toggle('dim', !redoS.length); }
    const state = { tool: 'brush', size: fixedSize == null ? 1 : fixedSize, color: firstColor };
    let manual = false, fake = false, onAction = null;
    const cur = { x: 300, y: 300 };
    const curEl = $('.bd-cursor'), ring = $('.bd-ring');

    function offsetIn(el) { // posição do elemento relativa ao root (sem transformações)
      let x = 0, y = 0, n = el;
      while (n && n !== root) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; if (n && n !== root) { x += n.clientLeft; y += n.clientTop; } }
      return { x, y };
    }
    const origin = () => offsetIn(canvas);
    function updateRing() {
      if (!fake || state.tool === 'bucket' || look === 'hand') { ring.style.display = 'none'; return; }
      const o = origin(), inC = cur.x >= o.x && cur.x <= o.x + canvas.width && cur.y >= o.y && cur.y <= o.y + canvas.height;
      if (!inC) { ring.style.display = 'none'; return; }
      const d = SIZES[state.size];
      ring.style.display = 'block'; ring.style.width = ring.style.height = d + 'px';
      ring.style.transform = `translate(${cur.x - d / 2}px,${cur.y - d / 2}px)`;
    }
    function sync() {
      root.querySelectorAll('[data-key]').forEach(el => {
        const [k, v] = el.dataset.key.split(':');
        el.classList.toggle('sel', (k === 'tool' && state.tool === v) || (k === 'size' && state.size === +v) || (k === 'color' && state.color === +v));
      });
      $('.bd-cur').style.background = palette[state.color];
      root.querySelectorAll('.bd-size i').forEach(i => { i.style.background = dist2(palette[state.color], '#ffffff') < 3000 ? '#bbb' : palette[state.color]; });
      updateRing();
    }
    function apply(key) {
      const [k, v] = key.split(':');
      if (k === 'tool') state.tool = v; else if (k === 'size') state.size = +v; else if (k === 'color') state.color = +v;
      sync();
    }
    function press(key) {
      if (key === 'act:undo') undo(); else if (key === 'act:redo') redo(); else if (key === 'act:done') { if (onDone) setTimeout(onDone, 0); } else apply(key);
      const el = root.querySelector(`[data-key="${key}"]`);
      if (el) { el.classList.remove('pressed'); void el.offsetWidth; el.classList.add('pressed'); setTimeout(() => el.classList.remove('pressed'), 150); }
    }
    // ===== gravação do trajeto do mouse (ADM): cada ação guarda o caminho feito até ela =====
    let trk = [], trkT = 0, trkState = null;
    function rootPt(e) { const r = root.getBoundingClientRect(), k = root.offsetWidth / (r.width || 1); return [(e.clientX - r.left) * k, (e.clientY - r.top) * k]; }
    function sample(e, extra) {
      if (!manual) return;
      const [x, y] = rootPt(e), t = performance.now();
      if (!trk.length) { trkT = t; trkState = { tool: state.tool, size: state.size, color: state.color }; }
      const s = { d: Math.round(Math.min(t - trkT, 4000)), x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
      trkT = t;
      const o = origin();
      if (x >= o.x && x <= o.x + canvas.width && y >= o.y && y <= o.y + canvas.height) s.c = [Math.round((x - o.x) * 10) / 10, Math.round((y - o.y) * 10) / 10];
      else {
        const el = e.target && e.target.closest && e.target.closest('[data-key]');
        if (el && root.contains(el)) { const p = offsetIn(el); s.k = el.dataset.key; s.f = [Math.round((x - p.x) / el.offsetWidth * 1000) / 1000, Math.round((y - p.y) / el.offsetHeight * 1000) / 1000]; }
      }
      if (stroke) s.p = 1;
      Object.assign(s, extra || {});
      const last = trk[trk.length - 1];
      if (!extra && last && !last.ev && Math.hypot(last.x - s.x, last.y - s.y) < 0.8 && s.d < 12) { last.d += s.d; return; }
      trk.push(s);
    }
    root.addEventListener('pointermove', e => sample(e));
    function takeTrack() { const t = trk, st = trkState; trk = []; trkState = null; return t.length ? { s: t, st } : null; }

    root.addEventListener('click', e => {
      if (!manual) return; const b = e.target.closest('[data-key]'); if (!b) return;
      const key = b.dataset.key;
      if ((key === 'act:undo' && !hist.length) || (key === 'act:redo' && !redoS.length)) return; // nada para desfazer/refazer
      sample(e, { ev: 'ui:' + key });
      if (key.startsWith('act:')) {
        const kind = key === 'act:undo' ? 'u' : key === 'act:redo' ? 'r' : 'd';
        press(key); const tr = takeTrack();
        if (onAction) onAction(Object.assign({ k: kind }, tr ? { tr } : {}));
        return;
      }
      press(key);
    });

    // desenho manual (gravador do ADM e modo sem roteiro)
    let stroke = null;
    const toC = e => { const r = canvas.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * canvas.width / r.width * 2) / 2, Math.round((e.clientY - r.top) * canvas.height / r.height * 2) / 2]; };
    canvas.addEventListener('pointerdown', e => {
      if (!manual) return;
      e.preventDefault();
      const [x, y] = toC(e), col = palette[state.color];
      if (state.tool === 'bucket') { sample(e, { ev: 'fill' }); const before = snap(); const n = floodFill(ctx, x, y, col, 0); if (n > 0) { hist.push(before); if (hist.length > 40) hist.shift(); redoS = []; syncUR(); } const tr = takeTrack(); if (n > 0 && onAction) onAction(Object.assign({ k: 'f', x, y, c: col, a: n }, tr ? { tr } : {})); return; }
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { }
      const dc = state.tool === 'eraser' ? '#ffffff' : col;
      pushHist();
      stroke = { tool: state.tool, c: col, s: state.size, p: [x, y], dc };
      sample(e, { ev: 'down', p: 1 });
      drawSeg(ctx, x, y, x, y, dc, SIZES[state.size]);
    });
    canvas.addEventListener('pointermove', e => {
      if (!stroke) return;
      const [x, y] = toC(e), p = stroke.p, lx = p[p.length - 2], ly = p[p.length - 1];
      if (Math.hypot(x - lx, y - ly) < 2) return;
      drawSeg(ctx, lx, ly, x, y, stroke.dc, SIZES[stroke.s]); p.push(x, y);
    });
    const end = () => { if (!stroke) return; const s = stroke; stroke = null; const tr = takeTrack(); if (onAction) onAction(Object.assign({ k: 's', tool: s.tool === 'eraser' ? 'eraser' : 'brush', c: s.c, s: s.s, p: s.p }, tr ? { tr } : {})); };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end); canvas.addEventListener('lostpointercapture', end);

    const LOOK = opts.customCursor
      ? { arrow: [CUSTOM_CURSOR_SVG, 4, 3], hand: [CUSTOM_HAND_SVG, 11, 3] }
      : { arrow: [CURSOR_SVG, 3, 2], hand: [GENERIC_HAND_SVG, 11, 3] };
    let look = 'arrow', hot = [LOOK.arrow[1], LOOK.arrow[2]];
    function overKey(x, y) { // o ponto está em cima de algum botão/cor?
      for (const el of root.querySelectorAll('[data-key]')) { const o = offsetIn(el); if (x >= o.x && x <= o.x + el.offsetWidth && y >= o.y && y <= o.y + el.offsetHeight) return true; }
      return false;
    }
    function setCursor(x, y, hand) {
      cur.x = x; cur.y = y;
      if (fake) { const want = (hand != null ? hand : overKey(x, y)) ? 'hand' : 'arrow'; if (want !== look) { look = want; curEl.innerHTML = LOOK[want][0]; hot = [LOOK[want][1], LOOK[want][2]]; } }
      curEl.style.transform = `translate(${x - hot[0]}px,${y - hot[1]}px)`; updateRing();
    }
    function uiPoint(key, R) {
      const el = root.querySelector(`[data-key="${key}"]`);
      if (!el) return null;
      const o = offsetIn(el), w = el.offsetWidth, h = el.offsetHeight; R = R || Math.random;
      return { x: o.x + w / 2 + (R() - 0.5) * w * 0.45, y: o.y + h / 2 + (R() - 0.5) * h * 0.45 };
    }
    // Ajusta o canvas ao espaço livre (proporção 8:5) vezes "scale"
    function layout(scale) {
      canvas.width = canvas.height = 10; canvas.style.width = canvas.style.height = '10px';
      root.style.removeProperty('--colw'); // mede com a coluna livre
      const c = $('.bd-center'), aw = c.clientWidth - 12, ah = c.clientHeight - 16;
      let w = Math.max(160, aw), h = w * 5 / 8;
      if (h > ah) { h = Math.max(100, ah); w = h * 8 / 5; }
      w = Math.round(w * (scale || 1)); h = Math.round(h * (scale || 1));
      canvas.width = w; canvas.height = h; canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      // coluna do meio = largura do quadro: topo, quadro e barra alinhados e o bloco todo centralizado
      const availW = c.clientWidth;
      root.style.setProperty('--colw', Math.min(availW, Math.round(Math.max(w, 620)) + 8) + 'px');
      // canvas pequeno: a barra de ferramentas não pode ficar espremida -> a coluna cresce até caber tudo
      const bar = $('.bd-bar');
      if (bar) {
        const cs = getComputedStyle(bar), kids = [...bar.children], gap = parseFloat(cs.columnGap) || 0;
        const need = kids.reduce((a, k) => a + k.offsetWidth, 0) + gap * Math.max(0, kids.length - 1) + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) * 2 + 12;
        if (need > bar.clientWidth) root.style.setProperty('--colw', Math.min(availW, Math.ceil(need)) + 'px');
      }
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); clearHist();
      return { w, h };
    }

    sync();
    return {
      root, canvas, ctx, palette, state, side: $('.bd-side-list'),
      tools: { bucket: tools.some(t => t[0] === 'bucket'), eraser: tools.some(t => t[0] === 'eraser') }, fixedSize,
      layout, origin,
      setHead(round, name) { $('.bd-round').textContent = round || ''; $('.bd-round').style.display = round ? '' : 'none'; $('.bd-name').textContent = name || ''; },
      setSub(t) { $('.bd-sub').textContent = t; },
      setChallenges(list) { $('.bd-chal').innerHTML = (list || []).map(t => `<span>${String(t).replace(/</g, '&lt;')}</span>`).join(''); },
      setTimer(t, frac, low) {
        $('.bd-time').textContent = t;
        $('.bd-clock .fg').setAttribute('stroke-dashoffset', String(213.6 * (1 - clamp(frac == null ? 1 : frac, 0, 1))));
        $('.bd-clock').classList.toggle('low', !!low);
      },
      clear() { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); clearHist(); },
      render(ver) { renderVersion(ctx, ver); clearHist(); },
      beginAction: pushHist,
      showDone(v) { const d = root.querySelector('.bd-done'); if (d) d.classList.toggle('hide', !v); },
      set onDone(f) { onDone = f; },
      resetState() { state.tool = 'brush'; state.size = fixedSize == null ? 1 : fixedSize; state.color = firstColor; sync(); },
      setManual(v) { manual = !!v; root.classList.toggle('manual', manual); if (!v) stroke = null; },
      showFake(v) { fake = !!v; curEl.style.display = v ? 'block' : 'none'; updateRing(); },
      setCursor, getCursor: () => ({ x: cur.x, y: cur.y }),
      press, uiPoint,
      keyRect(key) { const el = root.querySelector(`[data-key="${key}"]`); if (!el) return null; const o = offsetIn(el); return { x: o.x, y: o.y, w: el.offsetWidth, h: el.offsetHeight }; },
      size: () => ({ w: root.offsetWidth, h: root.offsetHeight }),
      setState(tool, size, color) { let ch = false; if (tool && state.tool !== tool && (tool === 'brush' || this.tools[tool])) { state.tool = tool; ch = true; } if (size != null && state.size !== size && fixedSize == null) { state.size = size; ch = true; } if (color != null && state.color !== color) { state.color = color; ch = true; } if (ch) sync(); },
      nearestColor(hex) { return nearestIdx(palette, hex); },
      clearTrack() { trk = []; trkState = null; },
      segStage(x1, y1, x2, y2) {
        const o = origin(), c = state.tool === 'eraser' ? '#ffffff' : palette[state.color];
        drawSeg(ctx, x1 - o.x, y1 - o.y, x2 - o.x, y2 - o.y, c, SIZES[state.size]);
      },
      fillStage(x, y, max) { const o = origin(), before = snap(); const n = floodFill(ctx, x - o.x, y - o.y, palette[state.color], max || 0); if (n > 0) { hist.push(before); redoS = []; syncUR(); } return n; },
      snapshot(w, h, q) {
        const o = document.createElement('canvas'); o.width = w || canvas.width; o.height = h || canvas.height;
        const x = o.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, o.width, o.height);
        // mantém a proporção do canvas (canvas pequeno aparece pequeno na revelação)
        const k = Math.min(o.width / canvas.width, o.height / canvas.height);
        x.drawImage(canvas, (o.width - canvas.width * k) / 2, (o.height - canvas.height * k) / 2, canvas.width * k, canvas.height * k);
        return o.toDataURL('image/jpeg', q || 0.8);
      },
      setRef(url, opacity, visible) {
        const im = $('.bd-ref');
        if (url !== undefined && url !== null && im.getAttribute('src') !== url) { if (url) im.src = url; else im.removeAttribute('src'); }
        if (opacity != null) im.style.opacity = opacity;
        im.style.display = visible && im.getAttribute('src') ? 'block' : 'none';
      },
      set onAction(f) { onAction = f; },
      destroy() { root.remove(); }
    };
  }

  /* ---------- roteiro: gera o caminho do cursor ---------- */
  function genOps(board, ver, q, seed, start) {
    const R = rng(seed);
    const bad = clamp((100 - q) / 100, 0, 1);
    const pal = board.palette, actions = (ver && ver.actions) || [];
    const cw0 = (ver && ver.cw) || BASE_W, ch0 = (ver && ver.ch) || BASE_H;
    const cw = board.canvas.width, ch = board.canvas.height, O = board.origin();
    const m = mapper(cw0, ch0, cw, ch);

    let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    const acc = (x, y) => { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; };
    for (const a of actions) {
      if (a.k === 's') { const p = a.p || []; for (let i = 0; i < p.length; i += 2) acc(p[i], p[i + 1]); }
      else if (a.k === 'f') acc(a.x, a.y);
    }
    if (minx > maxx) { minx = 0; maxx = cw0; miny = 0; maxy = ch0; }
    const cx0 = (minx + maxx) / 2, cy0 = (miny + maxy) / 2;

    // distorção global (quanto pior a qualidade, mais torto/deslocado)
    const u = cw0 / 800;
    const sc = 1 + (R() * 2 - 1) * bad * 0.22, rot = (R() * 2 - 1) * bad * 0.2;
    const tx = (R() * 2 - 1) * bad * 70 * u, ty = (R() * 2 - 1) * bad * 45 * u;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const T = (x, y) => {
      const dx = x - cx0, dy = y - cy0;
      const [X, Y] = m.f(cx0 + tx + (dx * cs - dy * sn) * sc, cy0 + ty + (dx * sn + dy * cs) * sc);
      return [clamp(X, 1, cw - 1) + O.x, clamp(Y, 1, ch - 1) + O.y];
    };

    const ops = [];
    let cur = { x: start.x, y: start.y };
    const st = { tool: board.state.tool, size: board.state.size, color: board.state.color };
    const seg = (x, y, pen, mul) => { const d = Math.hypot(x - cur.x, y - cur.y); ops.push({ t: 'm', sx: cur.x, sy: cur.y, x, y, pen, c: Math.max(0.01, d / mul) }); cur = { x, y }; };
    const wait = c => ops.push({ t: 'e', ev: { type: 'none' }, c });
    function travel(x, y) { // movimento "humano": curva leve, acelera no meio e freia no fim
      const dx = x - cur.x, dy = y - cur.y, d = Math.hypot(dx, dy);
      if (d < 1) return;
      const nx = -dy / d, ny = dx / d, off = (R() * 2 - 1) * d * 0.18;
      const mx = cur.x + dx * 0.5 + nx * off, my = cur.y + dy * 0.5 + ny * off;
      const sx = cur.x, sy = cur.y, n = Math.max(3, Math.ceil(d / 14));
      for (let i = 1; i <= n; i++) {
        const t = i / n, v = 1 - t;
        seg(v * v * sx + 2 * v * t * mx + t * t * x, v * v * sy + 2 * v * t * my + t * t * y, false, 1.8 * (0.35 + Math.sin(Math.PI * (t - 0.5 / n))));
      }
    }
    function ui(key) { const p = board.uiPoint(key, R); if (!p) return false; travel(p.x, p.y); ops.push({ t: 'e', ev: { type: 'ui', key }, c: 18 + R() * 28 }); return true; }
    function colorFor(hex) {
      const i = nearestIdx(pal, hex);
      if (!(q < 50 && R() < (50 - q) / 50 * 0.45)) return i;
      const cands = pal.map((c, j) => { const [r, g, b] = hexToRgb(c); return { j, d: dist2(c, pal[i]), light: r + g + b > 690 }; })
        .filter(o => o.j !== i && !o.light).sort((a, b) => a.d - b.d);
      return cands.length ? cands[Math.min(cands.length - 1, Math.floor(R() * 2))].j : i;
    }
    const sizeFor = s => board.fixedSize != null ? board.fixedSize : nearestSize((SIZES[s] || 7) * m.k);

    for (const a of actions) {
      if (a.k === 's') {
        const p = a.p || [];
        if (p.length < 2) continue;
        if (bad > 0.55 && p.length < 20 && R() < (bad - 0.55) * 1.2) continue; // "esqueceu" um detalhe
        const er = a.tool === 'eraser';
        if (er && !board.tools.eraser) continue;
        const tool = er ? 'eraser' : 'brush', sIdx = sizeFor(a.s);
        if (st.tool !== tool) { ui('tool:' + tool); st.tool = tool; }
        if (st.size !== sIdx) { if (ui('size:' + sIdx)) st.size = sIdx; }
        if (!er) { const ci = colorFor(a.c); if (st.color !== ci) { ui('color:' + ci); st.color = ci; } }
        const A = bad * 12 * u, f1 = (0.01 + R() * 0.012) / u, f2 = (0.03 + R() * 0.025) / u;
        const ph = [R() * 6.283, R() * 6.283, R() * 6.283, R() * 6.283];
        let s = 0, px = p[0], py = p[1];
        const pts = [];
        for (let i = 0; i < p.length; i += 2) {
          const x = p[i], y = p[i + 1];
          s += Math.hypot(x - px, y - py); px = x; py = y;
          pts.push(T(x + A * (Math.sin(s * f1 + ph[0]) + 0.5 * Math.sin(s * f2 + ph[1])), y + A * (Math.sin(s * f1 + ph[2]) + 0.5 * Math.sin(s * f2 + ph[3]))));
        }
        travel(pts[0][0], pts[0][1]);
        if (R() < 0.25) wait(8 + R() * 25);
        ops.push({ t: 'e', ev: { type: 'down' }, c: 5 + R() * 8 });
        const sp = 0.8 + R() * 0.3;
        for (let i = 1; i < pts.length; i++) seg(pts[i][0], pts[i][1], true, sp * (0.9 + R() * 0.2));
        wait(4 + R() * 10);
      } else if (a.k === 'f') {
        if (!board.tools.bucket) continue;
        if (st.tool !== 'bucket') { ui('tool:bucket'); st.tool = 'bucket'; }
        const ci = colorFor(a.c); if (st.color !== ci) { ui('color:' + ci); st.color = ci; }
        const [x, y] = T(a.x, a.y);
        travel(x, y);
        const area = (+a.a || 0) * m.k * m.k;
        ops.push({ t: 'e', ev: { type: 'fill', x, y, max: area ? Math.round(Math.max(area * 1.6, area + 4000)) : 0 }, c: 25 + R() * 25 });
      }
    }
    return ops;
  }

  // A versão tem o trajeto do mouse gravado? (todas as ações com "tr")
  function hasTrack(ver) { const a = (ver && ver.actions) || []; return a.length > 0 && a.every(x => x.tr && asArray(x.tr.s).length); }

  // Reproduz exatamente o caminho que o ADM fez (posições + ritmo), adaptado ao layout do jogador.
  // Custo de cada passo = milissegundos gravados (pausas longas são encurtadas).
  function genTrackOps(board, ver, q, seed, start) {
    const R = rng(seed), bad = clamp((100 - q) / 100, 0, 1);
    const cw0 = ver.cw || BASE_W, ch0 = ver.ch || BASE_H, cw = board.canvas.width, ch = board.canvas.height, O = board.origin();
    const m = mapper(cw0, ch0, cw, ch), S = board.size();
    // distorção opcional (qualidade < 100)
    const u = cw0 / 800, sc = 1 + (R() * 2 - 1) * bad * 0.22, rot = (R() * 2 - 1) * bad * 0.2;
    const tx = (R() * 2 - 1) * bad * 70 * u, ty = (R() * 2 - 1) * bad * 45 * u, cs = Math.cos(rot), sn = Math.sin(rot);
    const A = bad * 12 * u, f1 = 0.011 / u, f2 = 0.04 / u, ph = R() * 6.28;
    const cx0 = cw0 / 2, cy0 = ch0 / 2;
    const T = (x, y, s) => {
      if (bad > 0) { x += A * Math.sin(s * f1 + ph) + A * 0.5 * Math.sin(s * f2); y += A * Math.cos(s * f1 + ph * 1.3) + A * 0.5 * Math.sin(s * f2 + 1); const dx = x - cx0, dy = y - cy0; x = cx0 + tx + (dx * cs - dy * sn) * sc; y = cy0 + ty + (dx * sn + dy * cs) * sc; }
      const [X, Y] = m.f(x, y); return [clamp(X, 0, cw - 0.5) + O.x, clamp(Y, 0, ch - 0.5) + O.y];
    };
    // junta as amostras de todas as ações
    const S0 = [], acts = [];
    ver.actions.forEach((a, ai) => {
      const ss = asArray(a.tr.s);
      ss.forEach((s, i) => S0.push(Object.assign({ ai, first: i === 0, st: i === 0 ? a.tr.st : null }, s)));
      acts.push(a);
    });
    // posição no layout do jogador: âncoras (canvas / botão) e pontos livres interpolados
    let dist = 0, px = null, py = null;
    const pts = S0.map(s => {
      if (px != null) dist += Math.hypot(s.x - px, s.y - py); px = s.x; py = s.y;
      if (s.c) { const c = asArray(s.c); return T(c[0], c[1], dist); }
      if (s.k) { const r = board.keyRect(s.k); if (r) { const f = asArray(s.f); return [r.x + f[0] * r.w, r.y + f[1] * r.h]; } }
      return null;
    });
    const anchorIdx = pts.map((p, i) => p ? i : -1).filter(i => i >= 0);
    for (let i = 0, ai = 0; i < pts.length; i++) {
      if (pts[i]) continue;
      while (ai < anchorIdx.length && anchorIdx[ai] < i) ai++;
      const a = anchorIdx[ai - 1], b = anchorIdx[ai];
      const dA = a != null ? [pts[a][0] - S0[a].x, pts[a][1] - S0[a].y] : null, dB = b != null ? [pts[b][0] - S0[b].x, pts[b][1] - S0[b].y] : null;
      let d = dA || dB || [0, 0];
      if (dA && dB) { const k = (i - a) / (b - a); d = [dA[0] + (dB[0] - dA[0]) * k, dA[1] + (dB[1] - dA[1]) * k]; }
      pts[i] = [clamp(S0[i].x + d[0], 2, S.w - 2), clamp(S0[i].y + d[1], 2, S.h - 2)];
    }
    // monta as operações
    const ops = []; let cur = { x: start.x, y: start.y };
    const mv = (x, y, pen, c) => { ops.push({ t: 'm', sx: cur.x, sy: cur.y, x, y, pen, c: Math.max(0.01, c) }); cur = { x, y }; };
    if (pts.length) { // aproximação inicial suave até o primeiro ponto
      const [x, y] = pts[0], d = Math.hypot(x - cur.x, y - cur.y), n = Math.max(2, Math.ceil(d / 25)), sx = cur.x, sy = cur.y;
      for (let i = 1; i <= n; i++) { const t = i / n, e2 = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; mv(sx + (x - sx) * e2, sy + (y - sy) * e2, false, Math.min(600, d * 0.9) / n); }
      ops.napp = ops.length; ops.target = { x, y };
    }
    let pen = false;
    S0.forEach((s, i) => {
      const [x, y] = pts[i], a = acts[s.ai];
      const dt = Math.min(s.d || 0, 260); // pausas muito longas ficam mais curtas
      const ev = s.ev || '';
      if (ev.startsWith('ui:')) { mv(x, y, false, dt); pen = false; ops.push({ t: 'e', ev: { type: 'ui', key: ev.slice(3) }, c: 0.01 }); return; }
      if (ev === 'down') {
        mv(x, y, false, dt);
        const tool = a.tool === 'eraser' ? 'eraser' : 'brush';
        ops.push({ t: 'e', ev: { type: 'force', tool, size: clamp(a.s | 0, 0, SIZES.length - 1), color: a.tool === 'eraser' ? null : board.nearestColor(a.c) }, c: 0.01 });
        ops.push({ t: 'e', ev: { type: 'down' }, c: 0.01 }); pen = true; return;
      }
      if (ev === 'fill') {
        mv(x, y, false, dt);
        ops.push({ t: 'e', ev: { type: 'force', tool: 'bucket', color: board.nearestColor(a.c) }, c: 0.01 });
        const area = (+a.a || 0) * m.k * m.k;
        ops.push({ t: 'e', ev: { type: 'fill', x, y, max: area ? Math.round(Math.max(area * 1.6, area + 4000)) : 0 }, c: 0.01 }); pen = false; return;
      }
      const p = pen && !!s.p; if (!s.p) pen = false;
      mv(x, y, p, dt);
    });
    return ops;
  }

  function createRunner(board, ver, o) {
    o = o || {};
    const start = o.start || board.getCursor();
    const track = hasTrack(ver);
    const ops = track ? genTrackOps(board, ver, o.q == null ? 100 : +o.q, o.seed || 'x', start) : genOps(board, ver, o.q == null ? 100 : +o.q, o.seed || 'x', start);
    let total = 0; for (const op of ops) total += op.c;
    let idx = 0, frac = 0, spent = 0, cx = start.x, cy = start.y;
    board.setCursor(cx, cy);
    function moveTo(x, y, pen) { if (pen) board.segStage(cx, cy, x, y); cx = x; cy = y; }
    function applyEv(ev) {
      if (ev.type === 'ui') board.press(ev.key);
      else if (ev.type === 'down') { board.beginAction(); board.segStage(cx, cy, cx, cy); }
      else if (ev.type === 'fill') board.fillStage(ev.x, ev.y, ev.max);
      else if (ev.type === 'force') board.setState(ev.tool, ev.size, ev.color); // garante ferramenta/cor certas do traço
    }
    function step(budget) {
      while (budget > 0 && idx < ops.length) {
        const op = ops[idx];
        if (op.t === 'e' && !op.done) { op.done = true; applyEv(op.ev); }
        const rem = op.c * (1 - frac);
        if (budget >= rem) { budget -= rem; spent += rem; if (op.t === 'm') moveTo(op.x, op.y, op.pen); idx++; frac = 0; }
        else { frac += budget / op.c; spent += budget; if (op.t === 'm') moveTo(op.sx + (op.x - op.sx) * frac, op.sy + (op.y - op.sy) * frac, op.pen); budget = 0; }
      }
      board.setCursor(cx, cy);
    }
    return {
      step, finish() { step(Infinity); },
      get done() { return idx >= ops.length; },
      progress() { return total ? Math.min(1, spent / total) : 1; },
      pos() { return { x: cx, y: cy }; },
      setPos(x, y) { cx = x; cy = y; board.setCursor(x, y); },
      target: ops.target || null,
      // pula a aproximação inicial (o mouse já foi sozinho até o ponto de partida)
      skipApproach() { if (!ops.target || idx > 0) return; for (let i = 0; i < ops.napp; i++) spent += ops[i].c; idx = ops.napp; frac = 0; cx = ops.target.x; cy = ops.target.y; board.setCursor(cx, cy); },
      unit: track ? 'ms' : 'px',
      total
    };
  }

  global.Engine = {
    SIZES, SIZE_NAMES, DEFAULT_PALETTE, BASE_W, BASE_H,
    CUSTOM_CURSOR_SVG, CUSTOM_CURSOR_CSS, CUSTOM_HAND_CSS, CUSTOM_WAIT_CSS, CUSTOM_TEXT_CSS,
    applyCursorVars(el) { el.style.setProperty('--cc', CUSTOM_CURSOR_CSS); el.style.setProperty('--cc-hand', CUSTOM_HAND_CSS); el.style.setProperty('--cc-wait', CUSTOM_WAIT_CSS); el.style.setProperty('--cc-text', CUSTOM_TEXT_CSS); },
    createBoard, createRunner, genOps, genTrackOps, hasTrack, renderVersion, renderToDataURL, rescaleVersion, normVersion, versionsOf,
    challengeOf, challengeChips, announceText, introPlan, floodFill, rng, clamp, asArray
  };
})(window);
