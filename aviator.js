javascript:(function(){
  window.__avtrxTurboV18 = false;
  if (window.__avtrxInstantV19) {
    alert('Instant v19 уже работает!');
    return;
  }
  window.__avtrxInstantV19 = true;

  var rounds = [];
  var playerDossier = {};
  var targetPlayer = 'Porceh';
  var targetStats = { bets: 0, wagered: 0, won: 0, pnl: 0 };

  var lastLeadText = '';
  var streakCount = 0;
  var streakSum = 0;
  var lastCrashTs = Date.now();
  var peakPlayers = 0;

  var currentFlightWhales = new Map();
  var seenBetsInCurrentRound = new Set();

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

  function parseMoney(s) {
    if (!s) return 0;
    var clean = String(s).replace('₽', '').trim();
    if (/K$/i.test(clean)) {
      return +(parseFloat(clean.replace(/K$/i, '')) * 1000).toFixed(2);
    }
    return +(parseFloat(clean.replace(/[^\d.]/g, '')) || 0).toFixed(2);
  }

  // Радар онлайна (✈)
  setInterval(function(){
    var pEl = document.querySelector('.flight-radar-participants-count');
    if (pEl) {
      var n = parseInt(pEl.textContent.trim(), 10);
      if (!isNaN(n) && n > peakPlayers) peakPlayers = n;
    }
  }, 200);

  function registerPlayerBet(name, bet, mult, payout, isCashout) {
    if (!name || name === '₽' || bet <= 0) return;
    var betKey = name + '_' + bet;

    currentFlightWhales.set(betKey, {
      name: name,
      bet: bet,
      mult: mult,
      payout: payout,
      profit: +(payout - bet).toFixed(2),
      status: isCashout ? 'STATUS_CASHOUT' : 'STATUS_PENDING'
    });

    if (!seenBetsInCurrentRound.has(betKey)) {
      seenBetsInCurrentRound.add(betKey);
      if (!playerDossier[name]) {
        playerDossier[name] = { name: name, bets: 0, wagered: 0, won: 0, pnl: 0, cashouts: [] };
      }
      var pd = playerDossier[name];
      pd.bets++;
      pd.wagered = +(pd.wagered + bet).toFixed(2);

      if (name.toLowerCase().includes(targetPlayer.toLowerCase())) {
        targetStats.bets++;
        targetStats.wagered = +(targetStats.wagered + bet).toFixed(2);
      }
    }

    if (isCashout && payout > 0) {
      var pdWin = playerDossier[name];
      if (pdWin) {
        pdWin.won = +(pdWin.won + payout).toFixed(2);
        pdWin.pnl = +(pdWin.won - pdWin.wagered).toFixed(2);
        if (mult > 0 && pdWin.cashouts.indexOf(mult) === -1) {
          pdWin.cashouts.push(mult);
        }
      }
      if (name.toLowerCase().includes(targetPlayer.toLowerCase())) {
        targetStats.won = +(targetStats.won + payout).toFixed(2);
        targetStats.pnl = +(targetStats.won - targetStats.wagered).toFixed(2);
      }
    }
  }

  // --- МГНОВЕННЫЙ ЗАХВАТ ВСЕХ ИГРОКОВ (ВКЛЮЧАЯ ТИРЕ —/–/-) ---
  function scanAllWhalesInstant() {
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.closest('#avtrx-v19-hud') || el.closest('.bottom-odds-history') || el.closest('.bet-panel')) continue;

      if (el.children.length === 0 && el.textContent) {
        var txt = el.textContent.trim();
        // Ловит множитель 1.50x ИЛИ ЛЮБОЕ ТИРЕ (—, –, −, -)
        if (/^\d+(\.\d+)?x$/i.test(txt) || /^[—–−-]$/.test(txt)) {
          var row = el.parentElement;
          while (row && row.children.length < 3 && row.parentElement && !row.parentElement.classList.contains('app-root')) {
            row = row.parentElement;
          }
          if (row && row.children.length >= 3) {
            var colTexts = [];
            var colNodes = row.querySelectorAll('*');
            for (var c = 0; c < colNodes.length; c++) {
              if (colNodes[c].children.length === 0) {
                var cTxt = colNodes[c].textContent.trim();
                if (cTxt) colTexts.push(cTxt);
              }
            }
            var mIdx = colTexts.findIndex(function(t){ return /^\d+(\.\d+)?x$/i.test(t) || /^[—–−-]$/.test(t); });
            if (mIdx >= 2) {
              var multStr = colTexts[mIdx];
              var betStr = colTexts[mIdx - 1];
              var nameStr = colTexts.slice(0, mIdx - 1).join(' ').trim();
              var winStr = colTexts[mIdx + 1] || '-';

              var isDash = /^[—–−-]$/.test(multStr);
              var bVal = parseMoney(betStr);
              var mVal = isDash ? 0 : (parseFloat(multStr.replace('x', '')) || 0);
              var wVal = isDash ? 0 : parseMoney(winStr);

              if (bVal >= 10 && nameStr && nameStr !== '₽') {
                registerPlayerBet(nameStr, bVal, mVal, wVal, !isDash);
              }
            }
          }
        }
      }
    }

    var stEl = document.getElementById('v19-whales-stat');
    if (stEl) {
      stEl.textContent = 'В базе полета: ' + currentFlightWhales.size + ' чел';
      stEl.style.color = currentFlightWhales.size >= 20 ? '#4ade80' : (currentFlightWhales.size > 0 ? '#facc15' : '#f87171');
    }
  }

  // Сканируем 5 раз в секунду
  setInterval(scanAllWhalesInstant, 200);

  // Сетевой перехват GetParticipants
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
              registerPlayerBet(pName, b, m, w, p.status === 'STATUS_CASHOUT' || w > 0);
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

    var roundWhales = Array.from(currentFlightWhales.values());

    rounds.push({
      round_num: rounds.length + 1,
      ts: now,
      multiplier: m,
      cycle_sec: cycleTotal,
      flight_sec: flightSec,
      pause_sec: pauseSec,
      players_online: peakPlayers || 1500,
      streak_before_10x: gapInfo,
      whales_count: roundWhales.length,
      whales: roundWhales
    });

    currentFlightWhales.clear();
    seenBetsInCurrentRound.clear();
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
  var old = document.getElementById('avtrx-v19-hud');
  if (old) old.remove();

  var hud = document.createElement('div');
  hud.id = 'avtrx-v19-hud';
  hud.style.cssText = 'position:fixed;bottom:10px;left:4%;width:92%;background:#090d16;color:#fff;border:2px solid #38bdf8;border-radius:10px;padding:8px 12px;z-index:2147483647;font-family:monospace;font-size:11px;box-shadow:0 0 25px rgba(0,0,0,0.9);';
  
  hud.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                  '<span style="color:#38bdf8;font-weight:bold;">✈ INSTANT v19</span>' +
                  '<span id="v19-status" style="color:#facc15;font-weight:bold;font-size:12px;">Слежу...</span>' +
                  '<b id="v19-cnt" style="color:#4ade80;font-size:12px;">0 R</b>' +
                  '</div>' +
                  '<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:6px;">' +
                  '<span id="v19-whales-stat" style="color:#f87171;">В базе полета: 0 чел</span>' +
                  '<span id="v19-target-stat" style="color:#38bdf8;">🎯 ' + targetPlayer + ': жду...</span>' +
                  '</div>' +
                  '<div style="display:flex;gap:4px;">' +
                  '<button id="v19-save" style="flex:1;background:#16a34a;color:#fff;border:none;padding:6px;border-radius:4px;font-weight:bold;cursor:pointer;">💾 СКАЧАТЬ</button>' +
                  '<button id="v19-check-btn" style="background:#0284c7;color:#fff;border:none;padding:6px 8px;border-radius:4px;cursor:pointer;">🔍 КТО В БАЗЕ?</button>' +
                  '<button id="v19-target-btn" style="background:#8b5cf6;color:#fff;border:none;padding:6px 8px;border-radius:4px;cursor:pointer;">🎯</button>' +
                  '<button id="v19-clr" style="background:#475569;color:#fff;border:none;padding:6px 8px;border-radius:4px;cursor:pointer;">🧹</button>' +
                  '</div>';
  document.body.appendChild(hud);

  function updateHUD(lastM, flightSec, players){
    var cEl = document.getElementById('v19-cnt');
    var sEl = document.getElementById('v19-status');
    var tEl = document.getElementById('v19-target-stat');

    if (cEl) cEl.textContent = rounds.length + ' R';
    if (sEl && lastM) sEl.innerHTML = lastM.toFixed(2) + 'x (' + flightSec + 'с | ' + players + ' чел)';
    
    if (tEl) {
      var pnlStr = targetStats.pnl >= 0 ? '+' + targetStats.pnl : targetStats.pnl;
      tEl.innerHTML = '🎯 <b>' + targetPlayer + '</b>: <b style="color:' + (targetStats.pnl >= 0 ? '#4ade80' : '#f87171') + '">' + pnlStr + ' ₽</b> (' + targetStats.bets + ' ст)';
    }
  }

  document.getElementById('v19-check-btn').onclick = function(){
    var arr = Array.from(currentFlightWhales.values());
    if (!arr.length) return alert('Список пуст. Убедитесь, что шторка открыта пальцем!');
    var msg = '👀 СЕЙЧАС В БАЗЕ (' + arr.length + ' игроков):\n\n';
    arr.slice(0, 10).forEach(function(p, i){
      var st = p.status === 'STATUS_CASHOUT' ? (p.mult + 'x -> ' + p.payout + '₽') : 'В полете (—)';
      msg += (i+1) + '. ' + p.name + ' | ' + p.bet + ' ₽ | ' + st + '\n';
    });
    alert(msg);
  };

  document.getElementById('v19-target-btn').onclick = function(){
    var n = prompt('Ник для слежки:', targetPlayer);
    if (n) {
      targetPlayer = n.trim();
      targetStats = { bets: 0, wagered: 0, won: 0, pnl: 0 };
      document.getElementById('v19-target-stat').textContent = '🎯 ' + targetPlayer + ': жду...';
    }
  };

  document.getElementById('v19-save').onclick = function(){
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
    a.download = 'aviatrix_instant_v19_' + Date.now() + '.json';
    a.click();
  };

  document.getElementById('v19-clr').onclick = function(){
    rounds = [];
    playerDossier = {};
    currentFlightWhales.clear();
    seenBetsInCurrentRound.clear();
    targetStats = { bets: 0, wagered: 0, won: 0, pnl: 0 };
    updateHUD(0, 0, 0);
  };
})();
