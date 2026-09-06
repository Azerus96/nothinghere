javascript:(function(){
  if(window.__crashDSCollector){
    alert('Сборщик Crash-DS уже активен!');
    return;
  }
  window.__crashDSCollector = true;

  // --- КОНФИГУРАЦИЯ И ХРАНИЛИЩЕ ---
  var rounds = [];
  var currentRound = { id: null, bets: [], startTime: 0 };
  var MAX_ROUNDS = 10000;

  // Регулярки для отсечения фонового мусора
  var IGNORE_URL = /webvisor|mc\.yandex|metrika|gtm|google-analytics|superhubbers|doubleclick|pixel/i;
  var WS_NOISE = /^(?:2|3|PONG|PING|40|41|\x00)$/i;

  // Вспомогательные функции мат. статистики
  function calcMedian(arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function(a, b){ return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function formatDSL(r) {
    return 'R:' + r.id + '|T:' + r.ts + '|M:' + r.mult + '|N:' + r.players +
           '|V:' + r.vol_total + '|MIN:' + r.b_min + '|MED:' + r.b_med +
           '|MAX:' + r.b_max + '|WS:' + r.whale_share + '|WON:' + r.vol_won +
           '|PROF:' + r.casino_profit + '|NW:' + r.winners + '|NL:' + r.losers;
  }

  // Фиксация завершенного раунда
  function commitRound(roundId, mult, hash) {
    if (!mult || mult <= 0) return;
    
    var stakes = currentRound.bets.map(function(b){ return b.amount; });
    var totalVol = stakes.reduce(function(a, b){ return a + b; }, 0);
    var minBet = stakes.length ? Math.min.apply(null, stakes) : 0;
    var maxBet = stakes.length ? Math.max.apply(null, stakes) : 0;
    var medBet = calcMedian(stakes);
    var whaleShare = totalVol > 0 ? +(maxBet / totalVol).toFixed(4) : 0;

    var totalWon = 0, winners = 0, losers = 0;
    currentRound.bets.forEach(function(b) {
      if (b.cashedOut && b.cashedMult <= mult) {
        totalWon += (b.amount * b.cashedMult);
        winners++;
      } else {
        losers++;
      }
    });

    var rData = {
      id: roundId || ('R_' + Date.now()),
      ts: Date.now(),
      mult: +mult.toFixed(2),
      players: currentRound.bets.length,
      vol_total: +totalVol.toFixed(2),
      b_min: +minBet.toFixed(2),
      b_med: +medBet.toFixed(2),
      b_max: +maxBet.toFixed(2),
      whale_share: whaleShare,
      vol_won: +totalWon.toFixed(2),
      casino_profit: +(totalVol - totalWon).toFixed(2),
      winners: winners,
      losers: losers,
      pf_hash: hash || ''
    };

    rounds.push(rData);
    if (rounds.length > MAX_ROUNDS) rounds.shift();

    // Сброс буфера ставок под следующий раунд
    currentRound = { id: null, bets: [], startTime: Date.now() };

    // Обновление UI
    var el = document.getElementById('ds-cnt');
    if (el) el.textContent = rounds.length + ' раундов';
  }

  // Парсер пакетов Spribe Aviator / Aviatrix / Crash
  function inspectPayload(raw) {
    if (!raw || typeof raw !== 'string') return;
    var trimmed = raw.trim();
    if (WS_NOISE.test(trimmed)) return;

    // Срезаем Socket.io транспортный код "42[...]"
    var jsonStr = trimmed.replace(/^42\[/, '[');
    if (!jsonStr.startsWith('{') && !jsonStr.startsWith('[')) return;

    try {
      var data = JSON.parse(jsonStr);
      var msg = Array.isArray(data) ? data[1] : data;
      var evt = Array.isArray(data) ? data[0] : (msg.type || msg.action || msg.event);

      if (!msg) return;

      // 1. Поток ставок игроков
      var betsArr = msg.bets || msg.all_bets || (evt === 'bets' ? msg : null);
      if (Array.isArray(betsArr)) {
        betsArr.forEach(function(b) {
          var val = +(b.amount || b.bet || b.bet_amount || 0);
          if (val > 0) {
            currentRound.bets.push({
              id: b.id || b.user_id || Math.random(),
              amount: val,
              cashedOut: !!(b.cashed_out || b.cashout || b.win),
              cashedMult: +(b.cashout_mult || b.multiplier || b.rate || 0)
            });
          }
        });
      }

      // 2. Одиночный кэшаут игрока по ходу полета
      if (evt === 'cashout' || msg.cashout) {
        var bId = msg.id || msg.bet_id || msg.user_id;
        var cMult = +(msg.multiplier || msg.cashout_mult || msg.rate || 0);
        for (var i = 0; i < currentRound.bets.length; i++) {
          if (currentRound.bets[i].id === bId) {
            currentRound.bets[i].cashedOut = true;
            currentRound.bets[i].cashedMult = cMult;
            break;
          }
        }
      }

      // 3. Краш самолета / Конец раунда
      var mult = msg.crash_multiplier || msg.rate || msg.coefficient || msg.final_rate;
      if (evt === 'crash' || evt === 'round_ended' || msg.status === 'crashed' || (mult && evt === 'game_over')) {
        commitRound(msg.round_id || msg.id, +mult, msg.hash || msg.server_seed);
      }
    } catch(e) {}
  }

  // --- ПЕРЕХВАТ WEBSOCKET ---
  var OrigWS = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    var ws = new OrigWS(url, protocols);
    if (!IGNORE_URL.test(url)) {
      ws.addEventListener('message', function(e) {
        if (typeof e.data === 'string') {
          inspectPayload(e.data);
        } else if (e.data instanceof ArrayBuffer) {
          inspectPayload(new TextDecoder().decode(e.data));
        }
      });
    }
    return ws;
  };
  window.WebSocket.prototype = OrigWS.prototype;

  // --- ИНТЕРФЕЙС (HUD) ---
  var hud = document.createElement('div');
  hud.id = 'ds-crash-hud';
  hud.style.cssText = 'position:fixed;bottom:15px;right:15px;z-index:99999999;background:#090d16;color:#f8fafc;border:1px solid #0284c7;border-radius:6px;padding:6px 12px;font-family:monospace;font-size:11px;display:flex;align-items:center;gap:8px;box-shadow:0 4px 15px rgba(0,0,0,0.7);';
  hud.innerHTML = '<span style="color:#38bdf8;font-weight:bold;">✈ CRASH-DS</span>' +
                  '<b id="ds-cnt" style="color:#4ade80;">0 раундов</b>' +
                  '<button id="ds-copy-dsl" style="background:#0284c7;color:#fff;border:none;padding:2px 6px;border-radius:4px;cursor:pointer;">📋 DSL</button>' +
                  '<button id="ds-save-json" style="background:#16a34a;color:#fff;border:none;padding:2px 6px;border-radius:4px;cursor:pointer;">💾 JSON</button>' +
                  '<button id="ds-clear" style="background:#475569;color:#fff;border:none;padding:2px 5px;border-radius:4px;cursor:pointer;">🧹</button>';
  document.body.appendChild(hud);

  // Копирование DSL в буфер обмена
  document.getElementById('ds-copy-dsl').onclick = function() {
    if (!rounds.length) return alert('Выборка пуста!');
    var text = '#SCHEMA:v1|ID|T|M|N|V|MIN|MED|MAX|WS|WON|PROF|NW|NL\n' + rounds.map(formatDSL).join('\n');
    navigator.clipboard.writeText(text).then(function() {
      alert('✅ DSL скопирован (' + rounds.length + ' раундов)');
    });
  };

  // Выгрузка чистого JSON для Pandas
  document.getElementById('ds-save-json').onclick = function() {
    if (!rounds.length) return alert('Выборка пуста!');
    var blob = new Blob([JSON.stringify(rounds, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'crash_dataset_' + Date.now() + '.json';
    a.click();
  };

  document.getElementById('ds-clear').onclick = function() {
    if (confirm('Сбросить накопленную базу раундов?')) {
      rounds = [];
      currentRound = { id: null, bets: [], startTime: Date.now() };
      document.getElementById('ds-cnt').textContent = '0 раундов';
    }
  };
})();
