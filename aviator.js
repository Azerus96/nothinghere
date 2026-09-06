javascript:(function(){
  if(window.__avtrxEngineV4){
    alert('Aviatrix Engine v4 уже запущен!');
    return;
  }
  window.__avtrxEngineV4 = true;

  // --- ХРАНИЛИЩЕ И АНАЛИТИКА ---
  var rounds = [];
  var activeRound = {
    id: null,
    takeoffTime: 0,
    crashTime: 0,
    mult: 0,
    bets: []
  };
  var lastCrashTimestamp = Date.now();
  var isFlying = false;

  // Счетчики корзин (Пункт 3)
  var stats = {
    total: 0,
    c1_00: 0, // Мгновенный краш
    c1_10: 0,
    c1_30: 0,
    c1_50: 0,
    c3_00: 0,
    c5_00: 0,
    c10_0: 0,
    c50_0: 0,
    c100_: 0
  };

  function updateStats(m) {
    stats.total++;
    if (m <= 1.01) stats.c1_00++;
    if (m < 1.10) stats.c1_10++;
    if (m < 1.30) stats.c1_30++;
    if (m < 1.50) stats.c1_50++;
    if (m >= 3.00) stats.c3_00++;
    if (m >= 5.00) stats.c5_00++;
    if (m >= 10.00) stats.c10_0++;
    if (m >= 50.00) stats.c50_0++;
    if (m >= 100.00) stats.c100_++;
  }

  // Фиксация завершенного раунда (Пункты 1, 2, 3, 4)
  function registerRoundCrash(rId, mult) {
    if (!mult || mult <= 0) return;
    
    var now = Date.now();
    var flightDuration = activeRound.takeoffTime > 0 ? +((now - activeRound.takeoffTime) / 1000).toFixed(2) : 0;
    var pauseDuration = lastCrashTimestamp > 0 ? +((activeRound.takeoffTime - lastCrashTimestamp) / 1000).toFixed(2) : 0;
    if (pauseDuration < 0) pauseDuration = 0;

    lastCrashTimestamp = now;
    isFlying = false;

    updateStats(mult);

    var roundEntry = {
      round_id: rId || ('R_' + now),
      timestamp: now,
      multiplier: +mult.toFixed(2),
      flight_duration_sec: flightDuration,
      pause_duration_sec: pauseDuration,
      pool_participants: activeRound.bets.length,
      is_instant_crash: mult <= 1.01
    };

    rounds.push(roundEntry);
    activeRound = { id: null, takeoffTime: 0, crashTime: 0, mult: 0, bets: [] };

    updateHUD(mult);
  }

  // --- КАНАЛ 1: ПЕРЕХВАТ ТЕЛЕМЕТРИИ GOOGLE ANALYTICS (Seq 179 из вашего лога) ---
  // Игра гарантированно отправляет сюда точный коэф и ID при посадке/краше
  var origBeacon = navigator.sendBeacon;
  navigator.sendBeacon = function(url, data){
    checkPayloadString(typeof data === 'string' ? data : '');
    return origBeacon.apply(this, arguments);
  };

  // --- КАНАЛ 2: ТОТАЛЬНЫЙ ПЕРЕХВАТ FETCH & GRPC ---
  var origFetch = window.fetch;
  window.fetch = async function(){
    var url = arguments[0];
    var urlStr = (typeof url === 'string') ? url : (url && url.url ? url.url : '');
    var init = arguments[1] || {};

    // Засекаем старт раунда по ставкам
    if (urlStr.includes('PlaceBet')) {
      if (!isFlying) {
        isFlying = true;
        activeRound.takeoffTime = Date.now();
      }
      try {
        var reqData = JSON.parse(init.body || '{}');
        if (reqData.roundId) activeRound.id = reqData.roundId;
      } catch(e){}
    }

    var res = await origFetch.apply(this, arguments);

    // Ловим Google Analytics через Fetch POST
    if (urlStr.includes('google-analytics.com') || urlStr.includes('/g/collect')) {
      var bodyData = init.body || '';
      checkPayloadString(typeof bodyData === 'string' ? bodyData : '');
    }

    // Ловим эндпоинты игры
    if (urlStr.includes('aviatrix.gateway')) {
      try {
        var clone = res.clone();
        clone.json().then(function(d){
          if (d.odds && !urlStr.includes('PlaceBet')) {
            // Кэшаут или исход
            activeRound.mult = +d.odds;
          }
          if (d.participants) {
            activeRound.bets = d.participants;
          }
        }).catch(function(){});
      } catch(e){}
    }

    return res;
  };

  function checkPayloadString(str) {
    if (!str) return;
    // Парсим строку Google Analytics из Seq 179: epn.odd=1.131011... & ep.roundId=6564851
    if (str.includes('epn.odd=') || str.includes('en=land')) {
      var oddMatch = str.match(/epn\.odd=([0-9.]+)/);
      var roundMatch = str.match(/ep\.roundId=([0-9]+)/);
      if (oddMatch) {
        var m = parseFloat(oddMatch[1]);
        var rId = roundMatch ? roundMatch[1] : null;
        registerRoundCrash(rId, m);
      }
    }
  }

  // --- КАНАЛ 3: ХУК WEBSOCKET С ПРИНУДИТЕЛЬНЫМ ПЕРЕПОДКЛЮЧЕНИЕМ ---
  var OrigWS = window.WebSocket;
  window.WebSocket = function(u, p){
    var ws = new OrigWS(u, p);
    ws.addEventListener('message', function(e){
      if (typeof e.data === 'string') {
        checkPayloadString(e.data);
      }
    });
    return ws;
  };
  window.WebSocket.prototype = OrigWS.prototype;

  // Пытаемся спровоцировать реконнект существующих сокетов
  window.dispatchEvent(new Event('offline'));
  setTimeout(function(){ window.dispatchEvent(new Event('online')); }, 300);

  // --- ИНТЕРФЕЙС HUD НА ЭКРАНЕ ---
  var hud = document.getElementById('avtrx-v4-box');
  if (hud) hud.remove();

  hud = document.createElement('div');
  hud.id = 'avtrx-v4-box';
  hud.style.cssText = 'position:fixed;bottom:10px;left:5%;width:90%;background:#090d16;color:#f8fafc;border:2px solid #0284c7;border-radius:10px;padding:8px 12px;z-index:9999999999;font-family:monospace;font-size:11px;box-shadow:0 0 20px rgba(0,0,0,0.9);';
  
  hud.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
                  '<span style="color:#38bdf8;font-weight:bold;">✈ ENGINE v4</span>' +
                  '<span id="v4-last-mult" style="color:#facc15;font-weight:bold;">Ждем краш...</span>' +
                  '<span id="v4-rounds-cnt" style="color:#4ade80;font-weight:bold;">0 R</span>' +
                  '</div>' +
                  '<div id="v4-bucket-view" style="font-size:10px;color:#94a3b8;margin-bottom:8px;line-height:1.4;">' +
                  '< 1.10: 0% | < 1.50: 0% | > 3.0: 0% | > 10.0: 0%' +
                  '</div>' +
                  '<div style="display:flex;gap:6px;">' +
                  '<button id="v4-btn-save" style="flex:1;background:#16a34a;color:#fff;border:none;padding:5px;border-radius:4px;font-weight:bold;cursor:pointer;">💾 СКАЧАТЬ JSON</button>' +
                  '<button id="v4-btn-stat" style="background:#0284c7;color:#fff;border:none;padding:5px 8px;border-radius:4px;cursor:pointer;">📊 ИНФО</button>' +
                  '<button id="v4-btn-clr" style="background:#475569;color:#fff;border:none;padding:5px 8px;border-radius:4px;cursor:pointer;">🧹</button>' +
                  '</div>';
  document.body.appendChild(hud);

  function updateHUD(lastM){
    var cntEl = document.getElementById('v4-rounds-cnt');
    var lastEl = document.getElementById('v4-last-mult');
    var bEl = document.getElementById('v4-bucket-view');

    if (cntEl) cntEl.textContent = rounds.length + ' R';
    if (lastEl && lastM) lastEl.textContent = lastM.toFixed(2) + 'x';
    
    if (bEl && stats.total > 0) {
      var p11 = ((stats.c1_10 / stats.total) * 100).toFixed(1);
      var p15 = ((stats.c1_50 / stats.total) * 100).toFixed(1);
      var p3 = ((stats.c3_00 / stats.total) * 100).toFixed(1);
      var p10 = ((stats.c10_0 / stats.total) * 100).toFixed(1);
      bEl.innerHTML = '< 1.10: <b>' + p11 + '%</b> | < 1.50: <b>' + p15 + '%</b><br>> 3.00: <b>' + p3 + '%</b> | > 10.0: <b>' + p10 + '%</b>';
    }
  }

  // Детальный отчет по пунктам 1, 2, 3, 4 прямо на экран
  document.getElementById('v4-btn-stat').onclick = function(){
    if (!rounds.length) return alert('Пока нет данных. Подождите хотя бы 2-3 раунда!');
    var msg = '📊 СТАТИСТИКА ВЫБОРКИ (' + rounds.length + ' раундов):\n\n' +
              '1. Средняя длительность полета: ' + (rounds.reduce(function(a,b){return a+b.flight_duration_sec;},0)/rounds.length).toFixed(2) + ' сек.\n' +
              '2. Средняя пауза между играми: ' + (rounds.reduce(function(a,b){return a+b.pause_duration_sec;},0)/rounds.length).toFixed(2) + ' сек.\n\n' +
              '3. КОРЗИНЫ МНОЖИТЕЛЕЙ:\n' +
              ' • Мгновенный краш (<=1.01): ' + stats.c1_00 + ' (' + ((stats.c1_00/stats.total)*100).toFixed(1) + '%)\n' +
              ' • Ниже 1.10x: ' + stats.c1_10 + ' (' + ((stats.c1_10/stats.total)*100).toFixed(1) + '%)\n' +
              ' • Ниже 1.50x: ' + stats.c1_50 + ' (' + ((stats.c1_50/stats.total)*100).toFixed(1) + '%)\n' +
              ' • Выше 10.0x: ' + stats.c10_0 + ' (' + ((stats.c10_0/stats.total)*100).toFixed(1) + '%)\n' +
              ' • Выше 50.0x: ' + stats.c50_0 + ' (' + ((stats.c50_0/stats.total)*100).toFixed(1) + '%)\n' +
              ' • Выше 100.0x: ' + stats.c100_ + ' (' + ((stats.c100_/stats.total)*100).toFixed(1) + '%)';
    alert(msg);
  };

  // Выгрузка полного JSON
  document.getElementById('v4-btn-save').onclick = function(){
    if (!rounds.length) return alert('Выборка пуста!');
    var payload = {
      exportedAt: new Date().toISOString(),
      summary: {
        totalRounds: rounds.length,
        bucketStats: stats
      },
      rounds: rounds
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'aviatrix_engine_v4_' + Date.now() + '.json';
    a.click();
  };

  document.getElementById('v4-btn-clr').onclick = function(){
    rounds = [];
    stats = { total:0, c1_00:0, c1_10:0, c1_30:0, c1_50:0, c3_00:0, c5_00:0, c10_0:0, c50_0:0, c100_:0 };
    updateHUD(0);
  };
})();
