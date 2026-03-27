/**
 * Same — Two-click block puzzle
 * 1st click: select group | 2nd click: remove | Score: (n-1)²
 */
(function () {
    'use strict';

    const CFG = { cols: 15, rows: 10, numColors: 4, sound: true, gap: 1, removeDur: 220, settleDur: 8 };

    const COLORS = [
        { base: '#e74c3c', hi: '#f1948a' },
        { base: '#2ecc71', hi: '#82e0aa' },
        { base: '#3498db', hi: '#85c1e9' },
        { base: '#f1c40f', hi: '#f9e154' },
        { base: '#9b59b6', hi: '#c39bd3' },
    ];

    let grid, score, highScore = +(localStorage.getItem('same_hi') || 0);
    let selected = [], hovered = [], removing = [];
    let animating = false, over = false, blinkOn = true, blinkTimer = null;
    let undoSnap = null, audioCtx = null;
    let cvs, ctx, bsz = 40, bw, bh;

    const $ = id => document.getElementById(id);
    const scoreEl = $('score-display'), remainEl = $('remaining-display'), hiEl = $('highscore-display');
    const infoBar = $('info-bar'), infoText = $('info-text');
    const overlayGO = $('overlay-gameover'), overlayST = $('overlay-settings');
    const finalScore = $('final-score'), finalRemain = $('final-remaining');
    const finalBonus = $('final-bonus'), bonusStat = $('bonus-stat'), finalMsg = $('final-message');
    const undoBtn = $('btn-undo');

    // Audio
    function initAudio() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }

    function beep(freq, dur, type = 'sine', vol = 0.08) {
        if (!CFG.sound || !audioCtx) return;
        try {
            const t = audioCtx.currentTime, o = audioCtx.createOscillator(), g = audioCtx.createGain();
            o.connect(g); g.connect(audioCtx.destination);
            o.type = type; o.frequency.setValueAtTime(freq, t);
            g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
            o.start(t); o.stop(t + dur);
        } catch (_) {}
    }

    function sfx(name) {
        if (!CFG.sound || !audioCtx) return;
        const t = audioCtx.currentTime;
        if (name === 'sel') { beep(520, 0.08); return; }
        if (name === 'end') { beep(350, 0.5, 'triangle'); return; }
        if (name === 'win') { [523,659,784,1047].forEach((f,i) => setTimeout(() => beep(f, 0.25), i*100)); return; }
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.connect(g); g.connect(audioCtx.destination);
        if (name === 'pop') {
            o.type = 'sine'; o.frequency.setValueAtTime(700, t);
            o.frequency.exponentialRampToValueAtTime(350, t + 0.18);
            g.gain.setValueAtTime(0.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
            o.start(t); o.stop(t + 0.25);
        } else {
            o.type = 'triangle'; o.frequency.setValueAtTime(500, t);
            o.frequency.exponentialRampToValueAtTime(900, t + 0.12);
            o.frequency.exponentialRampToValueAtTime(400, t + 0.35);
            g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
            o.start(t); o.stop(t + 0.4);
        }
    }

    // Grid
    function makeGrid() {
        grid = Array.from({ length: CFG.cols }, () =>
            Array.from({ length: CFG.rows }, () => Math.floor(Math.random() * CFG.numColors) + 1)
        );
    }

    function cloneGrid() { return grid.map(c => [...c]); }

    function remaining() {
        let n = 0;
        for (let c = 0; c < CFG.cols; c++) for (let r = 0; r < CFG.rows; r++) if (grid[c][r]) n++;
        return n;
    }

    function flood(col, row) {
        if (col < 0 || col >= CFG.cols || row < 0 || row >= CFG.rows || !grid[col][row]) return [];
        const color = grid[col][row], seen = new Set(), grp = [], stk = [{ c: col, r: row }];
        while (stk.length) {
            const { c, r } = stk.pop(), k = c * 10000 + r;
            if (seen.has(k) || c < 0 || c >= CFG.cols || r < 0 || r >= CFG.rows || grid[c][r] !== color) continue;
            seen.add(k); grp.push({ c, r });
            stk.push({ c: c-1, r }, { c: c+1, r }, { c, r: r-1 }, { c, r: r+1 });
        }
        return grp.length >= 2 ? grp : [];
    }

    function removeGrp(grp) { for (const { c, r } of grp) grid[c][r] = 0; }

    function gravity() {
        for (let c = 0; c < CFG.cols; c++) {
            let w = CFG.rows - 1;
            for (let r = CFG.rows - 1; r >= 0; r--)
                if (grid[c][r]) { if (w !== r) { grid[c][w] = grid[c][r]; grid[c][r] = 0; } w--; }
        }
    }

    function collapse() {
        let w = 0;
        for (let c = 0; c < CFG.cols; c++)
            if (grid[c][CFG.rows - 1]) {
                if (w !== c) { for (let r = 0; r < CFG.rows; r++) { grid[w][r] = grid[c][r]; grid[c][r] = 0; } }
                w++;
            }
    }

    function hasMove() {
        for (let c = 0; c < CFG.cols; c++) for (let r = 0; r < CFG.rows; r++) {
            if (!grid[c][r]) continue;
            const v = grid[c][r];
            if ((c+1 < CFG.cols && grid[c+1][r] === v) || (r+1 < CFG.rows && grid[c][r+1] === v)) return true;
        }
        return false;
    }

    function pts(n) { return (n - 1) * (n - 1); }

    // Render
    function resize() {
        const area = $('game-area'), aw = area.clientWidth - 32, ah = area.clientHeight - 32;
        bsz = Math.max(Math.min(Math.floor(aw / CFG.cols), Math.floor(ah / CFG.rows), 52), 18);
        bw = CFG.cols * bsz; bh = CFG.rows * bsz;
        const dpr = devicePixelRatio || 1;
        cvs.width = bw * dpr; cvs.height = bh * dpr;
        cvs.style.width = bw + 'px'; cvs.style.height = bh + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw();
    }

    function draw() {
        ctx.fillStyle = '#101014';
        ctx.fillRect(0, 0, bw, bh);

        const selSet = new Set(selected.map(p => p.c * 10000 + p.r));
        const hovSet = new Set(hovered.map(p => p.c * 10000 + p.r));
        const remSet = new Set(removing.map(p => p.c * 10000 + p.r));
        const g = CFG.gap, bs = bsz - g * 2;

        for (let c = 0; c < CFG.cols; c++) {
            for (let r = 0; r < CFG.rows; r++) {
                const v = grid[c][r];
                if (!v || remSet.has(c * 10000 + r)) continue;
                const x = c * bsz + g, y = r * bsz + g, col = COLORS[v - 1];
                const k = c * 10000 + r, isSel = selSet.has(k), isHov = hovSet.has(k) && !isSel;
                drawBlock(x, y, bs, bs, col, isSel && !blinkOn ? 'dim' : isHov || isSel ? 'hi' : 'base', isSel && blinkOn);
            }
        }

        for (const b of removing) {
            const col = COLORS[b.color - 1], x = b.c * bsz + g, y = b.r * bsz + g;
            const s = 1 - b.prog * 0.4, cx = b.c * bsz + bsz / 2, cy = b.r * bsz + bsz / 2;
            ctx.save();
            ctx.globalAlpha = 1 - b.prog;
            ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy);
            drawBlock(x, y, bs, bs, col, 'base', false);
            ctx.restore();
        }
    }

    function drawBlock(x, y, w, h, col, mode, border) {
        if (mode === 'dim') {
            ctx.globalAlpha = 0.35; ctx.fillStyle = col.hi; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
            return;
        }
        ctx.fillStyle = mode === 'hi' ? col.hi : col.base;
        ctx.fillRect(x, y, w, h);
        if (border) {
            ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5;
            ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
        }
    }

    // Blink
    function startBlink() { stopBlink(); blinkOn = true; blinkTimer = setInterval(() => { blinkOn = !blinkOn; draw(); }, 400); }
    function stopBlink() { clearInterval(blinkTimer); blinkTimer = null; blinkOn = true; }

    // Animations
    function animRemove(grp, color, cb) {
        animating = true;
        removing = grp.map(p => ({ c: p.c, r: p.r, prog: 0, color }));
        const t0 = performance.now();
        (function step(t) {
            const p = Math.min((t - t0) / CFG.removeDur, 1);
            removing.forEach(b => b.prog = p); draw();
            p < 1 ? requestAnimationFrame(step) : (removing = [], cb());
        })(t0);
    }

    function animSettle(cb) {
        let f = 0;
        (function tick() { ++f < CFG.settleDur ? (draw(), requestAnimationFrame(tick)) : cb(); })();
    }

    // Click logic
    function sameGroup(a, b) {
        if (a.length !== b.length || !a.length) return false;
        const s = new Set(a.map(p => p.c * 10000 + p.r));
        return b.every(p => s.has(p.c * 10000 + p.r));
    }

    function onClick(e) {
        if (animating || over) return;
        initAudio();
        const rect = cvs.getBoundingClientRect();
        const col = Math.floor((e.clientX - rect.left) / bsz);
        const row = Math.floor((e.clientY - rect.top) / bsz);
        if (col < 0 || col >= CFG.cols || row < 0 || row >= CFG.rows) return;
        const grp = flood(col, row);

        if (grp.length < 2) {
            if (selected.length) { selected = []; stopBlink(); setInfo('Aynı renkli blok grubuna tıkla'); draw(); }
            return;
        }

        if (selected.length && sameGroup(grp, selected)) {
            stopBlink();
            const p = pts(selected.length), ci = grid[selected[0].c][selected[0].r];
            undoSnap = { grid: cloneGrid(), score }; undoBtn.disabled = false;
            sfx(selected.length >= 8 ? 'big' : 'pop');
            floatScore(col, row, p);
            const toRemove = [...selected]; selected = []; hovered = [];
            animRemove(toRemove, ci, () => {
                removeGrp(toRemove); score += p; gravity(); collapse();
                animSettle(() => { animating = false; updateUI(); setInfo('Aynı renkli blok grubuna tıkla'); draw(); if (!hasMove()) endGame(); });
            });
            return;
        }

        selected = grp;
        sfx('sel');
        setInfo(`${grp.length} blok seçili · tekrar tıkla → +${pts(grp.length)} puan`, true);
        startBlink(); draw();
    }

    function onMove(e) {
        if (animating || over) return;
        const rect = cvs.getBoundingClientRect();
        const col = Math.floor((e.clientX - rect.left) / bsz);
        const row = Math.floor((e.clientY - rect.top) / bsz);
        if (col < 0 || col >= CFG.cols || row < 0 || row >= CFG.rows) { if (hovered.length) { hovered = []; draw(); } return; }
        const grp = flood(col, row);
        if (selected.length && sameGroup(grp, selected)) { if (hovered.length) { hovered = []; draw(); } return; }
        if (sameGroup(grp, hovered)) return;
        hovered = grp;
        if (!selected.length) setInfo(grp.length >= 2 ? `${grp.length} blok · +${pts(grp.length)} puan` : 'Aynı renkli blok grubuna tıkla');
        draw();
    }

    function onLeave() { if (hovered.length) { hovered = []; if (!selected.length) setInfo('Aynı renkli blok grubuna tıkla'); draw(); } }

    // UI
    function setInfo(text, hl = false) { infoText.textContent = text; infoBar.classList.toggle('highlight', hl); }

    function updateUI() {
        scoreEl.textContent = score; remainEl.textContent = remaining(); hiEl.textContent = highScore;
        scoreEl.classList.remove('pop'); void scoreEl.offsetWidth; scoreEl.classList.add('pop');
    }

    function floatScore(col, row, p) {
        const rect = cvs.getBoundingClientRect(), el = document.createElement('div');
        el.className = 'float-score'; el.textContent = '+' + p;
        el.style.cssText = `left:${rect.left + col * bsz + bsz / 2}px;top:${rect.top + row * bsz}px;transform:translateX(-50%)`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 800);
    }

    // Game flow
    function endGame() {
        over = true;
        const rem = remaining();
        let bonus = 0;
        if (rem === 0) { bonus = 1000; score += bonus; sfx('win'); } else sfx('end');
        if (score > highScore) { highScore = score; localStorage.setItem('same_hi', highScore); }
        updateUI();
        setTimeout(() => {
            finalScore.textContent = score; finalRemain.textContent = rem;
            bonusStat.style.display = rem === 0 ? '' : 'none';
            if (rem === 0) { finalBonus.textContent = '+1000'; finalMsg.textContent = 'Mükemmel! Tüm blokları temizledin!'; }
            else if (rem <= 5) finalMsg.textContent = 'Harika! Neredeyse hepsini temizledin!';
            else finalMsg.textContent = 'Daha büyük grupları hedefle.';
            overlayGO.classList.remove('hidden');
        }, 400);
    }

    function newGame() {
        score = 0; over = false; selected = []; hovered = []; removing = [];
        animating = false; undoSnap = null; undoBtn.disabled = true;
        stopBlink(); overlayGO.classList.add('hidden'); overlayST.classList.add('hidden');
        setInfo('Aynı renkli blok grubuna tıkla');
        makeGrid(); updateUI(); resize();
    }

    function undo() {
        if (!undoSnap || animating || over) return;
        grid = undoSnap.grid; score = undoSnap.score;
        selected = []; hovered = []; stopBlink();
        undoSnap = null; undoBtn.disabled = true;
        setInfo('Geri alındı'); updateUI(); draw();
    }

    // Settings
    function initSettings() {
        const optSize = $('opt-size'), optColors = $('opt-colors'), optSound = $('opt-sound');
        [optSize, optColors, optSound].forEach(el => el.addEventListener('click', e => {
            const btn = e.target.closest('.pill');
            if (!btn) return;
            el.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        }));
        $('btn-settings').addEventListener('click', () => overlayST.classList.remove('hidden'));
        $('btn-settings-cancel').addEventListener('click', () => overlayST.classList.add('hidden'));
        $('btn-settings-apply').addEventListener('click', () => {
            const sz = optSize.querySelector('.active'), cl = optColors.querySelector('.active'), sn = optSound.querySelector('.active');
            if (sz) { CFG.cols = +sz.dataset.cols; CFG.rows = +sz.dataset.rows; }
            if (cl) CFG.numColors = +cl.dataset.colors;
            if (sn) CFG.sound = sn.dataset.sound === 'on';
            initAudio(); newGame();
        });
        overlayST.addEventListener('click', e => { if (e.target === overlayST) overlayST.classList.add('hidden'); });
    }

    // Init
    function init() {
        cvs = $('game-canvas'); ctx = cvs.getContext('2d');
        cvs.addEventListener('mousemove', onMove);
        cvs.addEventListener('mouseleave', onLeave);
        cvs.addEventListener('click', onClick);
        cvs.addEventListener('touchstart', e => { e.preventDefault(); onClick(new MouseEvent('click', { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY })); }, { passive: false });
        $('btn-new-game').addEventListener('click', () => { initAudio(); newGame(); });
        $('btn-play-again').addEventListener('click', () => { initAudio(); newGame(); });
        undoBtn.addEventListener('click', undo);
        overlayGO.addEventListener('click', e => { if (e.target === overlayGO) newGame(); });
        initSettings();
        window.addEventListener('resize', resize);
        document.addEventListener('keydown', e => {
            if (e.key === 'F2') { e.preventDefault(); initAudio(); newGame(); }
            if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
            if (e.key === 'Escape') { overlayST.classList.add('hidden'); overlayGO.classList.add('hidden'); if (selected.length) { selected = []; stopBlink(); setInfo('Aynı renkli blok grubuna tıkla'); draw(); } }
        });
        newGame();
    }

    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
