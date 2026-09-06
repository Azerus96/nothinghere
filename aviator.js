javascript:(function(){
  if(window.__avtrxLiveV5){
    alert('Трекер v5 уже активен!');
    return;
  }
  window.__avtrxLiveV5 = true;

  // --- ХРАНИЛИЩЕ ДАННЫХ ---
  var rounds = [];
  var lastCrashTime = Date.now();
  var takeoffTime = 0;
  var currentMaxOdd = 1.0;
  var isFlying = false;
  var streakLowRounds = 0;
  var streakSumOdds = 0;

  // Счетчики корзин (Пункт 3)
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

  // Фиксация падения (Пункты 1, 2, 3, 4)
  function onCrash(finalOdd) {
    var now = Date.now();
    var flightDuration = takeoffTime > 0 ? +((now - takeoffTime) / 1000).toFixed(2) : 0;
    var pauseDuration = lastCrashTime > 0 ? +((takeoffTime - lastCrashTime) / 1000).toFixed(2) : 0;
    if (pauseDuration < 0) pauseDuration = 0;

    lastCrashTime = now;
    isFlying = false;

    updateBuckets(finalOdd);

    // Анализ серий перед большими иксами (Пункт 4)
    var isBigHit = finalOdd >= 10.0;
    var completedStreak = null;
    if (isBigHit) {
      completedStreak = {
        rounds_before_hit: streakLowRounds,
        sum_multipliers_before_hit: +streakSumOdds.toFixed(2),
        avg_multiplier_in_gap: streakLowRounds > 0 ? +(streakSumOdds / streakLowRounds).toFixed(2) : 0
      };
      streakLowRounds = 0;
      streakSumOdds = 0;
    } else {
      streakLowRounds++;
      streakSumOdds += finalOdd;
    }

    // Сохраняем раунд
    rounds.push({
      round_num: rounds.length + 1,
      timestamp: now,
      multiplier: +finalOdd.toFixed(2),
      flight_sec: flightDuration,
      pause_sec: pauseDuration,
      is_instant_crash: finalOdd <= 1.01,
      streak_info: completedStreak
    });

    currentMaxOdd = 1.0;
    updateHUD(finalOdd, flightDuration, pauseDuration);
  }

  // --- ПОИСК КОЭФФИЦИЕНТА НА ЭКРАНЕ (100 мс) ---
  function getLiveOddFromScreen() {
    var candidates = [];
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.id === 'avtrx-hud-v5' || el.closest('#avtrx-hud-v5')) continue;
      
      var txt = (el.textContent || '').trim();
      // Ищем цифры множителя (например: 5.48x, 1.75x, 6.31x)
      var m = txt.match(/^(\d+(?:\.\d{1,2})?)[xх]?$/i);
      if (m && el.children.length <= 1) {
        var val = parseFloat(m[1]);
        if (val >= 1.0 && val < 50000) {
          var rect = el.getBoundingClientRect();
          // Главный множитель находится в верхней/центральной части экрана
          if (rect.top < window.innerHeight * 0.6 && rect.height > 20) {
            candidates.push({ val: val, size: rect.width * rect.height });
          }
        }
      }
    }
    if (candidates.length) {
      candidates.sort(function(a,b){ return b.size - a.size; });
      return candidates[0].val;
    }
    return null;
  }

  // Игровой цикл трекера
  var idleTicks = 0;
  setInterval(function(){
    var liveVal = getLiveOddFromScreen();
    var liveEl = document.getElementById('v5-live-val');

    if (liveVal !== null) {
      if (liveEl) liveEl.textContent = liveVal.toFixed(2) + 'x';

      if (liveVal > currentMaxOdd) {
        // Самолет летит, коэффициент растет
        if (!isFlying) {
          isFlying = true;
          takeoffTime = Date.now();
        }
        currentMaxOdd = liveVal;
        idleTicks = 0;
      } else if (isFlying && liveVal === currentMaxOdd) {
        // Число замерло (краш)
        idleTicks++;
        if (idleTicks >= 5) { // 500 мс без роста = взрыв
          onCrash(currentMaxOdd);
          idleTicks = 0;
        }
      }
    } else {
      if (isFlying) {
        idleTicks++;
        if (idleTicks >= 5) {
          onCrash(currentMaxOdd);
          idleTicks = 0;
        }
      }
    }
  }, 100);

  // --- ИНТЕРФЕЙС HUD ---
  var hud = document.getElementById('avtrx-hud-v5');
  if (hud) hud.remove();

  hud = document.createElement('div');
  hud.id = 'avtrx-hud-v5';
  hud.style.cssText = 'position:fixed;bottom:10px;left:5%;width:90%;background:#090d16;color:#fff;border:2px solid #38bdf8;border-radius:10px;padding:8px 12px;z-index:9999999999;font-family:monospace;font-size:11px;box-shadow:0 0 25px rgba(0,0,0,0.9);';
  
  hud.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
                  '<span style="color:#38bdf8;font-weight:bold;">✈ LIVE v5</span>' +
                  '<span id="v5-live-val" style="color:#facc15;font-weight:bold;font-size:13px;">Ищу самолет...</span>' +
                  '<b id="v5-rounds" style="color:#4ade80;font-size:12px;">0 R</b>' +
                  '</div>' +
                  '<div id="v5-stat-preview" style="font-size:10px;color:#94a3b8;margin-bottom:8px;line-height:1.4;">' +
                  'Полет: 0с | Пауза: 0с<br>< 1.10: 0% | < 1.50: 0% | > 10x: 0%' +
                  '</div>' +
                  '<div style="display:flex;gap:6px;">' +
                  '<button id="v5-btn-save" style="flex:1;background:#16a34a;color:#fff;border:none;padding:6px;border-radius:4px;font-weight:bold;cursor:pointer;">💾 СКАЧАТЬ JSON</button>' +
                  '<button id="v5-btn-full" style="background:#0284c7;color:#fff;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;">📊 ИНФО</button>' +
                  '<button id="v5-btn-clr" style="background:#475569;color:#fff;border:none;padding:6px 8px;border-radius:4px;cursor:pointer;">🧹</button>' +
                  '</div>';
  document.body.appendChild(hud);

  function updateHUD(lastCrash, flightSec, pauseSec){
    var rEl = document.getElementById('v5-rounds');
    var pEl = document.getElementById('v5-stat-preview');

    if (rEl) rEl.textContent = rounds.length + ' R';
    if (pEl && buckets.total > 0) {
      var p11 = ((buckets.lt_1_10 / buckets.total) * 100).toFixed(1);
      var p15 = ((buckets.lt_1_50 / buckets.total) * 100).toFixed(1);
      var p10 = ((buckets.gt_10_0 / buckets.total) * 100).toFixed(1);
      pEl.innerHTML = 'Краш: <b>' + lastCrash.toFixed(2) + 'x</b> | Полет: ' + flightSec + 'с | Пауза: ' + pauseSec + 'с<br>' +
                      '< 1.10: <b>' + p11 + '%</b> | < 1.50: <b>' + p15 + '%</b> | > 10x: <b>' + p10 + '%</b>';
    }
  }

  // Кнопка подробного отчета
  document.getElementById('v5-btn-full').onclick = function(){
    if (!rounds.length) return alert('Раунды еще не зафиксированы. Подождите 1-2 полета!');
    var avgFlight = (rounds.reduce(function(a,b){return a+b.flight_sec;},0)/rounds.length).toFixed(2);
    var avgPause = (rounds.reduce(function(a,b){return a+b.pause_sec;},0)/rounds.length).toFixed(2);
    
    var txt = '📊 ОТЧЕТ ПО ' + rounds.length + ' РАУНДАМ:\n\n' +
              '1. Средний полет: ' + avgFlight + ' сек.\n' +
              '2. Средняя пауза: ' + avgPause + ' сек.\n\n' +
              '3. КОРЗИНЫ:\n' +
              ' • Мгновенный (<=1.01x): ' + buckets.instant_1_00 + ' (' + ((buckets.instant_1_00/buckets.total)*100).toFixed(1) + '%)\n' +
              ' • < 1.10x: ' + buckets.lt_1_10 + ' (' + ((buckets.lt_1_10/buckets.total)*100).toFixed(1) + '%)\n' +
              ' • < 1.30x: ' + buckets.lt_1_30 + ' (' + ((buckets.lt_1_30/buckets.total)*100).toFixed(1) + '%)\n' +
              ' • < 1.50x: ' + buckets.lt_1_50 + ' (' + ((buckets.lt_1_50/buckets.total)*100).toFixed(1) + '%)\n' +
              ' • > 3.00x: ' + buckets.gt_3_00 + ' (' + ((buckets.gt_3_00/buckets.total)*100).toFixed(1) + '%)\n' +
              ' • > 5.00x: ' + buckets.gt_5_00 + ' (' + ((buckets.gt_5_00/buckets.total)*100).toFixed(1) + '%)\n' +
              ' • > 10.0x: ' + buckets.gt_10_0 + ' (' + ((buckets.gt_10_0/buckets.total)*100).toFixed(1) + '%)\n' +
              ' • > 50.0x: ' + buckets.gt_50_0 + ' (' + ((buckets.gt_50_0/buckets.total)*100).toFixed(1) + '%)\n' +
              ' • > 100.0x: ' + buckets.gt_100_ + ' (' + ((buckets.gt_100_/buckets.total)*100).toFixed(1) + '%)\n\n' +
              '4. СЕРИИ: Текущая серия без коэффициента 10x+: ' + streakLowRounds + ' раундов (сумма множителей: ' + streakSumOdds.toFixed(1) + ')';
    alert(txt);
  };

  // Выгрузка полного датасета
  document.getElementById('v5-btn-save').onclick = function(){
    if (!rounds.length) return alert('Выборка пуста!');
    var payload = {
      exportedAt: new Date().toISOString(),
      summary: {
        totalRounds: rounds.length,
        bucketStats: buckets
      },
      rounds: rounds
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'aviatrix_live_dataset_' + Date.now() + '.json';
    a.click();
  };

  document.getElementById('v5-btn-clr').onclick = function(){
    rounds = [];
    buckets = { total:0, instant_1_00:0, lt_1_10:0, lt_1_30:0, lt_1_50:0, gt_3_00:0, gt_5_00:0, gt_10_0:0, gt_50_0:0, gt_100_:0 };
    streakLowRounds = 0;
    streakSumOdds = 0;
    updateHUD(0, 0, 0);
  };
})();
