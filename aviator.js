javascript:(function(){
  // Снимаем блокировку от предыдущих версий
  window.__avtrxDOMv7 = false;
  window.__avtrxPrecisionV6 = false;
  
  if (window.__avtrxIroncladV8) {
    alert('Ironclad v8 уже активен!');
    return;
  }
  window.__avtrxIroncladV8 = true;

  var rounds = [];
  var lastLeadText = '';
  var streakCount = 0;
  var streakSum = 0;
  var lastRoundTs = Date.now();

  var buckets = {
    total: 0,
    instant_1_00: 0,
    lt_1_10: 0,
    lt_1_30: 0,
    lt_1_50: 0,
    gt_3_00: 0,
    gt_5_00: 0,
    gt_10_0: 0,
    gt_50_0: 0,
    gt_100_: 0
  };

  function updateBuckets(m) {
    buckets.total++;
    if (m <= 1.01) buckets.instant_1_00++;
    if (m < 1.10) buckets.lt_1_10++;
    if (m < 1.30) buckets.lt_1_30++;
    if (m < 1.50) buckets.lt_1_50++;
    if (m >= 3.00) buckets.gt_3_00++;
    if (m >= 5.00) buckets.gt_5_00++;
    if (m >= 10.00) buckets.gt_10_0++;
    if (m >= 50.00) buckets.gt_50_0++;
    if (m >= 100.00) buckets.gt_100_++;
  }

  function addRound(m, isBacklog) {
    var now = Date.now();
    var cycle = isBacklog ? 0 : +((now - lastRoundTs) / 1000).toFixed(2);
    if (!isBacklog) lastRoundTs = now;

    updateBuckets(m);

    var gapInfo = null;
    if (m >= 10.0) {
      gapInfo = {
        gap_rounds: streakCount,
        gap_sum: +streakSum.toFixed(2),
        gap_avg: streakCount > 0 ? +(streakSum / streakCount).toFixed(2) : 0
      };
      streakCount = 0;
      streakSum = 0;
    } else {
      streakCount++;
      streakSum += m;
    }

    var pEl = document.querySelector('.flight-radar-participants-count');
    var players = pEl ? parseInt(pEl.textContent.trim(), 10) : 0;

    rounds.push({
      num: rounds.length + 1,
      ts: now,
      multiplier: m,
      cycle_sec: cycle,
      players: players,
      gap_before_10x: gapInfo
    });
  }

  // --- 1. МГНОВЕННЫЙ ЗАХВАТ ВСЕЙ ИМЕЮЩЕЙСЯ ИСТОРИИ ИЗ DOM ---
  var currentEls = document.querySelectorAll('.bottom-odds-history [class*="text-action-a"]');
  if (currentEls.length > 0) {
    // В ленте первый элемент - самый свежий, последний - самый старый. Загружаем хронологически:
    var historical = [];
    currentEls.forEach(function(el){
      var v = parseFloat(el.textContent.trim());
      if (!isNaN(v) && v > 0) historical.push(v);
    });
    
    // Запоминаем текущий самый свежий элемент
    lastLeadText = currentEls[0].textContent.trim();

    // Загружаем снизу вверх (хронологически)
    historical.reverse().forEach(function(m){
      addRound(m, true);
    });
  }

  // --- 2. ЖЕЛЕЗОБЕТОННЫЙ ПОЛЛИНГ КАЖДЫЕ 200 МС ---
  setInterval(function(){
    var firstEl = document.querySelector('.bottom-odds-history [class*="text-action-a"]');
    if (firstEl) {
      var txt = firstEl.textContent.trim();
      if (txt && txt !== lastLeadText) {
        lastLeadText = txt;
        var m = parseFloat(txt);
        if (!isNaN(m) && m > 0) {
          addRound(m, false);
          updateHUD(m);
        }
      }
    }
  }, 200);

  // --- 3. ИНТЕРФЕЙС HUD ---
  var old = document.getElementById('avtrx-ironclad-hud');
  if (old) old.remove();

  var hud = document.createElement('div');
  hud.id = 'avtrx-ironclad-hud';
  hud.style.cssText = 'position:fixed;bottom:10px;left:4%;width:92%;background:#090d16;color:#fff;border:2px solid #38bdf8;border-radius:10px;padding:8px 12px;z-index:2147483647;font-family:monospace;font-size:11px;box-shadow:0 0 25px rgba(0,0,0,0.9);';
  
  hud.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
                  '<span style="color:#38bdf8;font-weight:bold;">✈ IRONCLAD v8</span>' +
                  '<span id="v8-last" style="color:#facc15;font-weight:bold;font-size:13px;">' + (rounds.length ? rounds[rounds.length-1].multiplier + 'x' : 'Слежу...') + '</span>' +
                  '<b id="v8-cnt" style="color:#4ade80;font-size:12px;">' + rounds.length + ' R</b>' +
                  '</div>' +
                  '<div id="v8-stats" style="font-size:10px;color:#94a3b8;margin-bottom:8px;line-height:1.4;"></div>' +
                  '<div style="display:flex;gap:6px;">' +
                  '<button id="v8-save" style="flex:1;background:#16a34a;color:#fff;border:none;padding:6px;border-radius:4px;font-weight:bold;cursor:pointer;">💾 СКАЧАТЬ ВЕСЬ JSON</button>' +
                  '<button id="v8-stat-btn" style="background:#0284c7;color:#fff;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;">📊 ИНФО</button>' +
                  '<button id="v8-clr" style="background:#475569;color:#fff;border:none;padding:6px 8px;border-radius:4px;cursor:pointer;">🧹</button>' +
                  '</div>';
  document.body.appendChild(hud);

  function updateHUD(lastM){
    var cEl = document.getElementById('v8-cnt');
    var lEl = document.getElementById('v8-last');
    var sEl = document.getElementById('v8-stats');

    if (cEl) cEl.textContent = rounds.length + ' R';
    if (lEl && lastM) lEl.textContent = lastM.toFixed(2) + 'x';
    
    if (sEl && buckets.total > 0) {
      var p11 = ((buckets.lt_1_10 / buckets.total) * 100).toFixed(1);
      var p15 = ((buckets.lt_1_50 / buckets.total) * 100).toFixed(1);
      var p10 = ((buckets.gt_10_0 / buckets.total) * 100).toFixed(1);
      sEl.innerHTML = '< 1.10: <b>' + p11 + '%</b> | < 1.50: <b>' + p15 + '%</b> | > 10x: <b>' + p10 + '%</b>';
    }
  }

  updateHUD(rounds.length ? rounds[rounds.length-1].multiplier : 0);

  document.getElementById('v8-stat-btn').onclick = function(){
    var avgC = (rounds.reduce(function(a,b){return a+b.cycle_sec;},0)/rounds.length).toFixed(2);
    var txt = '📊 СТАТИСТИКА (' + rounds.length + ' раундов):\n\n' +
              ' • Мгновенный (<=1.01): ' + buckets.instant_1_00 + ' (' + ((buckets.instant_1_00/buckets.total)*100).toFixed(1) + '%)\n' +
              ' • < 1.10x: ' + buckets.lt_1_10 + ' (' + ((buckets.lt_1_10/buckets.total)*100).toFixed(1) + '%)\n' +
              ' • < 1.50x: ' + buckets.lt_1_50 + ' (' + ((buckets.lt_1_50/buckets.total)*100).toFixed(1) + '%)\n' +
              ' • >= 10.0x: ' + buckets.gt_10_0 + ' (' + ((buckets.gt_10_0/buckets.total)*100).toFixed(1) + '%)\n' +
              ' • >= 50.0x: ' + buckets.gt_50_0 + ' (' + ((buckets.gt_50_0/buckets.total)*100).toFixed(1) + '%)\n' +
              ' • >= 100.0x: ' + buckets.gt_100_ + ' (' + ((buckets.gt_100_/buckets.total)*100).toFixed(1) + '%)\n\n' +
              'Текущая серия без 10x+: ' + streakCount + ' раундов (сумма: ' + streakSum.toFixed(2) + ')';
    alert(txt);
  };

  document.getElementById('v8-save').onclick = function(){
    var payload = {
      exportedAt: new Date().toISOString(),
      game: 'Aviatrix',
      totalRounds: rounds.length,
      bucketStats: buckets,
      rounds: rounds
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'aviatrix_ironclad_v8_' + Date.now() + '.json';
    a.click();
  };

  document.getElementById('v8-clr').onclick = function(){
    rounds = [];
    buckets = { total:0, instant_1_00:0, lt_1_10:0, lt_1_30:0, lt_1_50:0, gt_3_00:0, gt_5_00:0, gt_10_0:0, gt_50_0:0, gt_100_:0 };
    streakCount = 0;
    streakSum = 0;
    updateHUD(0);
  };
})();
