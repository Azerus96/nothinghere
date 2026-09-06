javascript:(function(){
  window.__avtrxStealthV14 = false;
  window.__avtrxOpticalV15 = false;
  if (window.__avtrxRadarV16) {
    alert('Radar v16 уже активен!');
    return;
  }
  window.__avtrxRadarV16 = true;

  var rounds = [];
  var playerDossier = {};
  var targetPlayer = 'Porceh';
  var targetFound = false;
  var targetStats = { bets: 0, wagered: 0, won: 0, pnl: 0, lastBet: 0, lastMult: 0 };

  var lastLeadText = '';
  var streakCount = 0;
  var streakSum = 0;
  var lastCrashTs = Date.now();
  var peakPlayers = 0;
  var cachedWhales = [];

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

  // Непрерывный радар онлайна (✈ 1127)
  setInterval(function(){
    var pEl = document.querySelector('.flight-radar-participants-count');
    if (pEl) {
      var n = parseInt(pEl.textContent.trim(), 10);
      if (!isNaN(n) && n > peakPlayers) peakPlayers = n;
    }
  }, 200);

  // --- БРОНЕБОЙНЫЙ ПОИСК СТРОК ИГРОКОВ ПО ЯКОРНОМУ СИМВОЛУ ---
  function extractWhalesByAnchor() {
    var extracted = [];
    var all = document.querySelectorAll('*');
    var anchorRow = null;

    // Шаг 1: Ищем хотя бы один элемент со множителем со скриншота (например "1.33x" или "-")
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.closest('#avtrx-v16-hud') || el.closest('.bottom-odds-history') || el.closest('.bet-panel')) continue;
      
      if (el.children.length === 0 && el.textContent) {
        var txt = el.textContent.trim();
        // Ищем якорный кэшаут вида "1.33x" или "2.00x"
        if (/^\d+\.\d{2}x$/i.test(txt)) {
          // Находим строку-родитель
          var p = el.parentElement;
          if (p && p.textContent && (p.textContent.includes('K') || p.textContent.includes('₽'))) {
            anchorRow = p;
            break;
          }
        }
      }
    }

    // Шаг 2: Если строка найдена, берем всех ее соседей (это и есть весь список участников)
    if (anchorRow && anchorRow.parentElement) {
      var rowList = anchorRow.parentElement.children;
      for (var r = 0; r < rowList.length; r++) {
        var rowEl = rowList[r];
        var rowText = (rowEl.innerText || rowEl.textContent || '').trim();
        var words = rowText.split(/\s+/).filter(Boolean);

        if (words.length >= 3) {
          var pName = words[0];
          if (pName === '₽' || pName.includes('Place')) continue;

          // Ищем ставку (с K или число)
          var betStr = words.find(function(w){ return /^\d+(\.\d+)?K$/i.test(w) || /^\d+₽?$/.test(w); }) || '0';
          var multStr = words.find(function(w){ return /^\d+(\.\d+)?x$/i.test(w); }) || '-';
          var winStr = words[words.length - 1];

          var bVal = parseFloat(betStr.replace('K', '000').replace(/[^\d.]/g, '')) || 0;
          var mVal = multStr === '-' ? 0 : (parseFloat(multStr.replace('x', '')) || 0);
          var wVal = (winStr === '-' || !winStr) ? 0 : (parseFloat(winStr.replace('K', '000').replace(/[^\d.]/g, '')) || 0);

          if (bVal >= 10) {
            extracted.push({
              name: pName,
              bet: bVal,
              mult: mVal,
              payout: wVal,
              profit: +(wVal - bVal).toFixed(2),
              in_flight: multStr === '-'
            });

            // Слежка за Porceh
            if (pName.toLowerCase().includes(targetPlayer.toLowerCase())) {
              targetFound = true;
              targetStats.bets++;
              targetStats.lastBet = bVal;
              targetStats.lastMult = mVal;
              targetStats.wagered = +(targetStats.wagered + bVal).toFixed(2);
              targetStats.won = +(targetStats.won + wVal).toFixed(2);
              targetStats.pnl = +(targetStats.won - targetStats.wagered).toFixed(2);
            }

            // Досье игроков
            if (!playerDossier[pName]) {
              playerDossier[pName] = { name: pName, bets: 0, wagered: 0, won: 0, pnl: 0, cashouts: [] };
            }
            var d = playerDossier[pName];
            d.bets++;
            d.wagered = +(d.wagered + bVal).toFixed(2);
            d.won = +(d.won + wVal).toFixed(2);
            d.pnl = +(d.won - d.wagered).toFixed(2);
            if (mVal > 0) d.cashouts.push(mVal);
          }
        }
      }
    }

    if (extracted.length > 0) cachedWhales = extracted;
    return cachedWhales;
  }

  // Опрос участников каждые 250 мс
  setInterval(function(){
    var list = extractWhalesByAnchor();
    var stEl = document.getElementById('v16-whales-stat');
    if (stEl) {
      stEl.textContent = 'Игроков в памяти: ' + list.length;
      stEl.style.color = list.length > 0 ? '#4ade80' : '#f87171';
    }
  }, 250);

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

    var whalesNow = extractWhalesByAnchor();

    rounds.push({
      round_num: rounds.length + 1,
      ts: now,
      multiplier: m,
      cycle_sec: cycleTotal,
      flight_sec: flightSec,
      pause_sec: pauseSec,
      players_online: peakPlayers || 1500,
      streak_before_10x: gapInfo,
      whales_count: whalesNow.length,
      whales: whalesNow.slice(0, 40)
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
  var old = document.getElementById('avtrx-v16-hud');
  if (old) old.remove();

  var hud = document.createElement('div');
  hud.id = 'avtrx-v16-hud';
  hud.style.cssText = 'position:fixed;bottom:10px;left:4%;width:92%;background:#090d16;color:#fff;border:2px solid #38bdf8;border-radius:10px;padding:8px 12px;z-index:2147483647;font-family:monospace;font-size:11px;box-shadow:0 0 25px rgba(0,0,0,0.9);';
  
  hud.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                  '<span style="color:#38bdf8;font-weight:bold;">✈ RADAR v16</span>' +
                  '<span id="v16-status" style="color:#facc15;font-weight:bold;font-size:12px;">Слежу...</span>' +
                  '<b id="v16-cnt" style="color:#4ade80;font-size:12px;">0 R</b>' +
                  '</div>' +
                  '<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:6px;">' +
                  '<span id="v16-whales-stat" style="color:#f87171;">Игроков в памяти: 0</span>' +
                  '<span id="v16-target-stat" style="color:#38bdf8;">🎯 ' + targetPlayer + ': жду...</span>' +
                  '</div>' +
                  '<div style="display:flex;gap:4px;">' +
                  '<button id="v16-save" style="flex:1;background:#16a34a;color:#fff;border:none;padding:6px;border-radius:4px;font-weight:bold;cursor:pointer;">💾 СКАЧАТЬ</button>' +
                  '<button id="v16-check-btn" style="background:#0284c7;color:#fff;border:none;padding:6px 8px;border-radius:4px;cursor:pointer;">🔍 КТО В ПАМЯТИ?</button>' +
                  '<button id="v16-clr" style="background:#475569;color:#fff;border:none;padding:6px 8px;border-radius:4px;cursor:pointer;">🧹</button>' +
                  '</div>';
  document.body.appendChild(hud);

  function updateHUD(lastM, flightSec, players){
    var cEl = document.getElementById('v16-cnt');
    var sEl = document.getElementById('v16-status');
    var tEl = document.getElementById('v16-target-stat');

    if (cEl) cEl.textContent = rounds.length + ' R';
    if (sEl && lastM) sEl.innerHTML = lastM.toFixed(2) + 'x (' + flightSec + 'с | ' + players + ' чел)';
    
    if (tEl) {
      if (targetFound) {
        var pnlStr = targetStats.pnl >= 0 ? '+' + targetStats.pnl : targetStats.pnl;
        tEl.innerHTML = '🎯 <b>' + targetPlayer + '</b>: <b style="color:' + (targetStats.pnl >= 0 ? '#4ade80' : '#f87171') + '">' + pnlStr + ' ₽</b> (' + targetStats.bets + ' ст)';
      } else {
        tEl.innerHTML = '🎯 ' + targetPlayer + ': жду ставку...';
      }
    }
  }

  // Кнопка моментальной проверки
  document.getElementById('v16-check-btn').onclick = function(){
    var list = extractWhalesByAnchor();
    if (!list.length) return alert('Список игроков пока не привязался. Откройте шторку участников пальцем на 2-3 секунды!');
    var msg = '👀 СЕЙЧАС В ПАМЯТИ (' + list.length + ' игроков):\n\n';
    list.slice(0, 7).forEach(function(p, i){
      var st = p.in_flight ? 'В полете' : (p.mult + 'x -> ' + p.payout + '₽');
      msg += (i+1) + '. ' + p.name + ' | ' + p.bet + ' ₽ | ' + st + '\n';
    });
    alert(msg);
  };

  document.getElementById('v16-save').onclick = function(){
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
    a.download = 'aviatrix_radar_v16_' + Date.now() + '.json';
    a.click();
  };

  document.getElementById('v16-clr').onclick = function(){
    rounds = [];
    playerDossier = {};
    cachedWhales = [];
    targetStats = { bets: 0, wagered: 0, won: 0, pnl: 0, lastBet: 0, lastMult: 0 };
    targetFound = false;
    updateHUD(0, 0, 0);
  };
})();
