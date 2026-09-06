javascript:(function(){
  var foundUrls = [];

  // 1. Поиск по всем фреймам
  document.querySelectorAll('iframe').forEach(function(f){
    var s = f.src || f.getAttribute('src') || f.getAttribute('data-src');
    if (s && s.startsWith('http')) foundUrls.push(s);
  });

  // 2. Поиск в Performance API (перехватывает URL запуска, даже если фрейм скрыт)
  if (window.performance && window.performance.getEntriesByType) {
    window.performance.getEntriesByType('resource').forEach(function(r){
      if (r.name.includes('avtrx') || r.name.includes('spribe') || r.name.includes('aviator') || r.name.includes('game-start') || r.name.includes('gameproxy')) {
        foundUrls.push(r.name);
      }
    });
  }

  // 3. Поиск в сессионном хранилище логгера v9
  if (window.pokerdomLogSession && window.pokerdomLogSession.events) {
    window.pokerdomLogSession.events.forEach(function(e){
      if (e.raw && e.raw.includes('gameStartUrl')) {
        try {
          var m = JSON.parse(e.raw);
          if (m.gameStartUrl) foundUrls.push(m.gameStartUrl);
        } catch(ex){}
      }
    });
  }

  // Очистка от дублей
  foundUrls = Array.from(new Set(foundUrls)).filter(function(u){
    return !u.includes('webvisor') && !u.includes('metrika') && !u.includes('google');
  });

  // Создаем модалку на экране
  var box = document.getElementById('frame-extractor-box');
  if (box) box.remove();

  box = document.createElement('div');
  box.id = 'frame-extractor-box';
  box.style.cssText = 'position:fixed;top:10%;left:5%;width:90%;max-height:80%;background:#0f172a;color:#fff;border:2px solid #38bdf8;border-radius:12px;padding:16px;z-index:9999999999;font-family:sans-serif;font-size:12px;box-shadow:0 0 30px rgba(0,0,0,0.9);overflow-y:auto;';
  
  var html = '<h3 style="margin:0 0 10px 0;color:#38bdf8;font-size:14px;">🎯 Найденные ссылки игры:</h3>';
  
  if (!foundUrls.length) {
    html += '<p style="color:#f87171;">Фрейм игры пока не обнаружен. Убедитесь, что самолетик уже появился на экране, и нажмите еще раз.</p>';
  } else {
    foundUrls.forEach(function(u, idx){
      html += '<div style="margin-bottom:12px;padding:8px;background:#1e293b;border-radius:6px;word-break:break-all;">' +
              '<div style="color:#94a3b8;font-size:10px;margin-bottom:4px;">Источник #' + (idx+1) + '</div>' +
              '<a href="' + u + '" target="_blank" style="color:#4ade80;font-weight:bold;text-decoration:none;display:inline-block;margin-bottom:6px;">👉 ОТКРЫТЬ В НОВОЙ ВКЛАДКЕ</a>' +
              '<div style="color:#cbd5e1;font-size:10px;">' + u.substring(0, 120) + '...</div>' +
              '</div>';
    });
  }

  html += '<button id="close-ext-btn" style="width:100%;background:#475569;color:#fff;border:none;padding:10px;border-radius:6px;font-weight:bold;margin-top:10px;">Закрыть</button>';
  box.innerHTML = html;
  document.body.appendChild(box);

  document.getElementById('close-ext-btn').onclick = function(){ box.remove(); };
})();
