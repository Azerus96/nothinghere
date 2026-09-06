javascript:(function(){
  if(window.__avtrxAutoV3){
    alert('Сборщик Aviatrix v3 уже работает!');
    return;
  }
  window.__avtrxAutoV3 = true;

  var historyMultipliers = [];
  var poolsData = [];
  var seenRounds = new Set();

  function calcMed(arr){
    if(!arr.length) return 0;
    var s = arr.slice().sort(function(a,b){return a-b;});
    var m = Math.floor(s.length/2);
    return s.length % 2 !== 0 ? s[m] : (s[m-1] + s[m])/2;
  }

  // --- 1. ПЕРЕХВАТ FETCH (Для пулов ставок и кэшаутов) ---
  var origFetch = window.fetch;
  window.fetch = async function(){
    var res = await origFetch.apply(this, arguments);
    var url = arguments[0];
    var urlStr = (typeof url === 'string') ? url : (url && url.url ? url.url : '');

    if (urlStr.includes('aviatrix.gateway')) {
      try {
        var clone = res.clone();
        clone.json().then(function(data){
          // Перехват участников
          if (urlStr.includes('GetParticipants') && data.participants) {
            var parts = data.participants;
            var stakes = parts.map(function(p){ return +(p.betAmount || p.amount || 0); }).filter(function(v){ return v > 0; });
            var totalVol = stakes.reduce(function(a,b){ return a+b; }, 0);
            var maxB = stakes.length ? Math.max.apply(null, stakes) : 0;
            var minB = stakes.length ? Math.min.apply(null, stakes) : 0;
            var medB = calcMed(stakes);
            var totalActive = +(data.totalActiveParticipants || parts.length);

            poolsData.push({
              ts: Date.now(),
              totalPlayers: totalActive,
              poolVolumeTop50: +totalVol.toFixed(2),
              minBet: minB,
              medBet: medB,
              maxBet: maxB,
              whaleShare: totalVol > 0 ? +(maxB / totalVol).toFixed(4) : 0
            });
            updateUI();
          }
        }).catch(function(){});
      } catch(e){}
    }
    return res;
  };

  // --- 2. АВТО-СКАНЕР ИСТОРИИ КОЭФФИЦИЕНТОВ С ЭКРАНА (DOM) ---
  function scanHistoryDOM(){
    // Ищем любые элементы, содержащие паттерн множителя (например: 1.23x, 14.50x, 2x)
    var allTextNodes = [];
    var elements = document.querySelectorAll('div, span, button, p');
    
    elements.forEach(function(el){
      // Отсекаем интерфейс самого HUD
      if (el.closest('#avtrx-v3-hud')) return;

      var txt = el.textContent ? el.textContent.trim() : '';
      // Паттерн множителя: от 1.00x до 99999x
      var match = txt.match(/^(\d+(?:\.\d{1,2})?)[xх]$/i);
      if (match && el.children.length === 0) {
        var val = parseFloat(match[1]);
        if (val >= 1.0) {
          allTextNodes.push(val);
        }
      }
    });

    if (allTextNodes.length > 0) {
      // Сравниваем с уже собранной историей
      allTextNodes.forEach(function(m){
        var key = m.toFixed(2);
        // Запоминаем новые уникальные исходы
        if (!seenRounds.has(key)) {
          seenRounds.add(key);
          historyMultipliers.push({
            ts: Date.now(),
            multiplier: m
          });
        }
      });
      updateUI();
    }
  }

  // Запуск сканера экрана каждые 1.5 секунды
  setInterval(scanHistoryDOM, 1500);

  // --- 3. ИНТЕРФЕЙС HUD ---
  var hud = document.createElement('div');
  hud.id = 'avtrx-v3-hud';
  hud.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:999999999;background:#090d16;color:#fff;border:2px solid #0284c7;border-radius:8px;padding:8px 10px;font-family:monospace;font-size:11px;display:flex;align-items:center;gap:6px;box-shadow:0 0 15px rgba(0,0,0,0.9);';
  hud.innerHTML = '<span style="color:#38bdf8;font-weight:bold;">✈ V3</span>' +
                  '<b id="v3-mult-cnt" style="color:#4ade80;">0 M</b> | ' +
                  '<b id="v3-pool-cnt" style="color:#f59e0b;">0 P</b>' +
                  '<button id="v3-save" style="background:#16a34a;color:#fff;border:none;padding:3px 7px;border-radius:4px;font-weight:bold;">💾</button>' +
                  '<button id="v3-clr" style="background:#475569;color:#fff;border:none;padding:3px 5px;border-radius:4px;">🧹</button>';
  document.body.appendChild(hud);

  function updateUI(){
    var mEl = document.getElementById('v3-mult-cnt');
    var pEl = document.getElementById('v3-pool-cnt');
    if (mEl) mEl.textContent = historyMultipliers.length + ' M';
    if (pEl) pEl.textContent = poolsData.length + ' P';
  }

  document.getElementById('v3-save').onclick = function(){
    if (!historyMultipliers.length && !poolsData.length) {
      return alert('Данные еще собираются! Дождитесь пары полетов.');
    }
    var exportData = {
      exportedAt: new Date().toISOString(),
      totalMultipliers: historyMultipliers.length,
      totalPools: poolsData.length,
      multipliers: historyMultipliers,
      pools: poolsData
    };
    var blob = new Blob([JSON.stringify(exportData, null, 2)], {type:'application/json'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'aviatrix_v3_' + Date.now() + '.json';
    a.click();
  };

  document.getElementById('v3-clr').onclick = function(){
    historyMultipliers = [];
    poolsData = [];
    seenRounds.clear();
    updateUI();
  };
})();
