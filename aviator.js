javascript:(function(){
  window.__avtrxHunterV11 = false;
  if (window.__avtrxDossierV12) {
    alert('Dossier Engine v12 уже работает!');
    return;
  }
  window.__avtrxDossierV12 = true;

  var rounds = [];
  var playerDossier = {}; // База данных игроков: ID/Ник -> Досье
  var lastLeadText = '';
  var streakCount = 0;
  var streakSum = 0;
  var lastCrashTs = Date.now();
  var peakPlayers = 0;
  var roundWhalesCache = [];

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

  // Постоянный опрос живого счетчика онлайна
  setInterval(function(){
    var pEl = document.querySelector('.flight-radar-participants-count');
    if (pEl) {
      var n = parseInt(pEl.textContent.trim(), 10);
      if (!isNaN(n) && n > peakPlayers) peakPlayers = n;
    }
  }, 200);

  // Обработка участников и пополнение досье
  function processParticipants(participants) {
    if (!participants || !participants.length) return;
    
    // Группировка ставок внутри раунда по игроку (для детекта игры в 2 панели)
    var roundPlayerBets = {};

    participants.forEach(function(p){
      var bet = +(p.betAmount || p.amount || 0);
      var win = +(p.winAmount || 0);
      var mult = +(p.odds || 0);
      var pName = p.assetsInfo ? p.assetsInfo.name : (p.userId ? p.userId.substring(0, 8) : 'Anonymous');
      var pKey = (p.userId || pName) + (p.assetsInfo ? '_' + p.assetsInfo.exp : '');

      if (!roundPlayerBets[pKey]) roundPlayerBets[pKey] = [];
      roundPlayerBets[pKey].push({ bet: bet, win: win, mult: mult });

      // Досье игрока
      if (!playerDossier[pKey]) {
        playerDossier[pKey] = {
          name: pName,
          key: pKey,
          rounds_tracked: 0,
          total_bets_count: 0,
          dual_panel_rounds: 0,
          total_wagered: 0,
          total_won: 0,
          net_profit: 0,
          cashout_mults: [],
          wins_count: 0,
          losses_count: 0
        };
      }

      var d = playerDossier[pKey];
      d.total_bets_count++;
      d.total_wagered = +(d.total_wagered + bet).toFixed(2);
      d.total_won = +(d.total_won + win).toFixed(2);
      d.net_profit = +(d.total_won - d.total_wagered).toFixed(2);
      if (win > 0) {
        d.wins_count++;
        if (mult > 0) d.cashout_mults.push(+mult.toFixed(2));
      } else {
        d.losses_count++;
      }
    });

    // Фиксация игры в 2 панели
    for (var k in roundPlayerBets) {
      if (playerDossier[k]) {
        playerDossier[k].rounds_tracked++;
        if (roundPlayerBets[k].length >= 2) {
          playerDossier[k].dual_panel_rounds++;
        }
      }
    }

    roundWhalesCache = participants.map(function(p){
      var b = +(p.betAmount || p.amount || 0);
      var w = +(p.winAmount || 0);
      return {
        player: p.assetsInfo ? p.assetsInfo.name : (p.userId ? p.userId.substring(0, 8) : 'Anonymous'),
        bet: b,
        target_mult: +(p.odds || 0).toFixed(2),
        payout: w,
        net_profit: w > 0 ? +(w - b).toFixed(2) : -b,
        status: p.status
      };
    });
  }

  // Перехват сети + попытка расширения лимитов (pageSize / limit)
  var origFetch = window.fetch;
  window.fetch = async function(){
    var args = Array.from(arguments);
    var url = args[0];
    var urlStr = (typeof url === 'string') ? url : (url && url.url ? url.url : '');

    if (urlStr.includes('GetParticipants')) {
      // Пробуем запросить расширенный лимит (до 500 записей)
      if (args[1] && args[1].body && typeof args[1].body === 'string') {
        try {
          var bObj = JSON.parse(args[1].body);
          if (!bObj.pageSize) {
            bObj.pageSize = 500;
            bObj.limit = 500;
            args[1].body = JSON.stringify(bObj);
          }
        } catch(e){}
      }

      var res = await origFetch.apply(this, args);
      try {
        res.clone().json().then(function(data){
          if (data && data.participants) {
            processParticipants(data.participants);
          }
        }).catch(function(){});
      } catch(e){}
      return res;
    }

    return origFetch.apply(this, arguments);
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

    var rData = {
      round_num: rounds.length + 1,
      ts: now,
      multiplier: m,
      cycle_sec: cycleTotal,
      flight_sec: flightSec,
      pause_sec: pauseSec,
      players_online: peakPlayers || 1600,
      streak_before_10x: gapInfo,
      whales: roundWhalesCache.length ? roundWhalesCache : null
    };

    rounds.push(rData);
    peakPlayers = 0;
    updateHUD(m, rData.flight_sec, rData.players_online);
  }

  // Поллинг ленты коэффициентов
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
  var old = document.getElementById('avtrx-v12-hud');
  if (old) old.remove();

  var hud = document.createElement('div');
  hud.id = 'avtrx-v12-hud';
  hud.style.cssText = 'position:fixed;bottom:10px;left:4%;width:92%;background:#090d16;color:#fff;border:2px solid #38bdf8;border-radius:10px;padding:8px 12px;z-index:2147483647;font-family:monospace;font-size:11px;box-shadow:0 0 25px rgba(0,0,0,0.9);';
  
  hud.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
                  '<span style="color:#38bdf8;font-weight:bold;">✈ DOSSIER v12</span>' +
                  '<span id="v12-status" style="color:#facc15;font-weight:bold;font-size:13px;">Слежу за профилями...</span>' +
                  '<b id="v12-cnt" style="color:#4ade80;font-size:12px;">0 R</b>' +
                  '</div>' +
                  '<div id="v12-top-whale" style="font-size:10px;color:#38bdf8;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
                  'Анализ базы игроков...' +
                  '</div>' +
                  '<div style="display:flex;gap:6px;">' +
                  '<button id="v12-save" style="flex:1;background:#16a34a;color:#fff;border:none;padding:6px;border-radius:4px;font-weight:bold;cursor:pointer;">💾 ВЫГРУЗИТЬ БАЗУ И ДОСЬЕ</button>' +
                  '<button id="v12-leaderboard" style="background:#0284c7;color:#fff;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;">🏆 ТОПЫ</button>' +
                  '<button id="v12-clr" style="background:#475569;color:#fff;border:none;padding:6px 8px;border-radius:4px;cursor:pointer;">🧹</button>' +
                  '</div>';
  document.body.appendChild(hud);

  function updateHUD(lastM, flightSec, players){
    var cEl = document.getElementById('v12-cnt');
    var sEl = document.getElementById('v12-status');
    var wEl = document.getElementById('v12-top-whale');

    if (cEl) cEl.textContent = rounds.length + ' R';
    if (sEl && lastM) sEl.innerHTML = lastM.toFixed(2) + 'x <span style="font-size:10px;color:#94a3b8;">(' + flightSec + 'с | ' + players + ' чел)</span>';

    // Поиск лидера по чистой прибыли в текущей сессии
    var pList = Object.values(playerDossier);
    if (pList.length > 0) {
      pList.sort(function(a,b){ return b.net_profit - a.net_profit; });
      var leader = pList[0];
      var profitStr = leader.net_profit >= 0 ? '+' + leader.net_profit : leader.net_profit;
      wEl.innerHTML = 'Лидер профита: <b>' + leader.name + '</b> (<span style="color:' + (leader.net_profit >= 0 ? '#4ade80' : '#f87171') + '">' + profitStr + ' ₽</span> | ' + leader.rounds_tracked + ' раунд)';
    }
  }

  // Окно лидерборда игроков прямо на экран
  document.getElementById('v12-leaderboard').onclick = function(){
    var pList = Object.values(playerDossier);
    if (!pList.length) return alert('База игроков еще формируется. Держите шторку участников приоткрытой!');
    
    pList.sort(function(a,b){ return b.net_profit - a.net_profit; });
    var top5 = pList.slice(0, 5);
    var msg = '🏆 ТОП-5 САМЫХ ПРИБЫЛЬНЫХ ИГРОКОВ СЕССИИ:\n\n';
    
    top5.forEach(function(p, i){
      var winRate = p.total_bets_count > 0 ? ((p.wins_count / p.total_bets_count) * 100).toFixed(1) : 0;
      var avgM = p.cashout_mults.length ? (p.cashout_mults.reduce(function(a,b){return a+b;},0)/p.cashout_mults.length).toFixed(2) : '0';
      msg += (i+1) + '. ' + p.name + ':\n' +
             '   • Чистый PnL: ' + (p.net_profit >= 0 ? '+' : '') + p.net_profit + ' ₽\n' +
             '   • Оборот: ' + p.total_wagered + ' ₽ (Винрейт: ' + winRate + '%)\n' +
             '   • Средний кэшаут: ' + avgM + 'x\n' +
             '   • Игра в 2 панели: ' + p.dual_panel_rounds + ' из ' + p.rounds_tracked + ' раундов\n\n';
    });

    alert(msg);
  };

  // Экспорт JSON: и раунды, и полное досье на каждого игрока
  document.getElementById('v12-save').onclick = function(){
    if (!rounds.length) return alert('Выборка пуста!');
    var payload = {
      exportedAt: new Date().toISOString(),
      game: 'Aviatrix',
      totalRounds: rounds.length,
      totalPlayersTracked: Object.keys(playerDossier).length,
      bucketStats: buckets,
      rounds: rounds,
      playerDossier: playerDossier // Полная база на каждого человека
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'aviatrix_dossier_v12_' + Date.now() + '.json';
    a.click();
  };

  document.getElementById('v12-clr').onclick = function(){
    rounds = [];
    playerDossier = {};
    buckets = { total:0, instant_1_00:0, lt_1_10:0, lt_1_30:0, lt_1_50:0, gt_3_00:0, gt_5_00:0, gt_10_0:0, gt_50_0:0, gt_100_:0 };
    streakCount = 0;
    streakSum = 0;
    peakPlayers = 0;
    updateHUD(0, 0, 0);
  };
})();
