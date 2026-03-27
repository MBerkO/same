/**
 * SAME — Modern Minimalist Edition
 * ==================================
 * Two-click mechanic:
 *   1st click → select group (blinks)
 *   2nd click → remove group
 *   Click elsewhere → deselect
 *
 * Scoring: (n-1)²
 * Bonus: +1000 for clearing the board
 */

(function () {
    'use strict';

    // ===== Config =====
    const CFG = {
        cols: 15,
        rows: 10,
        numColors: 4,
        sound: true,
        pad: 2,
        removeDur: 220,
        settleDur: 8,
    };

    // Soft vibrant palette
    const COLORS = [
        { base: '#ef6461', hi: '#f7908e', lo: '#c04040', glow: 'rgba(239,100,97,0.3)' },
        { base: '#3dc1d3', hi: '#6dd6e3', lo: '#2a949f', glow: 'rgba(61,193,211,0.3)' },
        { base: '#7c6aef', hi: '#a298f4', lo: '#5c4cc0', glow: 'rgba(124,106,239,0.3)' },
        { base: '#f7c948', hi: '#f9d97a', lo: '#c9a030', glow: 'rgba(247,201,72,0.3)' },
        { base: '#e76f9a', hi: '#ee98b6', lo: '#b8507a', glow: 'rgba(231,111,154,0.3)' },
    ];

    // ===== State =====
    let grid = [];
    let score = 0;
    let highScore = +(localStorage.getItem('same_hi') || 0);
    let selected = [];
    let hovered = [];
    let animating = false;
    let over = false;
    let blinkOn = true;
    let blinkTimer = null;
    let removing = [];
    let undoSnap = null;
    let audioCtx = null;

    // Canvas
    let cvs, ctx, bsz = 40, bw, bh;

    // DOM
    const $ = id => document.getElementById(id);
    const scoreEl = $('score-display');
    const remainEl = $('remaining-display');
    const hiEl = $('highscore-display');
    const infoBar = $('info-bar');
    const infoText = $('info-text');
    const overlayGO = $('overlay-gameover');
    const overlayST = $('overlay-settings');
    const finalScore = $('final-score');
    const finalRemain = $('final-remaining');
    const finalBonus = $('final-bonus');
    const bonusStat = $('bonus-stat');
    const finalMsg = $('final-message');
    const undoBtn = $('btn-undo');

    // ===== Audio =====
    function initAudio() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    function beep(freq, dur, type = 'sine', vol = 0.08) {
        if (!CFG.sound || !audioCtx) return;
        try {
            const t = audioCtx.currentTime;
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.connect(g); g.connect(audioCtx.destination);
            o.type = type;
            o.frequency.setValueAtTime(freq, t);
            g.gain.setValueAtTime(vol, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + dur);
            o.start(t); o.stop(t + dur);
        } catch (e) {}
    }

    function sfx(name) {
        if (!CFG.sound || !audioCtx) return;
        const t = audioCtx.currentTime;
        switch (name) {
            case 'sel':
                beep(520, 0.08);
                break;
            case 'pop': {
                const o = audioCtx.createOscillator();
                const g = audioCtx.createGain();
                o.connect(g); g.connect(audioCtx.destination);
                o.type = 'sine';
                o.frequency.setValueAtTime(700, t);
                o.frequency.exponentialRampToValueAtTime(350, t + 0.18);
                g.gain.setValueAtTime(0.1, t);
                g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
                o.start(t); o.stop(t + 0.25);
                break;
            }
            case 'big': {
                const o = audioCtx.createOscillator();
                const g = audioCtx.createGain();
                o.connect(g); g.connect(audioCtx.destination);
                o.type = 'triangle';
                o.frequency.setValueAtTime(500, t);
                o.frequency.exponentialRampToValueAtTime(900, t + 0.12);
                o.frequency.exponentialRampToValueAtTime(400, t + 0.35);
                g.gain.setValueAtTime(0.12, t);
                g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
                o.start(t); o.stop(t + 0.4);
                break;
            }
            case 'end':
                beep(350, 0.5, 'triangle', 0.08);
                break;
            case 'win':
                [523,659,784,1047].forEach((f,i) => {
                    setTimeout(() => beep(f, 0.25, 'sine', 0.08), i * 100);
                });
                break;
        }
    }

    // ===== Grid =====
    function makeGrid() {
        grid = [];
        for (let c = 0; c < CFG.cols; c++) {
            grid[c] = [];
            for (let r = 0; r < CFG.rows; r++)
                grid[c][r] = Math.floor(Math.random() * CFG.numColors) + 1;
        }
    }

    function cloneGrid() { return grid.map(c => [...c]); }

    function remaining() {
        let n = 0;
        for (let c = 0; c < CFG.cols; c++)
            for (let r = 0; r < CFG.rows; r++)
                if (grid[c][r]) n++;
        return n;
    }

    function flood(col, row) {
        if (col < 0 || col >= CFG.cols || row < 0 || row >= CFG.rows) return [];
        const color = grid[col][row];
        if (!color) return [];
        const seen = new Set(), grp = [], stk = [{c:col,r:row}];
        while (stk.length) {
            const {c,r} = stk.pop();
            const k = c * 10000 + r;
            if (seen.has(k)) continue;
            if (c < 0 || c >= CFG.cols || r < 0 || r >= CFG.rows) continue;
            if (grid[c][r] !== color) continue;
            seen.add(k);
            grp.push({c,r});
            stk.push({c:c-1,r},{c:c+1,r},{c,r:r-1},{c,r:r+1});
        }
        return grp.length >= 2 ? grp : [];
    }

    function removeGrp(grp) {
        for (const {c,r} of grp) grid[c][r] = 0;
    }

    function gravity() {
        for (let c = 0; c < CFG.cols; c++) {
            let w = CFG.rows - 1;
            for (let r = CFG.rows - 1; r >= 0; r--) {
                if (grid[c][r]) {
                    if (w !== r) { grid[c][w] = grid[c][r]; grid[c][r] = 0; }
                    w--;
                }
            }
        }
    }

    function collapse() {
        let w = 0;
        for (let c = 0; c < CFG.cols; c++) {
            if (grid[c][CFG.rows - 1]) {
                if (w !== c) {
                    for (let r = 0; r < CFG.rows; r++) { grid[w][r] = grid[c][r]; grid[c][r] = 0; }
                }
                w++;
            }
        }
    }

    function hasMove() {
        for (let c = 0; c < CFG.cols; c++)
            for (let r = 0; r < CFG.rows; r++) {
                if (!grid[c][r]) continue;
                const v = grid[c][r];
                if (c+1 < CFG.cols && grid[c+1][r] === v) return true;
                if (r+1 < CFG.rows && grid[c][r+1] === v) return true;
            }
        return false;
    }

    function pts(n) { return (n-1)*(n-1); }

    // ===== Render =====
    function resize() {
        const area = $('game-area');
        const aw = area.clientWidth - 32;
        const ah = area.clientHeight - 32;
        bsz = Math.min(Math.floor(aw / CFG.cols), Math.floor(ah / CFG.rows), 52);
        bsz = Math.max(bsz, 18);
        bw = CFG.cols * bsz;
        bh = CFG.rows * bsz;
        const dpr = devicePixelRatio || 1;
        cvs.width = bw * dpr;
        cvs.height = bh * dpr;
        cvs.style.width = bw + 'px';
        cvs.style.height = bh + 'px';
        ctx.setTransform(dpr,0,0,dpr,0,0);
        draw();
    }

    function draw() {
        ctx.clearRect(0, 0, bw, bh);

        // Board bg
        ctx.fillStyle = '#0f0f16';
        roundRect(0, 0, bw, bh, 10);
        ctx.fill();

        const selSet = new Set(selected.map(p => p.c*10000+p.r));
        const hovSet = new Set(hovered.map(p => p.c*10000+p.r));
        const remSet = new Set(removing.map(p => p.c*10000+p.r));

        for (let c = 0; c < CFG.cols; c++) {
            for (let r = 0; r < CFG.rows; r++) {
                const v = grid[c][r];
                if (!v || remSet.has(c*10000+r)) continue;
                const x = c*bsz, y = r*bsz, p = CFG.pad;
                const col = COLORS[v-1];
                const isSel = selSet.has(c*10000+r);
                const isHov = hovSet.has(c*10000+r) && !isSel;

                if (isSel && !blinkOn) {
                    // Blink off: dim block
                    drawBlock(x+p, y+p, bsz-p*2, bsz-p*2, col, 'dim');
                } else if (isHov) {
                    drawBlock(x+p, y+p, bsz-p*2, bsz-p*2, col, 'hover');
                } else if (isSel) {
                    drawBlock(x+p, y+p, bsz-p*2, bsz-p*2, col, 'selected');
                } else {
                    drawBlock(x+p, y+p, bsz-p*2, bsz-p*2, col, 'normal');
                }
            }
        }

        // Removing
        for (const b of removing) {
            const col = COLORS[b.color-1];
            const x = b.c*bsz, y = b.r*bsz, p = CFG.pad;
            const s = 1 - b.prog * 0.4;
            const a = 1 - b.prog;
            ctx.save();
            ctx.globalAlpha = a;
            const cx = x+bsz/2, cy = y+bsz/2;
            ctx.translate(cx,cy);
            ctx.scale(s,s);
            ctx.translate(-cx,-cy);
            drawBlock(x+p, y+p, bsz-p*2, bsz-p*2, col, 'normal');
            ctx.restore();
        }
    }

    function drawBlock(x, y, w, h, col, state) {
        const rad = Math.max(3, w * 0.12);

        if (state === 'dim') {
            // Pale blink state
            ctx.fillStyle = col.hi;
            ctx.globalAlpha = 0.45;
            roundRect(x, y, w, h, rad);
            ctx.fill();
            ctx.globalAlpha = 1;
            return;
        }

        // Glow for hover / selected
        if (state === 'hover' || state === 'selected') {
            ctx.save();
            ctx.shadowColor = col.glow;
            ctx.shadowBlur = state === 'selected' ? 18 : 12;
            ctx.fillStyle = col.glow;
            roundRect(x, y, w, h, rad);
            ctx.fill();
            ctx.restore();
        }

        // Body gradient
        const g = ctx.createLinearGradient(x, y, x, y+h);
        if (state === 'hover' || state === 'selected') {
            g.addColorStop(0, col.hi);
            g.addColorStop(1, col.base);
        } else {
            g.addColorStop(0, col.base);
            g.addColorStop(1, col.lo);
        }
        ctx.fillStyle = g;
        roundRect(x, y, w, h, rad);
        ctx.fill();

        // Top shine
        const sh = h * 0.3;
        const sg = ctx.createLinearGradient(x, y, x, y+sh);
        sg.addColorStop(0, 'rgba(255,255,255,0.22)');
        sg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sg;
        roundRect(x+1, y+1, w-2, sh, rad);
        ctx.fill();

        // Border
        if (state === 'selected') {
            ctx.strokeStyle = 'rgba(255,255,255,0.4)';
            ctx.lineWidth = 1.5;
        } else {
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 0.5;
        }
        roundRect(x, y, w, h, rad);
        ctx.stroke();
    }

    function roundRect(x,y,w,h,r) {
        ctx.beginPath();
        ctx.moveTo(x+r,y);
        ctx.lineTo(x+w-r,y);
        ctx.quadraticCurveTo(x+w,y,x+w,y+r);
        ctx.lineTo(x+w,y+h-r);
        ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
        ctx.lineTo(x+r,y+h);
        ctx.quadraticCurveTo(x,y+h,x,y+h-r);
        ctx.lineTo(x,y+r);
        ctx.quadraticCurveTo(x,y,x+r,y);
        ctx.closePath();
    }

    // ===== Blink =====
    function startBlink() {
        stopBlink();
        blinkOn = true;
        blinkTimer = setInterval(() => { blinkOn = !blinkOn; draw(); }, 400);
    }
    function stopBlink() {
        clearInterval(blinkTimer);
        blinkTimer = null;
        blinkOn = true;
    }

    // ===== Animations =====
    function animRemove(grp, color, cb) {
        animating = true;
        removing = grp.map(p => ({c:p.c, r:p.r, prog:0, color}));
        const t0 = performance.now();
        (function step(t) {
            const p = Math.min((t-t0)/CFG.removeDur, 1);
            removing.forEach(b => b.prog = p);
            draw();
            p < 1 ? requestAnimationFrame(step) : (removing = [], cb());
        })(t0);
    }

    function animSettle(cb) {
        let f = 0;
        (function tick() {
            if (++f < CFG.settleDur) { draw(); requestAnimationFrame(tick); }
            else cb();
        })();
    }

    // ===== Click Logic =====
    function sameGroup(a, b) {
        if (a.length !== b.length || !a.length) return false;
        const s = new Set(a.map(p => p.c*10000+p.r));
        return b.every(p => s.has(p.c*10000+p.r));
    }

    function onClick(e) {
        if (animating || over) return;
        initAudio();

        const rect = cvs.getBoundingClientRect();
        const col = Math.floor((e.clientX - rect.left) / bsz);
        const row = Math.floor((e.clientY - rect.top) / bsz);
        if (col < 0 || col >= CFG.cols || row < 0 || row >= CFG.rows) return;

        const grp = flood(col, row);

        // Click on empty / single → deselect
        if (grp.length < 2) {
            if (selected.length) {
                selected = [];
                stopBlink();
                setInfo('Aynı renkli blok grubuna tıkla');
                draw();
            }
            return;
        }

        // 2nd click on same group → REMOVE
        if (selected.length && sameGroup(grp, selected)) {
            stopBlink();
            const p = pts(selected.length);
            const ci = grid[selected[0].c][selected[0].r];

            // Save undo
            undoSnap = { grid: cloneGrid(), score };
            undoBtn.disabled = false;

            sfx(selected.length >= 8 ? 'big' : 'pop');
            floatScore(col, row, p);

            const toRemove = [...selected];
            selected = []; hovered = [];

            animRemove(toRemove, ci, () => {
                removeGrp(toRemove);
                score += p;
                gravity();
                collapse();
                animSettle(() => {
                    animating = false;
                    updateUI();
                    setInfo('Aynı renkli blok grubuna tıkla');
                    draw();
                    if (!hasMove()) endGame();
                });
            });
            return;
        }

        // 1st click → SELECT
        selected = grp;
        const p = pts(grp.length);
        sfx('sel');
        setInfo(`${grp.length} blok seçili · tekrar tıkla → +${p} puan`, true);
        startBlink();
        draw();
    }

    function onMove(e) {
        if (animating || over) return;
        const rect = cvs.getBoundingClientRect();
        const col = Math.floor((e.clientX - rect.left) / bsz);
        const row = Math.floor((e.clientY - rect.top) / bsz);
        if (col < 0 || col >= CFG.cols || row < 0 || row >= CFG.rows) {
            if (hovered.length) { hovered = []; draw(); }
            return;
        }
        const grp = flood(col, row);
        // Don't hover the selected group
        if (selected.length && sameGroup(grp, selected)) {
            if (hovered.length) { hovered = []; draw(); }
            return;
        }
        if (sameGroup(grp, hovered)) return;
        hovered = grp;
        if (!selected.length && grp.length >= 2) {
            setInfo(`${grp.length} blok · +${pts(grp.length)} puan`);
        } else if (!selected.length) {
            setInfo('Aynı renkli blok grubuna tıkla');
        }
        draw();
    }

    function onLeave() {
        if (hovered.length) {
            hovered = [];
            if (!selected.length) setInfo('Aynı renkli blok grubuna tıkla');
            draw();
        }
    }

    // ===== UI =====
    function setInfo(text, highlight = false) {
        infoText.textContent = text;
        infoBar.classList.toggle('highlight', highlight);
    }

    function updateUI() {
        scoreEl.textContent = score;
        remainEl.textContent = remaining();
        hiEl.textContent = highScore;
        scoreEl.classList.remove('pop');
        void scoreEl.offsetWidth;
        scoreEl.classList.add('pop');
    }

    function floatScore(col, row, p) {
        const rect = cvs.getBoundingClientRect();
        const el = document.createElement('div');
        el.className = 'float-score';
        el.textContent = '+' + p;
        el.style.left = (rect.left + col*bsz + bsz/2) + 'px';
        el.style.top = (rect.top + row*bsz) + 'px';
        el.style.transform = 'translateX(-50%)';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 800);
    }

    // ===== Game Flow =====
    function endGame() {
        over = true;
        const rem = remaining();
        let bonus = 0;
        if (rem === 0) { bonus = 1000; score += bonus; sfx('win'); }
        else sfx('end');
        if (score > highScore) {
            highScore = score;
            localStorage.setItem('same_hi', highScore);
        }
        updateUI();
        setTimeout(() => {
            finalScore.textContent = score;
            finalRemain.textContent = rem;
            if (rem === 0) {
                finalBonus.textContent = '+1000';
                bonusStat.style.display = '';
                finalMsg.textContent = 'Mükemmel! Tüm blokları temizledin!';
            } else if (rem <= 5) {
                bonusStat.style.display = 'none';
                finalMsg.textContent = 'Harika! Neredeyse hepsini temizledin!';
            } else {
                bonusStat.style.display = 'none';
                finalMsg.textContent = 'Daha büyük grupları hedefle.';
            }
            overlayGO.classList.remove('hidden');
        }, 400);
    }

    function newGame() {
        score = 0; over = false;
        selected = []; hovered = []; removing = [];
        animating = false; undoSnap = null;
        undoBtn.disabled = true;
        stopBlink();
        overlayGO.classList.add('hidden');
        overlayST.classList.add('hidden');
        setInfo('Aynı renkli blok grubuna tıkla');
        makeGrid();
        updateUI();
        resize();
    }

    function undo() {
        if (!undoSnap || animating || over) return;
        grid = undoSnap.grid;
        score = undoSnap.score;
        selected = []; hovered = [];
        stopBlink();
        undoSnap = null;
        undoBtn.disabled = true;
        setInfo('Geri alındı');
        updateUI();
        draw();
    }

    // ===== Settings =====
    function initSettings() {
        const optSize = $('opt-size');
        const optColors = $('opt-colors');
        const optSound = $('opt-sound');

        function pillClick(container, cls) {
            container.addEventListener('click', e => {
                const btn = e.target.closest('.pill');
                if (!btn) return;
                container.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        }
        pillClick(optSize); pillClick(optColors); pillClick(optSound);

        $('btn-settings').addEventListener('click', () => overlayST.classList.remove('hidden'));
        $('btn-settings-cancel').addEventListener('click', () => overlayST.classList.add('hidden'));
        $('btn-settings-apply').addEventListener('click', () => {
            const sz = optSize.querySelector('.active');
            const cl = optColors.querySelector('.active');
            const sn = optSound.querySelector('.active');
            if (sz) { CFG.cols = +sz.dataset.cols; CFG.rows = +sz.dataset.rows; }
            if (cl) CFG.numColors = +cl.dataset.colors;
            if (sn) CFG.sound = sn.dataset.sound === 'on';
            initAudio();
            newGame();
        });
        overlayST.addEventListener('click', e => { if (e.target === overlayST) overlayST.classList.add('hidden'); });
    }

    // ===== Init =====
    function init() {
        cvs = $('game-canvas');
        ctx = cvs.getContext('2d');

        cvs.addEventListener('mousemove', onMove);
        cvs.addEventListener('mouseleave', onLeave);
        cvs.addEventListener('click', onClick);
        cvs.addEventListener('touchstart', e => {
            e.preventDefault();
            onClick(new MouseEvent('click', { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY }));
        }, { passive: false });

        $('btn-new-game').addEventListener('click', () => { initAudio(); newGame(); });
        $('btn-play-again').addEventListener('click', () => { initAudio(); newGame(); });
        undoBtn.addEventListener('click', undo);

        overlayGO.addEventListener('click', e => { if (e.target === overlayGO) newGame(); });

        initSettings();
        window.addEventListener('resize', resize);

        document.addEventListener('keydown', e => {
            if (e.key === 'F2') { e.preventDefault(); initAudio(); newGame(); }
            if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
            if (e.key === 'Escape') {
                overlayST.classList.add('hidden');
                overlayGO.classList.add('hidden');
                if (selected.length) { selected = []; stopBlink(); setInfo('Aynı renkli blok grubuna tıkla'); draw(); }
            }
        });

        newGame();
    }

    document.readyState === 'loading'
        ? document.addEventListener('DOMContentLoaded', init)
        : init();
})();
