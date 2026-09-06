javascript:(function(){
  if(window.__aviatorLaunchHook){
    alert('Перехватчик уже активен. Нажмите "Играть" на карточке игры!');
    return;
  }
  window.__aviatorLaunchHook = true;

  // Индикатор ожидания на экране
  var bar = document.createElement('div');
  bar.id = 'aviator-hook-bar';
  bar.style.cssText = 'position:fixed;top:10px;left:5%;width:90%;background:#0284c7;color:#fff;border-radius:8px;padding:12px;z-index:999999999;font-family:sans-serif;font-size:13px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.7);';
  bar.innerHTML = '⏳ <b>Ловушка активна!</b><br>Теперь нажмите кнопку <u>ИГРАТЬ</u> на слоте Aviator.';
  document.body.appendChild(bar);

  function showDirectLink(url){
    bar.style.background = '#16a34a';
    bar.innerHTML = '<div style="font-weight:bold;margin-bottom:6px;">🎯 Ссылка на чистый Aviator поймана!</div>' +
                    '<a href="' + url + '" target="_blank" style="display:block;background:#fff;color:#16a34a;padding:10px;border-radius:6px;font-weight:bold;text-decoration:none;margin-top:8px;">👉 НАЖМИТЕ ЗДЕСЬ, ЧТОБЫ ОТКРЫТЬ АВИАТОР</a>' +
                    '<div style="font-size:10px;margin-top:6px;color:#dcfce7;word-break:break-all;">' + url.substring(0, 100) + '...</div>';
  }

  // 1. Перехват через Fetch
  var origFetch = window.fetch;
  window.fetch = async function(){
    var res = await origFetch.apply(this, arguments);
    var url = arguments[0];
    var urlStr = (typeof url === 'string') ? url : (url && url.url ? url.url : '');
    if(urlStr.includes('game-start') || urlStr.includes('gameproxy')){
      res.clone().json().then(function(data){
        if(data && data.gameStartUrl){
          showDirectLink(data.gameStartUrl);
        }
      }).catch(function(){});
    }
    return res;
  };

  // 2. Перехват через XHR
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(m, u){
    this.__targetUrl = u;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(){
    var self = this;
    this.addEventListener('load', function(){
      if(self.__targetUrl && (self.__targetUrl.includes('game-start') || self.__targetUrl.includes('gameproxy'))){
        try {
          var data = JSON.parse(self.responseText);
          if(data && data.gameStartUrl){
            showDirectLink(data.gameStartUrl);
          }
        } catch(e){}
      }
    });
    return origSend.apply(this, arguments);
  };
})();
