javascript:(function(){
  window.__avtrxAutopilotV13 = false;
  if (window.__avtrxStealthV14) {
    alert('Stealth v14 уже активен!');
    return;
  }
  window.__avtrxStealthV14 = true;

  var rounds = [];
  var playerDossier = {};
  var targetPlayer = 'Porceh';
  var targetStats = { bets: 0, wagered: 0, won: 0, pnl: 0 };

  var lastLeadText = '';
  var streakCount = 0;
  var streakSum = 0;
  var lastCrashTs = Date.now();
  var peakPlayers = 0;
  var lastValidWhales = [];

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

  // --- 1. ОБХОД АНТИБОТА ЧЕРЕЗ СИМУЛЯЦИЮ ТАЧ-КАСАНИЯ ПАЛЬЦА ---
  function simulateMobileTouch(el) {
    if (!el) return;
    try {
      var rect = el.getBoundingClientRect();
      var touchObj = new Touch({
        identifier: Date.now(),
        target: el,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        radiusX: 5, radiusY: 5, rotationAngle: 0, force: 1
      });
      el.dispatchEvent(new TouchEvent('touchstart', { touches: [touchObj], targetTouches: [touchObj], changedTouches: [touchObj], bubbles: true, cancelable: true }));
      el.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [touchObj], bubbles: true, cancelable: true }));
    } catch(e) {
      el.click();
    }
  }

  setInterval(function(){
    var expandBtn = document.querySelector('.flight-radar-arrow-expand') || document.querySelector('.flight-radar-participants');
    // Проверяем наличие настоящих строк участников (отсекая панели ставок)
    var realRows = document.querySelectorAll('.layout [class*="overflow"] > div:not(.bet-panel):not(.bet-preset)');
    if (realRows.length < 3 && expandBtn) {
      simulateMobileTouch(expandBtn);
    }

    var pEl = document.querySelector('.flight-radar-participants-count');
    if (pEl) {
      var n = parseInt(pEl.textContent.trim(), 10);
      if (!isNaN(n) && n > peakPlayers) peakPlayers = n;
    }
  }, 600);

  // --- 2. ПАРСИНГ РЕАЛЬНЫХ УЧАСТНИКОВ (БЕЗ КНОПОК ПАНЕЛЕЙ) ---
  function parseRealWhales() {
    var list = [];
    // Ищем строки в контейнере участников
    var rows = document.querySelectorAll('.layout [class*="overflow"] > div');

    rows.forEach(function(r){
      // Отсекаем панель ставок и кнопки
      if (r.closest('.bet-panel') || r.closest('.bet-preset') || r.querySelector('.button-primary')) return;

      var txt = (r.innerText || r.textContent || '').trim();
      var lines = txt.split('\n').map(function(s){ return s.trim(); }).filter(Boolean);

      // Исключаем кнопки со знаком ₽
      if (lines.length >= 3 && lines[0] !== '₽' && !lines[0].includes('Place bet')) {
        var name = lines[0];
        var betRaw = lines[1].replace('K', '000').replace('₽', '').replace(/[^\d.]/g, '');
        var multRaw = lines[2].replace('x', '').trim();
        var winRaw = lines[3] ? lines[3].replace('K', '000').replace('₽', '').replace(/[^\d.]/g, '') : '0';

        var bVal = parseFloat(betRaw) || 0;
        var mVal = parseFloat(multRaw) || 0;
        var pVal = parseFloat(winRaw) || 0;

        if (bVal >= 10) { // Исключаем мусор
          list.push({
            name: name,
            bet: bVal,
            mult: mVal,
            payout: pVal,
            profit: +(pVal - bVal).toFixed(2)
          });

          // Слежка за целью
          if (name.toLowerCase().includes(targetPlayer.toLowerCase())) {
            targetStats.bets++;
            targetStats.wagered = +(targetStats.wagered + bVal).toFixed(2);
            targetStats.won = +(targetStats.won + pVal).toFixed(2);
            targetStats.pnl = +(targetStats.won - targetStats.wagered).toFixed(2);
          }

          // Досье
          if (!playerDossier[name]) {
            playerDossier[name] = { name: name, bets: 0, wagered: 0, won: 0, pnl: 0, cashouts: [] };
          }
          var pd = playerDossier[name];
          pd.bets++;
          pd.wagered = +(pd.wagered + bVal).toFixed(2);
          pd.won = +(pd.won + pVal).toFixed(2);
          pd.pnl = +(pd.won - pd.wagered).toFixed(2);
          if (mVal > 0) pd.cashouts.push(mVal);
        }
      }
    });

    if (list.length > 0) lastValidWhales = list;
    return lastValidWhales;
  }

  // Сетевой перехват
  var origFetch = window.fetch;
  window.fetch = async function(){
    var res = await origFetch.apply(this, arguments);
    var urlStr = arguments[0] ? (typeof arguments[0] === 'string' ? arguments[0] : arguments[0].url || '') : '';
    if (urlStr.includes('GetParticipants')) {
      try {
        res.clone().json().then(function(d){
          if (d.participants && d.participants.length) {
            d.participants.forEach(function(p){
              var pName = p.assetsInfo ? p.assetsInfo.name : 'Anonymous';
              var b = +(p.betAmount || p.amount || 0);
              var w = +(p.winAmount || 0);
              var m = +(p.odds || 0);

              if (pName.toLowerCase().includes(targetPlayer.toLowerCase())) {
                targetStats.bets++;
                targetStats.wagered = +(targetStats.wagered + b).toFixed(2);
                targetStats.won = +(targetStats.won + w).toFixed(2);
                targetStats.pnl = +(targetStats.won - targetStats.wagered).toFixed(2);
              }
            });
          }
        }).catch(function(){});
      } catch(e){}
    }
    return res;
  };

  function recordRound(m) {
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

    var whales = parseRealWhales();

    rounds.push({
      round_num: rounds.length + 1,
      ts: now,
      multiplier: m,
      cycle_sec: cycleTotal,
      flight_sec: flightSec,
      pause_sec: pauseSec,
      players_online: peakPlayers || 2500,
      streak_before_10x: gapInfo,
      whales_count: whales.length,
      whales: whales.slice(0, 30)
    });

    peakPlayers = 0;
    updateHUD(m, flightSec, rounds[rounds.length-1].players_online);
  }

  // Поллинг ленты истории
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
          recordRound(m);
        }
      }
    }
  }, 200);

  // HUD
  var old = document.getElementById('avtrx-v14-hud');
  if (old) old.remove();

  var hud = document.createElement('div');
  hud.id = 'avtrx-v14-hud';
  hud.style.cssText = 'position:fixed;bottom:10px;left:4%;width:92%;background:#090d16;color:#fff;border:2px solid #38bdf8;border-radius:10px;padding:8px 12px;z-index:2147483647;font-family:monospace;font-size:11px;box-shadow:0 0 25px rgba(0,0,0,0.9);';
  
  hud.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                  '<span style="color:#38bdf8;font-weight:bold;">✈ STEALTH v14</span>' +
                  '<span id="v14-status" style="color:#facc15;font-weight:bold;font-size:12px;">Слежу...</span>' +
                  '<b id="v14-cnt" style="color:#4ade80;font-size:12px;">0 R</b>' +
                  '</div>' +
                  '<div id="v14-target-info" style="font-size:10px;color:#38bdf8;margin-bottom:6px;">' +
                  '🎯 Цель [' + targetPlayer + ']: жду ставку...' +
                  '</div>' +
                  '<div style="display:flex;gap:4px;">' +
                  '<button id="v14-save" style="flex:1;background:#16a34a;color:#fff;border:none;padding:6px;border-radius:4px;font-weight:bold;cursor:pointer;">💾 СКАЧАТЬ</button>' +
                  '<button id="v14-check-btn" style="background:#0284c7;color:#fff;border:none;padding:6px 8px;border-radius:4px;cursor:pointer;">🔍 КТО В ЛИСТЕ?</button>' +
                  '<button id="v14-target-btn" style="background:#8b5cf6;color:#fff;border:none;padding:6px 8px;border-radius:4px;cursor:pointer;">🎯</button>' +
                  '<button id="v14-clr" style="background:#475569;color:#fff;border:none;padding:6px 8px;border-radius:4px;cursor:pointer;">🧹</button>' +
                  '</div>';
  document.body.appendChild(hud);

  function updateHUD(lastM, flightSec, players){
    var cEl = document.getElementById('v14-cnt');
    var sEl = document.getElementById('v14-status');
    var tEl = document.getElementById('v14-target-info');

    if (cEl) cEl.textContent = rounds.length + ' R';
    if (sEl && lastM) sEl.innerHTML = lastM.toFixed(2) + 'x (' + flightSec + 'с | ' + players + ' чел)';
    
    if (tEl) {
      var pnlStr = targetStats.pnl >= 0 ? '+' + targetStats.pnl : targetStats.pnl;
      tEl.innerHTML = '🎯 <b>' + targetPlayer + '</b>: ставок ' + targetStats.bets + ' | PnL: <b style="color:' + (targetStats.pnl >= 0 ? '#4ade80' : '#f87171') + '">' + pnlStr + ' ₽</b>';
    }
  }

  // Кнопка быстрой проверки: кого прямо сейчас видит скрипт
  document.getElementById('v14-check-btn').onclick = function(){
    var current = parseRealWhales();
    if (!current.length) return alert('Список пуст! Попробуйте приоткрыть шторку пальцем.');
    var msg = '👀 СЕЙЧАС В ПАМЯТИ (' + current.length + ' ставок):\n\n';
    current.slice(0, 8).forEach(function(p, i){
      msg += (i+1) + '. ' + p.name + ': ' + p.bet + ' ₽ (кэшаут: ' + (p.mult ? p.mult + 'x' : '-') + ')\n';
    });
    alert(msg);
  };

  document.getElementById('v14-target-btn').onclick = function(){
    var n = prompt('Ник игрока для слежки:', targetPlayer);
    if (n) {
      targetPlayer = n.trim();
      targetStats = { bets: 0, wagered: 0, won: 0, pnl: 0 };
      document.getElementById('v14-target-info').textContent = '🎯 Цель [' + targetPlayer + ']: жду ставку...';
    }
  };

  document.getElementById('v14-save').onclick = function(){
    if (!rounds.length) return alert('Выборка пуста!');
    var payload = {
      exportedAt: new Date().toISOString(),
      game: 'Aviatrix',
      totalRounds: rounds.length,
      trackedTarget: { name: targetPlayer, stats: targetStats },
      playerDossier: playerDossier,
      rounds: rounds
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'aviatrix_stealth_v14_' + Date.now() + '.json';
    a.click();
  };

  document.getElementById('v14-clr').onclick = function(){
    rounds = [];
    playerDossier = {};
    targetStats = { bets: 0, wagered: 0, won: 0, pnl: 0 };
    updateHUD(0, 0, 0);
  };
})();
