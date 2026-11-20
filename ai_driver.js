/*
 * Drive Mad AI Driver
 * Läser av skärmen i realtid (bilen, marken, himlen) och kör bilen med
 * samma tangenttryckningar som en människa (piltangenter + R för omstart).
 * Inlärning: evolutionär strategi. Bästa körprofiler sparas i databasen.
 */
(function () {
  'use strict';

  var CFG = {
    tickMs: 50,
    canvasId: 'canvas',
    restartKey: 'r',
    maxEpisodeMs: 45000,
    progressTimeoutMs: 5000,
    startLine: 0.22,
    sw: 96,
    sh: 54
  };

  var S = {
    running: false,
    attempts: 0,
    bestFitness: 0,
    bestDistance: 0,
    completed: false,
    levelKey: 'level-1',
    strategy: null,
    bestStrategy: null,
    episodeStart: 0,
    lastCarX: 0,
    lastProgressAt: 0,
    phase: 'idle',
    downKeys: {},
    prevKey: null,
    planIdx: 0,
    planTimer: 0
  };

  // ---------- Skärmläsning ----------

  function readScreen() {
    var canvas = document.getElementById(CFG.canvasId);
    if (!canvas || !canvas.width) return null;
    try {
      if (!readScreen.off) {
        readScreen.off = document.createElement('canvas');
        readScreen.off.width = CFG.sw;
        readScreen.off.height = CFG.sh;
        readScreen.ctx = readScreen.off.getContext('2d', { willReadFrequently: true });
      }
      readScreen.ctx.drawImage(canvas, 0, 0, CFG.sw, CFG.sh);
      return readScreen.ctx.getImageData(0, 0, CFG.sw, CFG.sh).data;
    } catch (e) {
      return null;
    }
  }

  function analyze() {
    var d = readScreen();
    if (!d) return null;
    var W = CFG.sw, H = CFG.sh;
    var minX = W, maxX = 0, minY = H, maxY = 0, count = 0;
    var groundTopY = H, groundCount = 0, skyCount = 0;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i = (y * W + x) * 4;
        var r = d[i], g = d[i + 1], b = d[i + 2];
        var dark = r < 80 && g < 80 && b < 80;
        if (dark) {
          count++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        if (b > 190 && g > 160 && r < 160 && b > r) skyCount++;
        if (g > 95 && g > r + 10 && g > b + 10) {
          groundCount++;
          if (y < groundTopY) groundTopY = y;
        }
      }
    }
    if (!count) return null;
    return {
      carX: (minX + maxX) / 2 / W,
      carY: (minY + maxY) / 2 / H,
      carLeft: minX / W,
      carRight: maxX / W,
      carBottom: maxY / H,
      carSize: count / (W * H),
      groundY: groundTopY / H,
      skyRatio: skyCount / (W * H)
    };
  }

  // ---------- Tangenter ----------

  function setKey(key, down) {
    if (down && S.downKeys[key]) return;
    if (!down && !S.downKeys[key]) return;
    S.downKeys[key] = down;
    var target = document.getElementById(CFG.canvasId) || document.body;
    target.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', {
      key: key,
      bubbles: true,
      cancelable: true
    }));
  }

  function releaseAll() {
    var keys = Object.keys(S.downKeys);
    for (var i = 0; i < keys.length; i++) {
      if (S.downKeys[keys[i]]) setKey(keys[i], false);
    }
  }

  function restartLevel() {
    releaseAll();
    setKey(CFG.restartKey, true);
    setTimeout(function () { setKey(CFG.restartKey, false); }, 120);
  }

  // ---------- Strategi (evolutionär inlärning) ----------

  function randomPlan() {
    var plan = [];
    for (var i = 0; i < 8; i++) {
      var roll = Math.random();
      var act = roll < 0.62 ? 'up' : (roll < 0.82 ? 'right' : 'left');
      plan.push({ act: act, dur: 0.25 + Math.random() * 1.2 });
    }
    return plan;
  }

  function randomStrategy() {
    return {
      throttleBias: Math.random(),
      leanBackBias: Math.random(),
      airControl: Math.random(),
      plan: randomPlan()
    };
  }

  function mutateStrategy(base) {
    function j() { return (Math.random() - 0.5) * 0.24; }
    function c(v) { return Math.max(0, Math.min(1, v)); }
    var m = {
      throttleBias: c(base.throttleBias + j()),
      leanBackBias: c(base.leanBackBias + j()),
      airControl: c(base.airControl + j()),
      plan: []
    };
    for (var i = 0; i < base.plan.length; i++) {
      var step = base.plan[i];
      if (Math.random() < 0.22) {
        var roll = Math.random();
        m.plan.push({
          act: roll < 0.62 ? 'up' : (roll < 0.82 ? 'right' : 'left'),
          dur: Math.max(0.15, step.dur + (Math.random() - 0.5) * 0.4)
        });
      } else {
        m.plan.push({ act: step.act, dur: Math.max(0.15, step.dur + (Math.random() - 0.5) * 0.2) });
      }
    }
    return m;
  }

  // ---------- Körlogik ----------

  function drive(a, dt) {
    var st = S.strategy;
    var plan = st.plan;
    S.planTimer -= dt;
    if (S.planTimer <= 0) {
      S.planIdx = (S.planIdx + 1) % plan.length;
      S.planTimer = plan[S.planIdx].dur;
    }

    var onGround = Math.abs(a.carBottom - a.groundY) < 0.12;
    var key = null;

    if (onGround) {
      // På marken: följ planen, men luta bakåt vid hög fart för att inte kastas framåt.
      key = plan[S.planIdx].act;
      if (a.skyRatio > 0.45) key = st.throttleBias > 0.4 ? 'up' : null;
    } else {
      // I luften: håll bilen vågrät med luftkontroll.
      if (st.airControl > 0.5) key = 'right';
      else key = null;
    }

    if (key !== S.prevKey) {
      releaseAll();
      if (key) setKey(key, true);
      S.prevKey = key;
    }
  }

  // ---------- Episodhantering ----------

  function endEpisode(a, reason) {
    releaseAll();
    S.prevKey = null;
    var dist = Math.max(0, (a ? a.carX : S.lastCarX) - CFG.startLine);
    var time = (Date.now() - S.episodeStart) / 1000;
    var fitness = dist * 100 + time * 2;
    S.attempts++;

    if (fitness > S.bestFitness) {
      S.bestFitness = fitness;
      S.bestStrategy = S.strategy;
      S.bestDistance = dist;
      if (S.attempts % 5 === 1) saveSolution(dist, time, false);
    }
    if (a && a.carRight > 0.93 && dist > 0.4) {
      S.completed = true;
      saveSolution(dist, time, true);
    }

    updatePanel();
    restartLevel();

    // Evolvera: börja från bästa strategi, mutera.
    S.strategy = S.bestStrategy ? mutateStrategy(S.bestStrategy) : randomStrategy();
    S.planIdx = 0;
    S.planTimer = 0;
    S.episodeStart = Date.now();
    S.lastCarX = CFG.startLine;
    S.lastProgressAt = Date.now();
    S.phase = 'driving';
  }

  function saveSolution(dist, time, completed) {
    try {
      fetch(CFG.db.url.replace(/\/$/, '') + '/rest/v1/ai_solutions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': CFG.db.key,
          'Authorization': 'Bearer ' + CFG.db.key,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify([{
          level_key: S.levelKey,
          strategy: S.bestStrategy || S.strategy,
          fitness: S.bestFitness,
          distance: dist,
          completed: completed,
          duration_ms: Math.round(time * 1000),
          attempt: S.attempts
        }])
      }).catch(function () {});
    } catch (e) {}
  }

  function loadBestSolution() {
    var url = CFG.db.url.replace(/\/$/, '') +
      '/rest/v1/ai_solutions?level_key=eq.' + encodeURIComponent(S.levelKey) +
      '&order=fitness.desc&limit=1';
    return fetch(url, {
      headers: { 'apikey': CFG.db.key, 'Authorization': 'Bearer ' + CFG.db.key }
    })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        if (rows && rows.length && rows[0].strategy) return rows[0].strategy;
        return null;
      })
      .catch(function () { return null; });
  }

  // ---------- Huvudloop ----------

  function tick() {
    if (!S.running) return;
    var a = analyze();
    var now = Date.now();

    if (S.phase === 'driving') {
      if (a) {
        S.lastFrame = a;
        var dt = 0.05;
        drive(a, dt);
        if (a.carX > S.lastCarX + 0.005) {
          S.lastCarX = a.carX;
          S.lastProgressAt = now;
        }
        var stalled = now - S.lastProgressAt > CFG.progressTimeoutMs;
        var timedOut = now - S.episodeStart > CFG.maxEpisodeMs;
        if (stalled || timedOut || S.completed) {
          endEpisode(a, stalled ? 'stalled' : 'timeout');
        }
      } else if (now - S.episodeStart > 10000) {
        endEpisode(null, 'no-vision');
      }
    }
    updatePanel();
  }

  // ---------- Panel (UI) ----------

  function buildPanel() {
    if (document.getElementById('ai-panel')) return;
    var panel = document.createElement('div');
    panel.id = 'ai-panel';
    panel.innerHTML =
      '<div id="ai-panel-inner">' +
      '<div id="ai-title">AI-F\u00f6rare</div>' +
      '<div id="ai-stats">' +
      '<span id="ai-phase">Stoppad</span>' +
      '<span id="ai-attempts">F\u00f6rs\u00f6k: 0</span>' +
      '<span id="ai-dist">Distans: 0%</span>' +
      '<span id="ai-best">B\u00e4sta: 0</span>' +
      '</div>' +
      '<button id="ai-toggle">Starta AI</button>' +
      '<button id="ai-level-save">Spara b\u00e4sta nu</button>' +
      '</div>';

    var style = document.createElement('style');
    style.textContent =
      '#ai-panel{position:fixed;top:12px;right:12px;z-index:9999;background:rgba(15,23,42,0.92);' +
      'color:#e2e8f0;font-family:system-ui,sans-serif;border-radius:12px;padding:12px 14px;' +
      'box-shadow:0 8px 24px rgba(0,0,0,0.35);min-width:210px}' +
      '#ai-panel-inner{display:flex;flex-direction:column;gap:8px}' +
      '#ai-title{font-weight:700;font-size:14px;letter-spacing:0.03em}' +
      '#ai-stats{display:flex;flex-direction:column;gap:2px;font-size:12px;color:#94a3b8}' +
      '#ai-phase{color:#34d399;font-weight:600}' +
      '#ai-panel button{border:0;border-radius:8px;padding:8px 10px;font-size:13px;cursor:pointer;' +
      'font-weight:600;transition:transform 0.15s,filter 0.15s}' +
      '#ai-panel button:hover{filter:brightness(1.12);transform:translateY(-1px)}' +
      '#ai-toggle{background:#10b981;color:#052e1c}' +
      '#ai-level-save{background:#334155;color:#e2e8f0}';
    document.head.appendChild(style);
    document.body.appendChild(panel);

    document.getElementById('ai-toggle').addEventListener('click', toggleRunning);
    document.getElementById('ai-level-save').addEventListener('click', function () {
      saveSolution(S.bestDistance, 0, false);
      flashSaved();
    });
  }

  function flashSaved() {
    var el = document.getElementById('ai-phase');
    if (el) {
      el.textContent = 'Sparad i databasen';
      setTimeout(updatePanel, 1500);
    }
  }

  function updatePanel() {
    var phase = document.getElementById('ai-phase');
    var att = document.getElementById('ai-attempts');
    var dist = document.getElementById('ai-dist');
    var best = document.getElementById('ai-best');
    if (!phase) return;
    if (!S.running) {
      phase.textContent = S.completed ? 'Ban klar!' : 'Stoppad';
    } else {
      phase.textContent = S.phase === 'driving' ? 'K\u00f6r... f\u00f6rs\u00f6k ' + (S.attempts + 1) : 'Startar...';
    }
    att.textContent = 'F\u00f6rs\u00f6k: ' + S.attempts;
    dist.textContent = 'Distans: ' + Math.round(Math.max(0, (S.lastCarX - CFG.startLine)) * 160) + '%';
    best.textContent = 'B\u00e4sta po\u00e4ng: ' + Math.round(S.bestFitness);
  }

  // ---------- Start/stopp ----------

  function toggleRunning() {
    if (S.running) {
      stop();
    } else {
      start();
    }
    var btn = document.getElementById('ai-toggle');
    if (btn) btn.textContent = S.running ? 'Stoppa AI' : 'Starta AI';
  }

  function start() {
    if (S.running) return;
    S.running = true;
    S.phase = 'driving';
    S.episodeStart = Date.now();
    S.lastProgressAt = Date.now();
    S.lastCarX = CFG.startLine;
    if (!S.strategy) S.strategy = randomStrategy();
    if (!S.interval) S.interval = setInterval(tick, CFG.tickMs);
  }

  function stop() {
    S.running = false;
    S.phase = 'idle';
    releaseAll();
    if (S.interval) {
      clearInterval(S.interval);
      S.interval = null;
    }
    updatePanel();
  }

  // ---------- Init ----------

  function init() {
    buildPanel();
    loadBestSolution().then(function (best) {
      if (best) {
        S.bestStrategy = best;
        S.strategy = mutateStrategy(best);
        var el = document.getElementById('ai-phase');
        if (el) el.textContent = 'L\u00e4rde strategi laddad';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
