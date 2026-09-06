javascript:(function(){
  if(window.__avtrxPrecisionV6){
    alert('Precision Engine v6 уже запущен!');
    return;
  }
  window.__avtrxPrecisionV6 = true;

  var rounds = [];
  var state = 'WAITING'; // WAITING | FLYING
  var takeoffTs = 0;
  var lastCrashTs = Date.now();
  var maxObservedMult = 1.0;
  var lastMultSeenTs = 0;
  var currentRoundPlayers = 0;

  // Серии перед иксами >= 10.0x (Пункт 4)
  var streakRounds = 0;
  var streakSumMults = 0;

  // 9 корзин множителей (Пункт 3)
  var buckets = {
    total: 0,
    instant_1_00: 0, // <= 1.01x
    lt_1_10: 0,      // < 1.10x
    lt_1_30: 0,      // < 1.30x
    lt_1_50: 0,      // < 1.50x
    gt_3_00: 0,      // >= 3.00x
    gt_5_00: 0,      // >= 5.00x
    gt_10_0: 0,      // >= 10.00x
    gt_50_0: 0,      // >= 50.00x
    gt_100_: 0       // >= 100.00x
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

  // Фиксация падения (Пункты 1, 2, 3, 4)
  function recordCrash(finalMultiplier) {
    var now = Date.now();
    var flightDuration = takeoffTs > 0 ? +((now - takeoffTs) / 1000).toFixed(2) : 0;
    var pauseDuration = lastCrashTs > 0 ? +((takeoffTs - lastCrashTs) / 1000).toFixed(2) : 0;
    if (pauseDuration < 0) pauseDuration = 0;

    lastCrashTs = now;
    state = 'WAITING';

    updateBuckets(finalMultiplier);

    // Анализ серии (Пункт 4)
    var isBigMultiplier = finalMultiplier >= 10.0;
    var gapAnalytics = null;

    if (isBigMultiplier) {
      gapAnalytics = {
        gap_rounds_count: streakRounds,
        gap_multipliers_sum: +streakSumMults.toFixed(2),
        gap_average_mult: streakRounds > 0 ? +(streakSumMults / streakRounds).toFixed(2) : 0
      };
      streakRounds = 0;
      streakSumMults = 0;
    } else {
      streakRounds++;
      streakSumMults += finalMultiplier;
    }

    // Запись раунда в датасет
    var roundData = {
      round_num: rounds.length + 1,
      timestamp: now,
      multiplier: +finalMultiplier.toFixed(2),
      flight_sec: flightDuration,
      pause_sec: pauseDuration,
      players_in_flight: currentRoundPlayers,
      is_instant_crash: finalMultiplier <= 1.01,
      big_hit_gap_stats: gapAnalytics
    };

    rounds.push(roundData);
    updateHUD(finalMultiplier, flightDuration, pauseDuration);
    maxObservedMult = 1.0;
  }

  // 1. Поиск главного множителя (строго с точкой и "x")
  function scanMainMultiplier() {
    var candidates = [];
    var all = document.querySelectorAll('*');
    var maxTop = window.innerHeight * 0.55;

    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.id === 'avtrx-hud-v6' || el.closest('#avtrx-hud-v6')) continue;

      var txt = (el.textContent || '').trim();
      // Строгий паттерн: цифры + точка + цифры + x (например, 5.48x). Отсчет 5..4..3..2 НЕ пройдет!
      var m = txt.match(/^(\d+\.\d{1,2})\s*[xх]$/i);
      if (m && el.children.length <= 1) {
        var rect = el.getBoundingClientRect();
        // Отсекаем шторку участников внизу: главный множитель строго в центре/вверху
        if (rect.top < maxTop && rect.top > 60 && rect.width > 40) {
          candidates.push({ val: parseFloat(m[1]), area: rect.width * rect.height });
        }
      }
    }
    if (candidates.length) {
      candidates.sort(function(a, b){ return b.area - a.area; });
      return candidates[0].val; // Самый крупный шрифт по центру
    }
    return null;
  }

  // 2. Поиск количества активных игроков (значок самолета ✈ 785)
  function scanActivePlayers() {
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.children.length > 0) continue;
      var txt = (el.textContent || '').trim();
      var m = txt.match(/^[✈\s]*(\d{2,5})$/);
      if (m) {
        var n = parseInt(m[1], 10);
        if (n >= 20 && n <= 50000) return n;
      }
    }
    return null;
  }

  // Высокочастотный цикл (каждые 60 миллисекунд)
  setInterval(function(){
    var liveMult = scanMainMultiplier();
    var livePlayers = scanActivePlayers();
    if (livePlayers) currentRoundPlayers = livePlayers;

    var statusEl = document.getElementById('v6-status');

    if (liveMult !== null) {
      lastMultSeenTs = Date.now();

      if (state === 'WAITING') {
        // Самолет пошел на взлет!
        state = 'FLYING';
        takeoffTs = Date.now();
        maxObservedMult = liveMult;
      } else if (state === 'FLYING') {
        if (liveMult > maxObservedMult) {
          maxObservedMult = liveMult;
        }
      }

      if (statusEl) {
        statusEl.innerHTML = '✈ <span style="color:#38bdf8;">' + maxObservedMult.toFixed(2) + 'x</span> (' + currentRoundPlayers + ' чел)';
      }
    } else {
      // Числа X.XXx на экране нет (идет обратный отсчет или посадка)
      if (state === 'FLYING') {
        // Если множитель пропал на > 400 мс — самолет разбился
        if (Date.now() - lastMultSeenTs > 400) {
          recordCrash(maxObservedMult);
        }
      } else {
        if (statusEl) {
          statusEl.innerHTML = '<span style="color:#94a3b8;">Отсчет / Ставки... (' + currentRoundPlayers + ' чел)</span>';
        }
      }
    }
  }, 60);

  // --- ИНТЕРФЕЙС HUD ---
  var hud = document.getElementById('avtrx-hud-v6');
  if (hud) hud.remove();

  hud = document.createElement('div');
  hud.id = 'avtrx-hud-v6';
  hud.style.cssText = 'position:fixed;bottom:10px;left:4%;width:92%;background:#090d16;color:#fff;border:2px solid #38bdf8;border-radius:10px;padding:8px 12px;z-index:9999999999;font-family:monospace;font-size:11px;box-shadow:0 0 25px rgba(0,0,0,0.9);';
  
  hud.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
                  '<span style="color:#38bdf8;font-weight:bold;">✈ PRECISION v6</span>' +
                  '<span id="v6-status" style="color:#facc15;font-weight:bold;">Калибровка...</span>' +
                  '<b id="v6-rounds" style="color:#4ade80;font-size:12px;">0 R</b>' +
                  '</div>' +
                  '<div id="v6-stats-box" style="font-size:10px;color:#94a3b8;margin-bottom:8px;line-height:1.4;">' +
                  'Полет: 0с | Пауза: 0с<br>< 1.10: 0% | < 1.50: 0% | > 10x: 0%' +
                  '</div>' +
                  '<div style="display:flex;gap:6px;">' +
                  '<button id="v6-save" style="flex:1;background:#16a34a;color:#fff;border:none;padding:6px;border-radius:4px;font-weight:bold;cursor:pointer;">💾 JSON ДЛЯ АНАЛИЗА</button>' +
                  '<button id="v6-stat-btn" style="background:#0284c7;color:#fff;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;">📊 ИНФО</button>' +
                  '<button id="v6-clr" style="background:#475569;color:#fff;border:none;padding:6px 8px;border-radius:4px;cursor:pointer;">🧹</button>' +
                  '</div>';
  document.body.appendChild(hud);

  function updateHUD(lastCrash, flightSec, pauseSec){
    var rEl = document.getElementById('v6-rounds');
    var sEl = document.getElementById('v6-stats-box');

    if (rEl) rEl.textContent = rounds.length + ' R';
    if (sEl && buckets.total > 0) {
      var p11 = ((buckets.lt_1_10 / buckets.total) * 100).toFixed(1);
      var p15 = ((buckets.lt_1_50 / buckets.total) * 100).toFixed(1);
      var p10 = ((buckets.gt_10_0 / buckets.total) * 100).toFixed(1);
      sEl.innerHTML = 'Краш: <b>' + lastCrash.toFixed(2) + 'x</b> | Полет: <b>' + flightSec + 'с</b> | Пауза: <b>' + pauseSec + 'с</b><br>' +
                      '< 1.10: <b>' + p11 + '%</b> | < 1.50: <b>' + p15 + '%</b> | > 10x: <b>' + p10 + '%</b>';
    }
  }

  // Окно расширенной статистики (Пункты 1, 2, 3, 4)
  document.getElementById('v6-stat-btn').onclick = function(){
    if (!rounds.length) return alert('Раунды еще не зафиксированы. Подождите завершения хотя бы одного полета!');
    var avgF = (rounds.reduce(function(a,b){return a+b.flight_sec;},0)/rounds.length).toFixed(2);
    var avgP = (rounds.reduce(function(a,b){return a+b.pause_sec;},0)/rounds.length).toFixed(2);
    
    var info = '📊 ДЕТАЛЬНАЯ СТАТИСТИКА (' + rounds.length + ' раундов):\n\n' +
               '1. ВРЕМЯ:\n' +
               ' • Средний полет: ' + avgF + ' сек.\n' +
               ' • Средняя пауза: ' + avgP + ' сек.\n\n' +
               '2. РАСПРЕДЕЛЕНИЕ ПО КОРЗИНАМ:\n' +
               ' • Мгновенный (<=1.01x): ' + buckets.instant_1_00 + ' (' + ((buckets.instant_1_00/buckets.total)*100).toFixed(1) + '%)\n' +
               ' • < 1.10x: ' + buckets.lt_1_10 + ' (' + ((buckets.lt_1_10/buckets.total)*100).toFixed(1) + '%)\n' +
               ' • < 1.30x: ' + buckets.lt_1_30 + ' (' + ((buckets.lt_1_30/buckets.total)*100).toFixed(1) + '%)\n' +
               ' • < 1.50x: ' + buckets.lt_1_50 + ' (' + ((buckets.lt_1_50/buckets.total)*100).toFixed(1) + '%)\n' +
               ' • >= 3.00x: ' + buckets.gt_3_00 + ' (' + ((buckets.gt_3_00/buckets.total)*100).toFixed(1) + '%)\n' +
               ' • >= 5.00x: ' + buckets.gt_5_00 + ' (' + ((buckets.gt_5_00/buckets.total)*100).toFixed(1) + '%)\n' +
               ' • >= 10.0x: ' + buckets.gt_10_0 + ' (' + ((buckets.gt_10_0/buckets.total)*100).toFixed(1) + '%)\n' +
               ' • >= 50.0x: ' + buckets.gt_50_0 + ' (' + ((buckets.gt_50_0/buckets.total)*100).toFixed(1) + '%)\n' +
               ' • >= 100.0x: ' + buckets.gt_100_ + ' (' + ((buckets.gt_100_/buckets.total)*100).toFixed(1) + '%)\n\n' +
               '3. СЕРИИ ПЕРЕД 10x+:\n' +
               ' • Текущая серия без 10x: ' + streakRounds + ' раундов подряд\n' +
               ' • Сумма коэффициентов в серии: ' + streakSumMults.toFixed(2);
    alert(info);
  };

  // Выгрузка полного датасета в JSON
  document.getElementById('v6-save').onclick = function(){
    if (!rounds.length) return alert('Выборка пуста!');
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
    a.download = 'aviatrix_precision_v6_' + Date.now() + '.json';
    a.click();
  };

  document.getElementById('v6-clr').onclick = function(){
    rounds = [];
    buckets = { total:0, instant_1_00:0, lt_1_10:0, lt_1_30:0, lt_1_50:0, gt_3_00:0, gt_5_00:0, gt_10_0:0, gt_50_0:0, gt_100_:0 };
    streakRounds = 0;
    streakSumMults = 0;
    updateHUD(0, 0, 0);
  };
})();
