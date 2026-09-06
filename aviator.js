javascript:(function(){
  if(window.__avtrxDOMv7){
    alert('Логгер v7 уже запущен!');
    return;
  }
  window.__avtrxDOMv7 = true;

  var rounds = [];
  var lastRoundTime = Date.now();
  var streakCount = 0;
  var streakSum = 0;

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

  function onNewMultiplier(m) {
    var now = Date.now();
    var cycleDuration = +((now - lastRoundTime) / 1000).toFixed(2);
    lastRoundTime = now;

    updateBuckets(m);

    // Подсчет серий перед 10x+ (Пункт 4)
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

    // Число игроков из селектора HTML
    var pEl = document.querySelector('.flight-radar-participants-count');
    var players = pEl ? parseInt(pEl.textContent.trim(), 10) : 0;

    rounds.push({
      num: rounds.length + 1,
      ts: now,
      multiplier: m,
      cycle_sec: cycleDuration,
      players: players,
      gap_before_10x: gapInfo
    });

    updateHUD(m);
  }

  // Наблюдатель за лентой истории внизу экрана
  var historyContainer = document.querySelector('.bottom-odds-history');
  if (!historyContainer) {
    alert('Не найден контейнер истории (.bottom-odds-history)!');
    return;
  }

  // При старте считываем последний отображаемый коэф
  var lastAddedEl = historyContainer.querySelector('.px-1:last-child div');
  var lastRecordedText = lastAddedEl ? lastAddedEl.textContent.trim() : '';

  var observer = new MutationObserver(function(mutations){
    mutations.forEach(function(mutation){
      mutation.addedNodes.forEach(function(node){
        if (node.nodeType === 1) {
          var valEl = node.querySelector ? node.querySelector('[class*="text-action-a"]') : null;
          if (!valEl && node.getAttribute('class') && node.getAttribute('class').includes('text-action-a')) {
            valEl = node;
          }
          if (valEl) {
            var valTxt = valEl.textContent.trim();
            var m = parseFloat(valTxt);
            if (!isNaN(m) && m > 0) {
              onNewMultiplier(m);
            }
          }
        }
      });
    });
  });

  observer.observe(historyContainer, { childList: true, subtree: true });

  // --- ИНТЕРФЕЙС HUD ---
  var hud = document.createElement('div');
  hud.id = 'avtrx-hud-v7';
  hud.style.cssText = 'position:fixed;bottom:10px;left:4%;width:92%;background:#090d16;color:#fff;border:2px solid #22c55e;border-radius:10px;padding:8px 12px;z-index:2147483647;font-family:monospace;font-size:11px;box-shadow:0 0 25px rgba(0,0,0,0.9);';
  
  hud.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
                  '<span style="color:#4ade80;font-weight:bold;">✈ DOM-TRACKER v7</span>' +
                  '<span id="v7-last" style="color:#facc15;font-weight:bold;font-size:13px;">Слушаю ленту...</span>' +
                  '<b id="v7-cnt" style="color:#38bdf8;font-size:12px;">0 R</b>' +
                  '</div>' +
                  '<div id="v7-stats" style="font-size:10px;color:#94a3b8;margin-bottom:8px;line-height:1.4;">' +
                  '< 1.10: 0% | < 1.50: 0% | > 10x: 0%' +
                  '</div>' +
                  '<div style="display:flex;gap:6px;">' +
                  '<button id="v7-save" style="flex:1;background:#16a34a;color:#fff;border:none;padding:6px;border-radius:4px;font-weight:bold;cursor:pointer;">💾 JSON ДЛЯ АНАЛИЗА</button>' +
                  '<button id="v7-stat-btn" style="background:#0284c7;color:#fff;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;">📊 ИНФО</button>' +
                  '<button id="v7-clr" style="background:#475569;color:#fff;border:none;padding:6px 8px;border-radius:4px;cursor:pointer;">🧹</button>' +
                  '</div>';
  document.body.appendChild(hud);

  function updateHUD(lastM){
    var cEl = document.getElementById('v7-cnt');
    var lEl = document.getElementById('v7-last');
    var sEl = document.getElementById('v7-stats');

    if (cEl) cEl.textContent = rounds.length + ' R';
    if (lEl) lEl.textContent = lastM.toFixed(2) + 'x';
    
    if (sEl && buckets.total > 0) {
      var p11 = ((buckets.lt_1_10 / buckets.total) * 100).toFixed(1);
      var p15 = ((buckets.lt_1_50 / buckets.total) * 100).toFixed(1);
      var p10 = ((buckets.gt_10_0 / buckets.total) * 100).toFixed(1);
      sEl.innerHTML = '< 1.10: <b>' + p11 + '%</b> | < 1.50: <b>' + p15 + '%</b> | > 10x: <b>' + p10 + '%</b>';
    }
  }

  document.getElementById('v7-stat-btn').onclick = function(){
    if (!rounds.length) return alert('Пока раундов не записано.');
    var txt = '📊 СТАТИСТИКА (' + rounds.length + ' раундов):\n\n' +
              ' • Мгновенный (<=1.01): ' + buckets.instant_1_00 + ' (' + ((buckets.instant_1_00/buckets.total)*100).toFixed(1) + '%)\n' +
              ' • < 1.10x: ' + buckets.lt_1_10 + ' (' + ((buckets.lt_1_10/buckets.total)*100).toFixed(1) + '%)\n' +
              ' • < 1.50x: ' + buckets.lt_1_50 + ' (' + ((buckets.lt_1_50/buckets.total)*100).toFixed(1) + '%)\n' +
              ' • >= 10.0x: ' + buckets.gt_10_0 + ' (' + ((buckets.gt_10_0/buckets.total)*100).toFixed(1) + '%)\n' +
              ' • >= 50.0x: ' + buckets.gt_50_0 + ' (' + ((buckets.gt_50_0/buckets.total)*100).toFixed(1) + '%)\n\n' +
              'Текущая серия без 10x: ' + streakCount + ' раундов (сумма множителей: ' + streakSum.toFixed(2) + ')';
    alert(txt);
  };

  document.getElementById('v7-save').onclick = function(){
    if (!rounds.length) return alert('Выборка пуста!');
    var payload = {
      exportedAt: new Date().toISOString(),
      totalRounds: rounds.length,
      bucketStats: buckets,
      rounds: rounds
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'aviatrix_v7_dataset_' + Date.now() + '.json';
    a.click();
  };

  document.getElementById('v7-clr').onclick = function(){
    rounds = [];
    buckets = { total:0, instant_1_00:0, lt_1_10:0, lt_1_30:0, lt_1_50:0, gt_3_00:0, gt_5_00:0, gt_10_0:0, gt_50_0:0, gt_100_:0 };
    streakCount = 0;
    streakSum = 0;
    updateHUD(0);
  };
})();
