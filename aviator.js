javascript:(function(){
  window.__avtrxIroncladV8 = false;
  if (window.__avtrxWhaleV10) {
    alert('Whale Engine v10 уже активен!');
    return;
  }
  window.__avtrxWhaleV10 = true;

  var rounds = [];
  var lastLeadText = '';
  var streakCount = 0;
  var streakSum = 0;
  var lastCrashTs = Date.now();
  var peakPlayers = 0;
  var liveWhales = [];

  var buckets = { total: 0, instant_1_00: 0, lt_1_10: 0, lt_1_30: 0, lt_1_50: 0, gt_3_00: 0, gt_5_00: 0, gt_10_0: 0, gt_50_0: 0, gt_100_: 0 };

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

  // Непрерывный опрос радара (устраняет 0 игроков)
  setInterval(function(){
    var pEl = document.querySelector('.flight-radar-participants-count');
    if (pEl) {
      var n = parseInt(pEl.textContent.trim(), 10);
      if (!isNaN(n) && n > peakPlayers) peakPlayers = n;
    }
  }, 200);

  // 1. ПАРСИНГ ШТОРКИ КИТОВ ИЗ DOM В РЕАЛЬНОМ ВРЕМЕНИ
  function parseVisibleWhales() {
    var rows = [];
    // Ищем контейнеры списка участников под экраном
    var elements = document.querySelectorAll('.layout [class*="overflow"] > div');
    elements.forEach(function(el){
      var txt = el.textContent || '';
      // Ищем строки, где есть ставка (например, 31.83K) и множитель (например, 1.51x или "-")
      if (txt.includes('K') || txt.includes('₽') || txt.includes('x')) {
        var parts = txt.trim().split(/\s+/);
        if (parts.length >= 3) {
          rows.push(txt.trim());
        }
      }
    });
    return rows.slice(0, 15);
  }

  // 2. СЕТЕВОЙ ПЕРЕХВАТ ДЕТАЛЬНЫХ СТАВОК (GetParticipants)
  var origFetch = window.fetch;
  window.fetch = async function(){
    var res = await origFetch.apply(this, arguments);
    var url = arguments[0];
    var urlStr = (typeof url === 'string') ? url : (url && url.url ? url.url : '');
    if (urlStr.includes('GetParticipants')) {
      try {
        res.clone().json().then(function(d){
          if (d.participants && d.participants.length) {
            liveWhales = d.participants.slice(0, 20).map(function(p){
              var bet = +(p.betAmount || p.amount || 0);
              var win = +(p.winAmount || 0);
              return {
                name: p.assetsInfo ? p.assetsInfo.name : (p.userId ? p.userId.substring(0, 6) : 'anon'),
                bet_rub: bet,
                cashout_mult: p.odds || 0,
                win_rub: win,
                net_profit_rub: win > 0 ? +(win - bet).toFixed(2) : -bet,
                status: p.status
              };
            });
          }
        }).catch(function(){});
      } catch(e){}
    }
    return res;
  };

  function addRound(m) {
    var now = Date.now();
    var cycleTotal = +((now - lastCrashTs) / 1000).toFixed(2);
    var flightSec = m > 1.0 ? +(12.11 * Math.log(m)).toFixed(2) : 0.2;
    var pauseSec = +(cycleTotal - flightSec).toFixed(2);
    if (pauseSec < 0) pauseSec = 7.91;

    lastCrashTs = now;
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

    var domWhales = parseVisibleWhales();

    var roundEntry = {
      round_num: rounds.length + 1,
      ts: now,
      multiplier: m,
      cycle_sec: cycleTotal,
      flight_sec: flightSec,
      pause_sec: pauseSec,
      players_peak: peakPlayers || 1100,
      streak_before_10x: gapInfo,
      whales_network_data: liveWhales.length ? liveWhales : null,
      whales_dom_sample: domWhales.length ? domWhales : null
    };

    rounds.push(roundEntry);
    peakPlayers = 0;
    liveWhales = [];
    updateHUD(m, roundEntry.players_peak);
  }

  // Железобетонный поллинг ленты истории
  setInterval(function(){
    var firstEl = document.querySelector('.bottom-odds-history [class*="text-action-a"]');
    if (firstEl) {
      var txt = firstEl.textContent.trim();
      if (!lastLeadText) {
        lastLeadText = txt;
      } else if (txt && txt !== lastLeadText) {
        lastLeadText = txt;
        var m = parseFloat(txt);
        if (!isNaN(m) && m > 0) {
          addRound(m);
        }
      }
    }
  }, 200);

  // HUD
  var old = document.getElementById('avtrx-v10-hud');
  if (old) old.remove();

  var hud = document.createElement('div');
  hud.id = 'avtrx-v10-hud';
  hud.style.cssText = 'position:fixed;bottom:10px;left:4%;width:92%;background:#090d16;color:#fff;border:2px solid #38bdf8;border-radius:10px;padding:8px 12px;z-index:2147483647;font-family:monospace;font-size:11px;box-shadow:0 0 25px rgba(0,0,0,0.9);';
  
  hud.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
                  '<span style="color:#38bdf8;font-weight:bold;">✈ WHALE & PNL v10</span>' +
                  '<span id="v10-last" style="color:#facc15;font-weight:bold;font-size:13px;">Слушаю...</span>' +
                  '<b id="v10-cnt" style="color:#4ade80;font-size:12px;">0 R</b>' +
                  '</div>' +
                  '<div id="v10-stats" style="font-size:10px;color:#94a3b8;margin-bottom:8px;line-height:1.4;">' +
                  '< 1.10: 0% | < 1.50: 0% | > 10x: 0%' +
                  '</div>' +
                  '<div style="display:flex;gap:6px;">' +
                  '<button id="v10-save" style="flex:1;background:#16a34a;color:#fff;border:none;padding:6px;border-radius:4px;font-weight:bold;cursor:pointer;">💾 СКАЧАТЬ ДАТАСЕТ</button>' +
                  '<button id="v10-stat-btn" style="background:#0284c7;color:#fff;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;">📊 ИНФО</button>' +
                  '<button id="v10-clr" style="background:#475569;color:#fff;border:none;padding:6px 8px;border-radius:4px;cursor:pointer;">🧹</button>' +
                  '</div>';
  document.body.appendChild(hud);

  function updateHUD(lastM, players){
    var cEl = document.getElementById('v10-cnt');
    var lEl = document.getElementById('v10-last');
    var sEl = document.getElementById('v10-stats');

    if (cEl) cEl.textContent = rounds.length + ' R';
    if (lEl && lastM) lEl.innerHTML = lastM.toFixed(2) + 'x <span style="font-size:10px;color:#94a3b8;">(' + players + ' чел)</span>';
    
    if (sEl && buckets.total > 0) {
      var p11 = ((buckets.lt_1_10 / buckets.total) * 100).toFixed(1);
      var p15 = ((buckets.lt_1_50 / buckets.total) * 100).toFixed(1);
      var p10 = ((buckets.gt_10_0 / buckets.total) * 100).toFixed(1);
      sEl.innerHTML = '< 1.10: <b>' + p11 + '%</b> | < 1.50: <b>' + p15 + '%</b> | > 10x: <b>' + p10 + '%</b>';
    }
  }

  document.getElementById('v10-stat-btn').onclick = function(){
    if (!rounds.length) return alert('Раунды еще не зафиксированы!');
    var avgPlayers = Math.round(rounds.reduce(function(a,b){return a+b.players_peak;},0)/rounds.length);
    alert('📊 СТАТИСТИКА:\n\n' +
          ' • Раундов собрано: ' + rounds.length + '\n' +
          ' • Средний онлайн: ' + avgPlayers + ' чел.\n' +
          ' • < 1.10x: ' + ((buckets.lt_1_10/buckets.total)*100).toFixed(1) + '%\n' +
          ' • < 1.50x: ' + ((buckets.lt_1_50/buckets.total)*100).toFixed(1) + '%\n' +
          ' • >= 10.0x: ' + ((buckets.gt_10_0/buckets.total)*100).toFixed(1) + '%\n\n' +
          'Серия без 10x: ' + streakCount + ' раундов подряд');
  };

  document.getElementById('v10-save').onclick = function(){
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
    a.download = 'aviatrix_whale_pnl_dataset_' + Date.now() + '.json';
    a.click();
  };

  document.getElementById('v10-clr').onclick = function(){
    rounds = [];
    buckets = { total:0, instant_1_00:0, lt_1_10:0, lt_1_30:0, lt_1_50:0, gt_3_00:0, gt_5_00:0, gt_10_0:0, gt_50_0:0, gt_100_:0 };
    streakCount = 0;
    streakSum = 0;
    peakPlayers = 0;
    updateHUD(0, 0);
  };
})();
