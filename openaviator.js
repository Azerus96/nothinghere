javascript:(function(){
  if(window.__crashDS_v2){
    alert('Логгер v2 уже запущен!');
    return;
  }
  window.__crashDS_v2 = true;

  var rounds = [];
  var currentRound = { bets: [] };
  var rawPacketCount = 0;
  var lastRawSample = 'Пакеты еще не поступали';

  function calcMed(a){
    if(!a.length) return 0;
    var s=a.slice().sort(function(x,y){return x-y;});
    var m=Math.floor(s.length/2);
    return s.length%2!==0?s[m]:(s[m-1]+s[m])/2;
  }

  function commit(rId, mult, hash){
    var stakes = currentRound.bets.map(function(b){ return b.amount; });
    var totalVol = stakes.reduce(function(a,b){ return a+b; }, 0);
    var minB = stakes.length ? Math.min.apply(null, stakes) : 0;
    var maxB = stakes.length ? Math.max.apply(null, stakes) : 0;
    var medB = calcMed(stakes);
    var ws = totalVol > 0 ? +(maxB / totalVol).toFixed(4) : 0;

    var won = 0, winCnt = 0, losCnt = 0;
    currentRound.bets.forEach(function(b){
      if(b.out && b.mult <= mult){
        won += (b.amount * b.mult);
        winCnt++;
      } else {
        losCnt++;
      }
    });

    rounds.push({
      id: rId || ('R_' + Date.now()),
      ts: Date.now(),
      mult: +mult.toFixed(2),
      players: currentRound.bets.length,
      vol: +totalVol.toFixed(2),
      min: minB,
      med: medB,
      max: maxB,
      whale: ws,
      profit: +(totalVol - won).toFixed(2),
      win: winCnt,
      los: losCnt,
      h: hash || ''
    });

    currentRound = { bets: [] };
    updateHUD();
  }

  function parseMsg(raw){
    rawPacketCount++;
    if(typeof raw !== 'string') return;
    if(raw.length > 20 && raw.length < 500) lastRawSample = raw;

    // Срезаем Socket.io коды 42[...]
    var clean = raw.replace(/^42\[/, '[');
    if(!clean.startsWith('{') && !clean.startsWith('[')) {
      updateHUD();
      return;
    }

    try {
      var data = JSON.parse(clean);
      var msg = Array.isArray(data) ? data[1] : data;
      var evt = Array.isArray(data) ? data[0] : (msg.type || msg.action || msg.event);

      // Ловим ставки
      var bList = msg.bets || msg.all_bets || (evt==='bets'?msg:null);
      if(Array.isArray(bList)){
        bList.forEach(function(b){
          var a = +(b.amount || b.bet || b.bet_amount || 0);
          if(a > 0){
            currentRound.bets.push({
              id: b.id || b.user_id || Math.random(),
              amount: a,
              out: !!(b.cashed_out || b.cashout || b.win),
              mult: +(b.cashout_mult || b.multiplier || b.rate || 0)
            });
          }
        });
      }

      // Ловим кэшауты
      if(evt === 'cashout' || msg.cashout){
        var bId = msg.id || msg.bet_id || msg.user_id;
        var mVal = +(msg.multiplier || msg.cashout_mult || msg.rate || 0);
        for(var i=0; i<currentRound.bets.length; i++){
          if(currentRound.bets[i].id === bId){
            currentRound.bets[i].out = true;
            currentRound.bets[i].mult = mVal;
            break;
          }
        }
      }

      // Ловим краш
      var crashMult = msg.crash_multiplier || msg.rate || msg.coefficient || msg.final_rate || msg.mult;
      if(evt === 'crash' || evt === 'round_ended' || msg.status === 'crashed' || (crashMult && (evt==='game_over'||evt==='end'))){
        commit(msg.round_id || msg.id, +crashMult, msg.hash);
      }
    } catch(e){}
    updateHUD();
  }

  // --- ТОТАЛЬНЫЙ ПЕРЕХВАТ WEBSOCKET (Включая уже открытые) ---
  function hookWSInstance(ws){
    if(ws.__v2_hooked) return;
    ws.__v2_hooked = true;
    ws.addEventListener('message', function(e){ parseMsg(e.data); });
  }

  // Перехват новых
  var OrigWS = window.WebSocket;
  window.WebSocket = function(u, p){
    var ws = new OrigWS(u, p);
    hookWSInstance(ws);
    return ws;
  };
  window.WebSocket.prototype = OrigWS.prototype;

  // Перехват УЖЕ СОЗДАННЫХ через prototype.send
  var origSend = OrigWS.prototype.send;
  OrigWS.prototype.send = function(d){
    hookWSInstance(this);
    return origSend.apply(this, arguments);
  };

  // --- UI HUD ---
  var hud = document.createElement('div');
  hud.id = 'crash-hud-v2';
  hud.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:99999999;background:#090d16;color:#fff;border:2px solid #0284c7;border-radius:8px;padding:6px 10px;font-family:monospace;font-size:11px;display:flex;align-items:center;gap:6px;box-shadow:0 0 15px rgba(0,0,0,0.8);';
  hud.innerHTML = '<span style="color:#38bdf8;font-weight:bold;">✈ DS-v2</span>' +
                  '<span id="hud-rx" style="color:#94a3b8;">Rx:0</span>' +
                  '<b id="hud-rcnt" style="color:#4ade80;">0 R</b>' +
                  '<button id="hud-view" style="background:#475569;color:#fff;border:none;padding:2px 5px;border-radius:4px;">👁 RAW</button>' +
                  '<button id="hud-save" style="background:#16a34a;color:#fff;border:none;padding:2px 6px;border-radius:4px;font-weight:bold;">💾</button>' +
                  '<button id="hud-clr" style="background:#dc2626;color:#fff;border:none;padding:2px 5px;border-radius:4px;">🧹</button>';
  document.body.appendChild(hud);

  function updateHUD(){
    var rxEl = document.getElementById('hud-rx');
    var rcEl = document.getElementById('hud-rcnt');
    if(rxEl) rxEl.textContent = 'Rx:' + rawPacketCount;
    if(rcEl) rcEl.textContent = rounds.length + ' R';
  }

  document.getElementById('hud-view').onclick = function(){
    alert('Последний сырой пакет (Rx: ' + rawPacketCount + '):\n\n' + lastRawSample.substring(0, 300));
  };

  document.getElementById('hud-save').onclick = function(){
    if(!rounds.length) return alert('Раунды еще не зафиксированы. Дождитесь хотя бы одного краша!');
    var blob = new Blob([JSON.stringify(rounds, null, 2)], {type:'application/json'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'crash_dataset_' + Date.now() + '.json';
    a.click();
  };

  document.getElementById('hud-clr').onclick = function(){
    rounds = [];
    rawPacketCount = 0;
    updateHUD();
  };
})();
