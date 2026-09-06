javascript:(function(){
  window.__avtrxDossierV12 = false;
  if (window.__avtrxAutopilotV13) {
    alert('Autopilot v13 уже запущен!');
    return;
  }
  window.__avtrxAutopilotV13 = true;

  var rounds = [];
  var playerDossier = {}; 
  var targetPlayer = 'Porceh'; // Имя для персональной слежки
  var targetStats = { bets: 0, wagered: 0, won: 0, pnl: 0 };

  var lastLeadText = '';
  var streakCount = 0;
  var streakSum = 0;
  var lastCrashTs = Date.now();
  var peakPlayers = 0;

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

  // --- 1. АВТОМАТИЧЕСКОЕ РАСКРЫТИЕ ШТОРКИ УЧАСТНИКОВ ---
  setInterval(function(){
    var expandBtn = document.querySelector('.flight-radar-arrow-expand') || document.querySelector('.flight-radar-participants');
    // Проверяем, видна ли шторка со ставками
    var rows = document.querySelectorAll('.layout [class*="overflow"] > div');
    if (rows.length < 5 && expandBtn) {
      expandBtn.click(); // Авто-клик для открытия списка!
    }
    
    // Радар онлайна
    var pEl = document.querySelector('.flight-radar-participants-count');
    if (pEl) {
      var n = parseInt(pEl.textContent.trim(), 10);
      if (!isNaN(n) && n > peakPlayers) peakPlayers = n;
    }
  }, 500);

  // --- 2. ПРЯМОЙ ПАРСИНГ НИКОВ И СТАВОК ИЗ СТРОК ШТОРКИ ---
  function harvestDOMWhales() {
    var extracted = [];
    var rows = document.querySelectorAll('.layout [class*="overflow"] > div');
    
    rows.forEach(function(r){
      var text = (r.innerText || r.textContent || '').trim();
      var lines = text.split('\n').map(function(s){ return s.trim(); }).filter(Boolean);
      
      // Формат строки: [Ник, Ставка (напр. 31.83K), Множитель (напр. 1.51x или -), Выплата]
      if (lines.length >= 3) {
        var name = lines[0];
        var betRaw = lines[1].replace('K', '000').replace('₽', '').replace(/[^\d.]/g, '');
        var multRaw = lines[2].replace('x', '').trim();
        var winRaw = lines[3] ? lines[3].replace('K', '000').replace('₽', '').replace(/[^\d.]/g, '') : '0';

        var bet = parseFloat(betRaw) || 0;
        var mult = parseFloat(multRaw) || 0;
        var payout = parseFloat(winRaw) || 0;

        if (bet > 0) {
          extracted.push({
            name: name,
            bet: bet,
            mult: mult,
            payout: payout,
            profit: +(payout - bet).toFixed(2)
          });

          // Слежка за целевым игроком (Porceh)
          if (name.toLowerCase().includes(targetPlayer.toLowerCase())) {
            targetStats.bets++;
            targetStats.wagered = +(targetStats.wagered + bet).toFixed(2);
            targetStats.won = +(targetStats.won + payout).toFixed(2);
            targetStats.pnl = +(targetStats.won - targetStats.wagered).toFixed(2);
          }

          // Пополнение досье
          if (!playerDossier[name]) {
            playerDossier[name] = {
              name: name,
              total_bets: 0,
              total_wagered: 0,
              total_won: 0,
              net_pnl: 0,
              cashouts: []
            };
          }
          var pd = playerDossier[name];
          pd.total_bets++;
          pd.total_wagered = +(pd.total_wagered + bet).toFixed(2);
          pd.total_won = +(pd.total_won + payout).toFixed(2);
          pd.net_pnl = +(pd.total_won - pd.total_wagered).toFixed(2);
          if (mult > 0) pd.cashouts.push(mult);
        }
      }
    });

    return extracted;
  }

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

    var currentWhales = harvestDOMWhales();

    rounds.push({
      round_num: rounds.length + 1,
      ts: now,
      multiplier: m,
      cycle_sec: cycleTotal,
      flight_sec: flightSec,
      pause_sec: pauseSec,
      players_online: peakPlayers || 2000,
      streak_before_10x: gapInfo,
      whales_captured: currentWhales
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
  var old = document.getElementById('avtrx-v13-hud');
  if (old) old.remove();

  var hud = document.createElement('div');
  hud.id = 'avtrx-v13-hud';
  hud.style.cssText = 'position:fixed;bottom:10px;left:4%;width:92%;background:#090d16;color:#fff;border:2px solid #22c55e;border-radius:10px;padding:8px 12px;z-index:2147483647;font-family:monospace;font-size:11px;box-shadow:0 0 25px rgba(0,0,0,0.9);';
  
  hud.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                  '<span style="color:#4ade80;font-weight:bold;">✈ AUTOPILOT v13</span>' +
                  '<span id="v13-status" style="color:#facc15;font-weight:bold;font-size:12px;">Слежу...</span>' +
                  '<b id="v13-cnt" style="color:#38bdf8;font-size:12px;">0 R</b>' +
                  '</div>' +
                  '<div id="v13-target-info" style="font-size:10px;color:#38bdf8;margin-bottom:6px;">' +
                  '🎯 Цель [' + targetPlayer + ']: жду ставку...' +
                  '</div>' +
                  '<div style="display:flex;gap:6px;">' +
                  '<button id="v13-save" style="flex:1;background:#16a34a;color:#fff;border:none;padding:6px;border-radius:4px;font-weight:bold;cursor:pointer;">💾 СКАЧАТЬ ВСЮ БАЗУ</button>' +
                  '<button id="v13-target-btn" style="background:#0284c7;color:#fff;border:none;padding:6px 8px;border-radius:4px;cursor:pointer;">🎯 СЛЕЖКА</button>' +
                  '<button id="v13-clr" style="background:#475569;color:#fff;border:none;padding:6px 8px;border-radius:4px;cursor:pointer;">🧹</button>' +
                  '</div>';
  document.body.appendChild(hud);

  function updateHUD(lastM, flightSec, players){
    var cEl = document.getElementById('v13-cnt');
    var sEl = document.getElementById('v13-status');
    var tEl = document.getElementById('v13-target-info');

    if (cEl) cEl.textContent = rounds.length + ' R';
    if (sEl && lastM) sEl.innerHTML = lastM.toFixed(2) + 'x (' + flightSec + 'с | ' + players + ' чел)';
    
    if (tEl) {
      var pnlStr = targetStats.pnl >= 0 ? '+' + targetStats.pnl : targetStats.pnl;
      tEl.innerHTML = '🎯 <b>' + targetPlayer + '</b>: ставок ' + targetStats.bets + ' | PnL: <b style="color:' + (targetStats.pnl >= 0 ? '#4ade80' : '#f87171') + '">' + pnlStr + ' ₽</b>';
    }
  }

  // Кнопка смены цели слежки
  document.getElementById('v13-target-btn').onclick = function(){
    var newTarget = prompt('Введите ник игрока для персональной слежки:', targetPlayer);
    if (newTarget) {
      targetPlayer = newTarget.trim();
      targetStats = { bets: 0, wagered: 0, won: 0, pnl: 0 };
      document.getElementById('v13-target-info').textContent = '🎯 Цель [' + targetPlayer + ']: жду ставку...';
    }
  };

  document.getElementById('v13-save').onclick = function(){
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
    a.download = 'aviatrix_autopilot_v13_' + Date.now() + '.json';
    a.click();
  };

  document.getElementById('v13-clr').onclick = function(){
    rounds = [];
    playerDossier = {};
    targetStats = { bets: 0, wagered: 0, won: 0, pnl: 0 };
    updateHUD(0, 0, 0);
  };
})();
