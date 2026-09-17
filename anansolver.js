(function () {
  'use strict';

  if (window.__OFC_ENGINE_INSTALLED__) {
    console.warn('[OFC Engine] Уже активен!');
    return;
  }
  window.__OFC_ENGINE_INSTALLED__ = true;

  console.log('%c[OFC Engine] Запуск движка Pineapple + Fantasyland...', 'color: #00ff00; font-weight: bold;');

  // =========================================================================
  // 1. КОНСТАНТЫ, РАНГИ И РОЯЛТИ (POKERDOM / AMERICAN OFC)
  // =========================================================================
  const RANKS = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
  const SUITS = ['c', 'd', 'h', 's'];
  const RANK_NAMES = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

  // =========================================================================
  // 2. ОЦЕНЩИК РУК С ДЖОКЕРАМИ (5-карточный и 3-карточный)
  // =========================================================================
  function parseCard(cardStr) {
    if (!cardStr) return null;
    if (cardStr.startsWith('Joker')) {
      return { rank: 0, suit: 'j', isJoker: true, raw: cardStr };
    }
    const r = RANKS[cardStr[0]];
    const s = cardStr[1];
    return { rank: r, suit: s, isJoker: false, raw: cardStr };
  }

  // Оценка 5-карточной линии (с подстановкой до 2 джокеров)
  function eval5(cards) {
    const jokers = cards.filter(c => c.isJoker);
    const regular = cards.filter(c => !c.isJoker);
    const jCount = jokers.length;

    if (jCount === 0) return eval5Natural(regular);

    // Генерируем возможные варианты замещения джокеров
    let best = { score: -1, type: 0, rankVal: 0 };
    const allRanks = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    const targetSuits = regular.length > 0 ? [regular[0].suit] : ['c'];

    if (jCount === 1) {
      for (let r of allRanks) {
        for (let s of SUITS) {
          const testHand = [...regular, { rank: r, suit: s, isJoker: false }];
          const res = eval5Natural(testHand);
          if (res.score > best.score) best = res;
        }
      }
    } else if (jCount === 2) {
      for (let r1 of allRanks) {
        for (let r2 of allRanks) {
          for (let s of targetSuits) {
            const testHand = [...regular, { rank: r1, suit: s }, { rank: r2, suit: s }];
            const res = eval5Natural(testHand);
            if (res.score > best.score) best = res;
          }
        }
      }
    }
    return best;
  }

  function eval5Natural(cards) {
    const sorted = [...cards].sort((a, b) => b.rank - a.rank);
    const ranks = sorted.map(c => c.rank);
    const isFlush = cards.every(c => c.suit === cards[0].suit);

    // Подсчет повторений
    const counts = {};
    ranks.forEach(r => counts[r] = (counts[r] || 0) + 1);
    const countPairs = Object.entries(counts).map(([r, c]) => ({ rank: +r, count: c }));
    countPairs.sort((a, b) => b.count - a.count || b.rank - a.rank);

    // Проверка стрита
    const uniqueRanks = [...new Set(ranks)];
    let isStraight = false;
    let straightHigh = 0;
    if (uniqueRanks.length === 5) {
      if (ranks[0] - ranks[4] === 4) {
        isStraight = true;
        straightHigh = ranks[0];
      } else if (ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4 && ranks[3] === 3 && ranks[4] === 2) {
        isStraight = true;
        straightHigh = 5; // Колесо (A-2-3-4-5)
      }
    }

    // 8: Royal / Straight Flush, 7: Quads, 6: FullHouse, 5: Flush, 4: Straight, 3: Trips, 2: TwoPair, 1: Pair, 0: High
    let type = 0, score = 0, rankVal = 0;

    if (isFlush && isStraight) {
      type = 8;
      rankVal = straightHigh;
      score = 8000000 + straightHigh;
    } else if (countPairs[0].count === 4) {
      type = 7;
      rankVal = countPairs[0].rank;
      score = 7000000 + countPairs[0].rank * 100 + countPairs[1].rank;
    } else if (countPairs[0].count === 3 && countPairs[1].count === 2) {
      type = 6;
      rankVal = countPairs[0].rank;
      score = 6000000 + countPairs[0].rank * 100 + countPairs[1].rank;
    } else if (isFlush) {
      type = 5;
      rankVal = ranks[0];
      score = 5000000 + ranks[0] * 10000 + ranks[1] * 1000 + ranks[2] * 100 + ranks[3] * 10 + ranks[4];
    } else if (isStraight) {
      type = 4;
      rankVal = straightHigh;
      score = 4000000 + straightHigh;
    } else if (countPairs[0].count === 3) {
      type = 3;
      rankVal = countPairs[0].rank;
      score = 3000000 + countPairs[0].rank * 100 + ranks[3] * 10 + ranks[4];
    } else if (countPairs[0].count === 2 && countPairs[1].count === 2) {
      type = 2;
      rankVal = Math.max(countPairs[0].rank, countPairs[1].rank);
      score = 2000000 + countPairs[0].rank * 100 + countPairs[1].rank * 10 + countPairs[2].rank;
    } else if (countPairs[0].count === 2) {
      type = 1;
      rankVal = countPairs[0].rank;
      score = 1000000 + countPairs[0].rank * 1000 + ranks[2] * 100 + ranks[3] * 10 + ranks[4];
    } else {
      type = 0;
      rankVal = ranks[0];
      score = ranks[0] * 10000 + ranks[1] * 1000 + ranks[2] * 100 + ranks[3] * 10 + ranks[4];
    }
    return { type, score, rankVal };
  }

  // Оценка 3-карточного топа (с джокерами)
  function eval3(cards) {
    const jokers = cards.filter(c => c.isJoker).length;
    const regular = cards.filter(c => !c.isJoker);

    if (jokers === 0) {
      const sorted = [...regular].sort((a, b) => b.rank - a.rank);
      if (sorted[0].rank === sorted[1].rank && sorted[1].rank === sorted[2].rank) {
        return { type: 3, score: 30000 + sorted[0].rank, tripsRank: sorted[0].rank, pairRank: 0 };
      }
      if (sorted[0].rank === sorted[1].rank || sorted[1].rank === sorted[2].rank) {
        const pRank = sorted[1].rank;
        const kicker = (sorted[0].rank === pRank) ? sorted[2].rank : sorted[0].rank;
        return { type: 1, score: 10000 + pRank * 100 + kicker, tripsRank: 0, pairRank: pRank };
      }
      return { type: 0, score: sorted[0].rank * 100 + sorted[1].rank * 10 + sorted[2].rank, tripsRank: 0, pairRank: 0 };
    } else if (jokers === 1) {
      if (regular[0].rank === regular[1].rank) {
        return { type: 3, score: 30000 + regular[0].rank, tripsRank: regular[0].rank, pairRank: 0 };
      }
      const pRank = Math.max(regular[0].rank, regular[1].rank);
      const kicker = Math.min(regular[0].rank, regular[1].rank);
      return { type: 1, score: 10000 + pRank * 100 + kicker, tripsRank: 0, pairRank: pRank };
    } else if (jokers === 2) {
      return { type: 3, score: 30000 + regular[0].rank, tripsRank: regular[0].rank, pairRank: 0 };
    } else {
      return { type: 3, score: 30000 + 14, tripsRank: 14, pairRank: 0 };
    }
  }

  // Роялти
  function getRoyalties(topRes, midRes, botRes) {
    let roy = 0;
    // Top
    if (topRes.type === 3) {
      roy += 10 + (topRes.tripsRank - 2); // 222 = 10 ... AAA = 22
    } else if (topRes.type === 1 && topRes.pairRank >= 12) {
      roy += (topRes.pairRank - 5); // 66=1, 77=2 ... QQ=7, KK=8, AA=9
    } else if (topRes.type === 1 && topRes.pairRank >= 6) {
      roy += (topRes.pairRank - 5);
    }

    // Mid
    if (midRes.type === 8) roy += (midRes.rankVal === 14 ? 50 : 30);
    else if (midRes.type === 7) roy += 20;
    else if (midRes.type === 6) roy += 12;
    else if (midRes.type === 5) roy += 8;
    else if (midRes.type === 4) roy += 4;
    else if (midRes.type === 3) roy += 2;

    // Bot
    if (botRes.type === 8) roy += (botRes.rankVal === 14 ? 25 : 15);
    else if (botRes.type === 7) roy += 10;
    else if (botRes.type === 6) roy += 6;
    else if (botRes.type === 5) roy += 4;
    else if (botRes.type === 4) roy += 2;

    return roy;
  }

  // Проверка правила: Низ >= Середина >= Верх
  function isValidLayout(topRes, midRes, botRes) {
    if (botRes.score < midRes.score) return false;
    // Сравнение Середины с Топом
    if (midRes.type > topRes.type) return true;
    if (midRes.type < topRes.type) return false;
    if (midRes.type === 3) return midRes.rankVal >= topRes.tripsRank;
    if (midRes.type === 1) {
      if (midRes.rankVal !== topRes.pairRank) return midRes.rankVal > topRes.pairRank;
      return true;
    }
    return midRes.rankVal >= topRes.score;
  }

  // Проверка повторной фантазии (Re-Fantasy) в Ultimate
  function isReFantasy(topRes, botRes) {
    return (topRes.type === 3) || (botRes.type >= 7); // Сет в топе или Каре+ внизу
  }

  // =========================================================================
  // 3. FANTASYLAND SOLVER (14-17 КАРТ)
  // =========================================================================
  function solveFantasyland(cards) {
    const n = cards.length;
    let bestLayout = null;
    let bestScore = -999999;

    // Быстрый отбор: генерируем кандидатов для Back (5 карт), затем Middle (5), Top (3)
    const cardIndices = cards.map((_, i) => i);

    // Хелпер комбинаций
    function getCombos(arr, k) {
      const result = [];
      function backtrack(start, combo) {
        if (combo.length === k) { result.push([...combo]); return; }
        for (let i = start; i < arr.length; i++) {
          combo.push(arr[i]);
          backtrack(i + 1, combo);
          combo.pop();
        }
      }
      backtrack(0, []);
      return result;
    }

    // Оптимизированный поиск
    const all5Combos = getCombos(cardIndices, 5);

    for (let bIndices of all5Combos) {
      const bCards = bIndices.map(i => cards[i]);
      const bRes = eval5(bCards);
      if (bRes.score < 2000000 && n >= 14) continue; // Отсекаем совсем слабый низ для ускорения

      const bMask = new Set(bIndices);
      const remaining1 = cardIndices.filter(i => !bMask.has(i));
      const midCombos = getCombos(remaining1, 5);

      for (let mIndices of midCombos) {
        const mCards = mIndices.map(i => cards[i]);
        const mRes = eval5(mCards);
        if (mRes.score > bRes.score) continue; // Фоул между ботом и мидом

        const mMask = new Set(mIndices);
        const remaining2 = remaining1.filter(i => !mMask.has(i));
        const topCombos = getCombos(remaining2, 3);

        for (let tIndices of topCombos) {
          const tCards = tIndices.map(i => cards[i]);
          const tRes = eval3(tCards);

          if (!isValidLayout(tRes, mRes, bRes)) continue;

          const roy = getRoyalties(tRes, mRes, bRes);
          const reFan = isReFantasy(tRes, bRes);

          // ВЕС: Ре-фантазия имеет абсолютный приоритет (+1000 очков)
          const totalScore = (reFan ? 1000 : 0) + roy;

          if (totalScore > bestScore) {
            bestScore = totalScore;
            const usedSet = new Set([...bIndices, ...mIndices, ...tIndices]);
            const discarded = cards.filter((_, idx) => !usedSet.has(idx));
            bestLayout = {
              front: tCards,
              middle: mCards,
              back: bCards,
              discarded: discarded,
              royalties: roy,
              reFantasy: reFan,
              score: totalScore
            };
          }
        }
      }
    }
    return bestLayout;
  }

  // =========================================================================
  // 4. STREET SOLVER (Улицы 1-5)
  // =========================================================================
  function solveStreetPlacement(currentBoard, drawnCards, streetNumber) {
    const { front = [], middle = [], back = [] } = currentBoard;
    
    // 1-я улица: расстановка первых 5 карт
    if (streetNumber === 1 && drawnCards.length === 5) {
      let best = null;
      let maxScore = -999999;
      // Перебор всех распределений 5 карт по 3 линиям (макс: топ 3, мид 5, бот 5)
      for (let f = 0; f <= 3; f++) {
        for (let m = 0; m <= 5 - f; m++) {
          const b = 5 - f - m;
          if (b > 5) continue;
          
          // Простейшая эвристика улицы 1: сильные карты в низ/мид, при QQ+ можно на топ
          const cand = evaluateInitialDistribution(drawnCards, f, m, b);
          if (cand.score > maxScore) {
            maxScore = cand.score;
            best = cand;
          }
        }
      }
      return best;
    }

    // Улицы 2-5: пришло 3 карты, нужно выбрать 1 сброс и 2 положить на доску
    if (drawnCards.length === 3) {
      let bestMove = null;
      let maxScore = -999999;

      for (let dropIdx = 0; dropIdx < 3; dropIdx++) {
        const discarded = drawnCards[dropIdx];
        const keepCards = drawnCards.filter((_, i) => i !== dropIdx);

        // Варианты положить 2 карты в открытые слоты:
        // Возможные позиции: 'FRONT', 'MIDDLE', 'BACK'
        const rows = [];
        if (front.length < 3) rows.push('FRONT');
        if (middle.length < 5) rows.push('MIDDLE');
        if (back.length < 5) rows.push('BACK');

        for (let r1 of rows) {
          for (let r2 of rows) {
            // Проверка лимитов слотов
            let fAdd = (r1 === 'FRONT' ? 1 : 0) + (r2 === 'FRONT' ? 1 : 0);
            let mAdd = (r1 === 'MIDDLE' ? 1 : 0) + (r2 === 'MIDDLE' ? 1 : 0);
            let bAdd = (r1 === 'BACK' ? 1 : 0) + (r2 === 'BACK' ? 1 : 0);

            if (front.length + fAdd > 3) continue;
            if (middle.length + mAdd > 5) continue;
            if (back.length + bAdd > 5) continue;

            const simFront = [...front, ...(r1 === 'FRONT' ? [keepCards[0]] : []), ...(r2 === 'FRONT' ? [keepCards[1]] : [])];
            const simMid = [...middle, ...(r1 === 'MIDDLE' ? [keepCards[0]] : []), ...(r2 === 'MIDDLE' ? [keepCards[1]] : [])];
            const simBack = [...back, ...(r1 === 'BACK' ? [keepCards[0]] : []), ...(r2 === 'BACK' ? [keepCards[1]] : [])];

            const score = scoreIntermediateState(simFront, simMid, simBack);
            if (score > maxScore) {
              maxScore = score;
              bestMove = {
                moves: [
                  { card: keepCards[0], hand: r1 },
                  { card: keepCards[1], hand: r2 }
                ],
                discarded: discarded,
                score: score
              };
            }
          }
        }
      }
      return bestMove;
    }
    return null;
  }

  function evaluateInitialDistribution(cards, f, m, b) {
    // Жадная сортировка по рангу
    const sorted = [...cards].sort((c1, c2) => c2.rank - c1.rank);
    const jokers = sorted.filter(c => c.isJoker);
    const nonJokers = sorted.filter(c => !c.isJoker);

    let top = [], mid = [], bot = [];
    
    // Если есть джокеры, часто выгодно положить их в бэк или миддл
    // Базовая эвристика 1-й улицы:
    const high = nonJokers.slice(0, b);
    const midCards = nonJokers.slice(b, b + m);
    const topCards = nonJokers.slice(b + m);

    return {
      front: topCards,
      middle: midCards,
      back: [...high, ...jokers],
      discarded: [],
      score: (high.length ? high[0].rank * 2 : 0) + (jokers.length * 15)
    };
  }

  function scoreIntermediateState(front, mid, back) {
    let sc = 0;
    // Оцениваем частичные комбинации
    if (back.length === 5 && mid.length === 5) {
      const eB = eval5(back);
      const eM = eval5(mid);
      if (eM.score > eB.score) return -50000; // Риск мертвого борда
    }
    // Фантазийный потенциал QQ+ на топе
    if (front.length >= 2) {
      const eT = eval3(front.length === 2 ? [...front, { rank: 2, suit: 'c', isJoker: false }] : front);
      if (eT.pairRank >= 12 || eT.type === 3) sc += 80;
    }
    // Очки за силу низа
    if (back.length >= 3) {
      const suits = {};
      back.forEach(c => suits[c.suit] = (suits[c.suit] || 0) + 1);
      const maxSuit = Math.max(...Object.values(suits));
      if (maxSuit >= 3) sc += maxSuit * 10; // Флеш-дро
    }
    return sc;
  }

  // =========================================================================
  // 5. WEBSOCKET ПЕРЕХВАТ, ОБРАБОТКА И АВТОХОД ЧЕРЕЗ 4 СЕКУНДЫ
  // =========================================================================
  let activeWS = null;
  let mySeat = "0";
  let currentStreet = 1;
  let boardState = { front: [], middle: [], back: [] };
  let pendingCards = [];
  let isFantasy = false;

  // Создаем плавающий индикатор (HUD)
  const hud = document.createElement('div');
  hud.style.cssText = `
    position: fixed; top: 10px; right: 10px; z-index: 999999;
    background: rgba(10, 15, 25, 0.95); color: #00ffcc; padding: 12px 16px;
    border-radius: 8px; border: 1px solid #00ffcc; font-family: monospace;
    box-shadow: 0 4px 15px rgba(0,0,0,0.5); font-size: 13px; min-width: 250px;
    pointer-events: none; line-height: 1.4;
  `;
  hud.innerHTML = `<b>OFC BOT ENGINE v9.0</b><br><span style="color:#aaa">Ожидание стола...</span>`;
  document.body.appendChild(hud);

  function updateHUD(text, color = '#00ffcc') {
    hud.style.borderColor = color;
    hud.innerHTML = `<b>OFC BOT ENGINE</b><br>${text}`;
  }

  // Хук WebSocket.prototype.send для поиска активного сокета
  const origSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    if (typeof data === 'string' && (data.includes('GetTableDetails') || data.includes('MoveCards') || data.includes('EnterTable'))) {
      activeWS = this;
    }
    return origSend.apply(this, arguments);
  };

  // Хук addEventListener для чтения входящих XML-сообщений стола
  const origAddEventListener = WebSocket.prototype.addEventListener;
  WebSocket.prototype.addEventListener = function (type, listener, options) {
    if (type === 'message') {
      const wrappedListener = function (event) {
        try {
          if (typeof event.data === 'string' && event.data.startsWith('<Message>')) {
            handleServerMessage(event.data, this);
          }
        } catch (e) {
          console.error('[OFC Hook Error]', e);
        }
        return listener.apply(this, arguments);
      };
      return origAddEventListener.call(this, type, wrappedListener, options);
    }
    return origAddEventListener.apply(this, arguments);
  };

  // Парсер серверных XML-сообщений
  function handleServerMessage(xmlStr, ws) {
    activeWS = ws;
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlStr, 'text/xml');

    // Определение своего места
    const seatsEl = doc.querySelector('Seats[me]');
    if (seatsEl) {
      mySeat = seatsEl.getAttribute('me');
    }

    // Новая раздача
    if (doc.querySelector('NewHand')) {
      currentStreet = 1;
      boardState = { front: [], middle: [], back: [] };
      pendingCards = [];
      isFantasy = false;
      updateHUD(`<span style="color:#ffcc00">Новая раздача!</span>`);
    }

    // Раздача карт
    const dealing = doc.querySelectorAll('DealingCards');
    dealing.forEach(d => {
      const seatEl = d.querySelector(`Seat[id="${mySeat}"]`);
      if (seatEl) {
        const st = d.getAttribute('street');
        if (st) currentStreet = parseInt(st);
        const cardEls = seatEl.querySelectorAll('Card');
        pendingCards = Array.from(cardEls).map(c => ({
          id: c.getAttribute('id'),
          name: c.textContent.trim(),
          parsed: parseCard(c.textContent.trim())
        }));

        if (pendingCards.length >= 13) {
          isFantasy = true;
          updateHUD(`<span style="color:#ff00ff">ФАНТАЗИЯ! (${pendingCards.length} карт)</span>`);
        } else {
          updateHUD(`Улица ${currentStreet}: получено ${pendingCards.length} карт`);
        }
      }
    });

    // Ожидание действия от нашего места
    const activeChange = doc.querySelector(`ActiveChange[seat="${mySeat}"]`);
    if (activeChange && pendingCards.length > 0) {
      planAndExecuteTurn();
    }
  }

  // Расчет и исполнение хода с задержкой 4 секунды
  function planAndExecuteTurn() {
    let countdown = 4;
    updateHUD(`<span style="color:#00ff00">Ход бота через ${countdown} сек...</span>`);

    const timer = setInterval(() => {
      countdown--;
      if (countdown > 0) {
        updateHUD(`<span style="color:#00ff00">Ход бота через ${countdown} сек...</span>`);
      } else {
        clearInterval(timer);
        executeDecision();
      }
    }, 1000);
  }

  function executeDecision() {
    if (!activeWS || activeWS.readyState !== WebSocket.OPEN) {
      updateHUD(`<span style="color:red">Ошибка: сокет закрыт!</span>`, 'red');
      return;
    }

    if (isFantasy) {
      // Решение фантазии
      const cardObjects = pendingCards.map(c => c.parsed);
      updateHUD(`Расчет фантазии на ${cardObjects.length} карт...`);
      const flLayout = solveFantasyland(cardObjects);

      if (!flLayout) {
        updateHUD(`<span style="color:red">Фантазия: решение не найдено!</span>`, 'red');
        return;
      }

      // Сопоставляем обратно с серверными ID карт
      function mapToIDs(handList) {
        return handList.map(h => {
          const match = pendingCards.find(pc => pc.name === h.raw);
          return { id: match.id, name: match.name };
        });
      }

      const fIDs = mapToIDs(flLayout.front);
      const mIDs = mapToIDs(flLayout.middle);
      const bIDs = mapToIDs(flLayout.back);
      const dIDs = mapToIDs(flLayout.discarded);

      // Формируем <LayOut>
      let xml = `<LayOut>\n  <Discarded>\n`;
      dIDs.forEach(c => xml += `    <Card name="${c.name}" id="${c.id}"/>\n`);
      xml += `  </Discarded>\n  <Hands>\n`;
      xml += `    <Hand name="FRONT"><Cards>\n`;
      fIDs.forEach(c => xml += `      <Card name="${c.name}" id="${c.id}"/>\n`);
      xml += `    </Cards></Hand>\n`;
      xml += `    <Hand name="MIDDLE"><Cards>\n`;
      mIDs.forEach(c => xml += `      <Card name="${c.name}" id="${c.id}"/>\n`);
      xml += `    </Cards></Hand>\n`;
      xml += `    <Hand name="BACK"><Cards>\n`;
      bIDs.forEach(c => xml += `      <Card name="${c.name}" id="${c.id}"/>\n`);
      xml += `    </Cards></Hand>\n`;
      xml += `  </Hands>\n</LayOut>`;

      activeWS.send(xml);
      updateHUD(`<span style="color:#00ff00">Фантазия отправлена! Роялти: ${flLayout.royalties}, Ре-фантазия: ${flLayout.reFantasy ? 'ДА' : 'НЕТ'}</span>`);
      pendingCards = [];
      return;
    }

    // Обычная улица (1 или 2-5)
    if (currentStreet === 1) {
      const cardObjects = pendingCards.map(c => c.parsed);
      const decision = solveStreetPlacement(boardState, cardObjects, 1);

      // Маппинг карт
      let xmlMoves = `<MoveCards>\n  <Moves>\n`;
      let xmlLayout = `<LayOut>\n  <Discarded/>\n  <Hands>\n`;

      let fIdx = 0, mIdx = 0, bIdx = 0;
      let fCards = [], mCards = [], bCards = [];

      pendingCards.forEach(c => {
        if (decision.front.some(fc => fc.raw === c.name)) {
          xmlMoves += `    <Move id="${c.id}" name="${c.name}" hand="FRONT" place="${fIdx++}"/>\n`;
          fCards.push(c);
        } else if (decision.middle.some(mc => mc.raw === c.name)) {
          xmlMoves += `    <Move id="${c.id}" name="${c.name}" hand="MIDDLE" place="${mIdx++}"/>\n`;
          mCards.push(c);
        } else {
          xmlMoves += `    <Move id="${c.id}" name="${c.name}" hand="BACK" place="${bIdx++}"/>\n`;
          bCards.push(c);
        }
      });
      xmlMoves += `  </Moves>\n</MoveCards>`;

      xmlLayout += `    <Hand name="FRONT"><Cards>${fCards.map(c => `<Card name="${c.name}" id="${c.id}"/>`).join('')}</Cards></Hand>\n`;
      xmlLayout += `    <Hand name="MIDDLE"><Cards>${mCards.map(c => `<Card name="${c.name}" id="${c.id}"/>`).join('')}</Cards></Hand>\n`;
      xmlLayout += `    <Hand name="BACK"><Cards>${bCards.map(c => `<Card name="${c.name}" id="${c.id}"/>`).join('')}</Cards></Hand>\n`;
      xmlLayout += `  </Hands>\n</LayOut>`;

      activeWS.send(xmlMoves);
      setTimeout(() => activeWS.send(xmlLayout), 100);

      boardState.front.push(...fCards.map(c => c.parsed));
      boardState.middle.push(...mCards.map(c => c.parsed));
      boardState.back.push(...bCards.map(c => c.parsed));
      updateHUD(`<span style="color:#00ff00">Улица 1 подтверждена!</span>`);
      pendingCards = [];
    } else {
      // Улицы 2-5
      const cardObjects = pendingCards.map(c => c.parsed);
      const decision = solveStreetPlacement(boardState, cardObjects, currentStreet);

      if (!decision) {
        updateHUD(`<span style="color:red">Ошибка выбора хода!</span>`, 'red');
        return;
      }

      const discardCard = pendingCards.find(c => c.name === decision.discarded.raw);
      const m1Card = pendingCards.find(c => c.name === decision.moves[0].card.raw);
      const m2Card = pendingCards.find(c => c.name === decision.moves[1].card.raw);

      let p1 = decision.moves[0].hand === 'FRONT' ? boardState.front.length : (decision.moves[0].hand === 'MIDDLE' ? boardState.middle.length : boardState.back.length);
      let p2 = decision.moves[1].hand === 'FRONT' ? (boardState.front.length + (decision.moves[0].hand === 'FRONT' ? 1 : 0)) :
               (decision.moves[1].hand === 'MIDDLE' ? (boardState.middle.length + (decision.moves[0].hand === 'MIDDLE' ? 1 : 0)) :
               (boardState.back.length + (decision.moves[0].hand === 'BACK' ? 1 : 0)));

      let xmlMoves = `<MoveCards>\n  <Moves>\n`;
      xmlMoves += `    <Move id="${m1Card.id}" name="${m1Card.name}" hand="${decision.moves[0].hand}" place="${p1}"/>\n`;
      xmlMoves += `    <Move id="${m2Card.id}" name="${m2Card.name}" hand="${decision.moves[1].hand}" place="${p2}"/>\n`;
      xmlMoves += `  </Moves>\n</MoveCards>`;

      let xmlLayout = `<LayOut>\n  <Discarded>\n    <Card name="${discardCard.name}" id="${discardCard.id}"/>\n  </Discarded>\n  <Hands>\n`;
      
      const handsAdded = {};
      handsAdded[decision.moves[0].hand] = (handsAdded[decision.moves[0].hand] || []).concat(m1Card);
      handsAdded[decision.moves[1].hand] = (handsAdded[decision.moves[1].hand] || []).concat(m2Card);

      Object.entries(handsAdded).forEach(([handName, cList]) => {
        xmlLayout += `    <Hand name="${handName}"><Cards>${cList.map(c => `<Card id="${c.id}">${c.name}</Card>`).join('')}</Cards></Hand>\n`;
      });
      xmlLayout += `  </Hands>\n</LayOut>`;

      activeWS.send(xmlMoves);
      setTimeout(() => activeWS.send(xmlLayout), 100);

      // Обновляем виртуальную доску
      if (decision.moves[0].hand === 'FRONT') boardState.front.push(m1Card.parsed);
      else if (decision.moves[0].hand === 'MIDDLE') boardState.middle.push(m1Card.parsed);
      else boardState.back.push(m1Card.parsed);

      if (decision.moves[1].hand === 'FRONT') boardState.front.push(m2Card.parsed);
      else if (decision.moves[1].hand === 'MIDDLE') boardState.middle.push(m2Card.parsed);
      else boardState.back.push(m2Card.parsed);

      updateHUD(`<span style="color:#00ff00">Улица ${currentStreet} сыграна! (Сброс: ${discardCard.name})</span>`);
      pendingCards = [];
    }
  }

  console.log('[OFC Engine] Перехватчик инициализирован успешно.');
})();
