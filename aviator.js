javascript:(function(){
  if(window.__aviatrixDS){
    alert('Aviatrix DS уже активен!');
    return;
  }
  window.__aviatrixDS = true;

  var dataset = [];
  var currentRoundData = null;

  function calcMed(arr){
    if(!arr.length) return 0;
    var s = arr.slice().sort(function(a,b){return a-b;});
    var m = Math.floor(s.length/2);
    return s.length % 2 !== 0 ? s[m] : (s[m-1] + s[m])/2;
  }

  // Перехват сетевых вызовов игры
  var origFetch = window.fetch;
  window.fetch = async function(){
    var res = await origFetch.apply(this, arguments);
    var url = arguments[0];
    var urlStr = (typeof url === 'string') ? url : (url && url.url ? url.url : '');

    if (urlStr.includes('aviatrix.gateway')) {
      try {
        var clone = res.clone();
        clone.json().then(function(data){
          parseAviatrix(urlStr, data);
        }).catch(function(){});
      } catch(e){}
    }
    return res;
  };

  function parseAviatrix(url, data){
    // 1. Пул участников и ставки раунда
    if (url.includes('GetParticipants') && data.participants) {
      var parts = data.participants;
      var stakes = parts.map(function(p){ return +(p.betAmount || p.amount || 0); }).filter(function(v){ return v > 0; });
      var totalVol = stakes.reduce(function(a,b){ return a+b; }, 0);
      var maxB = stakes.length ? Math.max.apply(null, stakes) : 0;
      var minB = stakes.length ? Math.min.apply(null, stakes) : 0;
      var medB = calcMed(stakes);
      var totalActive = +(data.totalActiveParticipants || parts.length);

      currentRoundData = {
        ts: Date.now(),
        roundId: (parts[0] && parts[0].outcomeId) ? parts[0].outcomeId.substring(0, 10) : ('R_' + Date.now()),
        totalPlayers: totalActive,
        sampleSize: parts.length,
        poolVolumeSample: +totalVol.toFixed(2),
        minBet: minB,
        medBet: medB,
        maxBet: maxB,
        whaleShare: totalVol > 0 ? +(maxB / totalVol).toFixed(4) : 0,
        mult: 0
      };
      updateUI();
    }

    // 2. Фиксация кэшаута / исхода
    if (url.includes('CashOut') && data.odds) {
      if (currentRoundData) {
        currentRoundData.userCashout = +data.odds.toFixed(2);
      }
    }
  }

  // UI HUD
  var hud = document.createElement('div');
  hud.id = 'avtrx-hud';
  hud.style.cssText = 'position:fixed;bottom:15px;right:15px;z-index:99999999;background:#090d16;color:#fff;border:2px solid #0284c7;border-radius:8px;padding:8px 12px;font-family:monospace;font-size:11px;display:flex;align-items:center;gap:8px;box-shadow:0 0 15px rgba(0,0,0,0.8);';
  hud.innerHTML = '<span style="color:#38bdf8;font-weight:bold;">✈ AVTRX-DS</span>' +
                  '<b id="avtrx-cnt" style="color:#4ade80;">0 пулов</b>' +
                  '<button id="avtrx-save" style="background:#16a34a;color:#fff;border:none;padding:3px 8px;border-radius:4px;font-weight:bold;cursor:pointer;">💾 JSON</button>' +
                  '<button id="avtrx-clr" style="background:#475569;color:#fff;border:none;padding:3px 6px;border-radius:4px;cursor:pointer;">🧹</button>';
  document.body.appendChild(hud);

  function updateUI(){
    if (currentRoundData) {
      dataset.push(currentRoundData);
      currentRoundData = null;
    }
    var el = document.getElementById('avtrx-cnt');
    if (el) el.textContent = dataset.length + ' пулов';
  }

  document.getElementById('avtrx-save').onclick = function(){
    if (!dataset.length) return alert('Данные пока не собраны. Переключитесь на вкладку участников в игре!');
    var blob = new Blob([JSON.stringify(dataset, null, 2)], {type:'application/json'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'aviatrix_data_' + Date.now() + '.json';
    a.click();
  };

  document.getElementById('avtrx-clr').onclick = function(){
    dataset = [];
    document.getElementById('avtrx-cnt').textContent = '0 пулов';
  };
})();
