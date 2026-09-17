(function () {
  'use strict';

  if (window.__OFC_REAL_SOLVER__) {
    console.warn('[OFC Solver] Уже запущен!');
    return;
  }
  window.__OFC_REAL_SOLVER__ = true;

  // =========================================================================
  // 1. КОНСТАНТЫ И ВЕСА FANTASYLAND (ИЗ OFC-SOLVER-MAIN)
  // =========================================================================
  const CAT_HIGH = 0, CAT_PAIR = 1, CAT_TWOPAIR = 2, CAT_TRIPS = 3;
  const CAT_STRAIGHT = 4, CAT_FLUSH = 5, CAT_FULLHOUSE = 6, CAT_QUADS = 7, CAT_STRAIGHTFLUSH = 8;

  // Динамическая ценность Fantasyland Ultimate для 54 карт с Джокерами (V14..V17)
  const FL_VALUES_JOKER = { 14: 6.5, 15: 19.6, 16: 41.8, 17: 87.2 };
  const FOUL_WEIGHT = 9.0;

  const BOT_ROY = [0, 0, 0, 0, 2, 4, 6, 10, 15];
  const MID_ROY = [0, 0, 0, 2, 4, 8, 12, 20, 30];
  const ROYAL_KEY = (CAT_STRAIGHTFLUSH << 20) | (14 << 16);

  const WINDOW_MASKS = new Int32Array(15);
  for (let high = 6; high <= 14; high++) {
    let m = 0;
    for (let d = 0; d < 5; d++) m |= (1 << (high - d));
    WINDOW_MASKS[high] = m;
  }
  WINDOW_MASKS[5] = (1 << 14) | (1 << 5) | (1 << 4) | (1 << 3) | (1 << 2);

  // =========================================================================
  // 2. БЕЗАЛЛОКАЦИОННЫЙ 24-БИТНЫЙ ОЦЕНЩИК РУК (FASTEVAL)
  // =========================================================================
  const cnt = new Uint8Array(15);
  const wcnt = new Uint8Array(15);
  const natRanks = new Int32Array(5);

  function cardId(c) {
    if (c.rank === 0) return c.suit === 'c' ? 52 : 53;
    return (c.rank - 2) * 4 + (c.suit === 'c' ? 0 : c.suit === 'd' ? 1 : c.suit === 'h' ? 2 : 3);
  }

  function parseCard(str) {
    if (!str) return null;
    if (str === 'X1' || str === 'Joker0') return { rank: 0, suit: 'c', raw: str };
    if (str === 'X2' || str === 'Joker1') return { rank: 0, suit: 'd', raw: str };
    const len = str.length;
    const s = str[len - 1].toLowerCase();
    const rStr = str.substring(0, len - 1);
    let r = 0;
    if (rStr === 'A') r = 14;
    else if (rStr === 'K') r = 13;
    else if (rStr === 'Q') r = 12;
    else if (rStr === 'J') r = 11;
    else if (rStr === 'T' || rStr === '10') r = 10;
    else r = parseInt(rStr, 10);
    return { rank: r, suit: s, raw: str };
  }

  function evaluate3(c) {
    const a = c[0].rank, b = c[1].rank, d = c[2].rank;
    if (a === 0 || b === 0 || d === 0) {
      let x = (a !== 0) ? a : ((b !== 0) ? b : d);
      let y = (a !== 0 && b !== 0) ? b : ((a !== 0 && d !== 0) ? d : ((b !== 0 && d !== 0) ? d : 0));
      if (y === 0 || x === y) return (CAT_TRIPS << 20) | (x << 16);
      return (CAT_PAIR << 20) | (Math.max(x, y) << 16) | (Math.min(x, y) << 12);
    }
    if (a === b && b === d) return (CAT_TRIPS << 20) | (a << 16);
    if (a === b) return (CAT_PAIR << 20) | (a << 16) | (d << 12);
    if (a === d) return (CAT_PAIR << 20) | (a << 16) | (b << 12);
    if (b === d) return (CAT_PAIR << 20) | (b << 16) | (a << 12);

    let x = a, y = b, z = d, tmp;
    if (x < y) { tmp = x; x = y; y = tmp; }
    if (y < z) { tmp = y; y = z; z = tmp; }
    if (x < y) { tmp = x; x = y; y = tmp; }
    return (CAT_HIGH << 20) | (x << 16) | (y << 12) | (z << 8);
  }

  function evaluate5(cards) {
    let jokers = 0;
    for (let i = 0; i < 5; i++) if (cards[i].rank === 0) jokers++;

    if (jokers === 0) {
      const isFlush = (cards[0].suit === cards[1].suit && cards[0].suit === cards[2].suit &&
                       cards[0].suit === cards[3].suit && cards[0].suit === cards[4].suit);
      cnt.fill(0);
      for (let i = 0; i < 5; i++) cnt[cards[i].rank]++;

      let quad = 0, trip = 0, pairHi = 0, pairLo = 0;
      let k0 = 0, k1 = 0, k2 = 0, k3 = 0, k4 = 0;
      let uniq = 0, hi = 0, lo = 15;

      for (let r = 14; r >= 2; r--) {
        const c = cnt[r];
        if (c === 0) continue;
        uniq++;
        if (r > hi) hi = r;
        if (r < lo) lo = r;
        if (c === 4) quad = r;
        else if (c === 3) trip = r;
        else if (c === 2) {
          if (pairHi === 0) pairHi = r; else pairLo = r;
        } else {
          if (k0 === 0) k0 = r;
          else if (k1 === 0) k1 = r;
          else if (k2 === 0) k2 = r;
          else if (k3 === 0) k3 = r;
          else k4 = r;
        }
      }

      let sh = 0;
      if (uniq === 5) {
        if (hi - lo === 4) sh = hi;
        else if (hi === 14 && k1 === 5) sh = 5; // Стрит-колесо A-2-3-4-5 исправлен!
      }

      if (isFlush && sh) return (CAT_STRAIGHTFLUSH << 20) | (sh << 16);
      if (quad) return (CAT_QUADS << 20) | (quad << 16) | (k0 << 12);
      if (trip && pairHi) return (CAT_FULLHOUSE << 20) | (trip << 16) | (pairHi << 12);
      if (isFlush) return (CAT_FLUSH << 20) | (k0 << 16) | (k1 << 12) | (k2 << 8) | (k3 << 4) | k4;
      if (sh) return (CAT_STRAIGHT << 20) | (sh << 16);
      if (trip) return (CAT_TRIPS << 20) | (trip << 16) | (k0 << 12) | (k1 << 8);
      if (pairLo) return (CAT_TWOPAIR << 20) | (pairHi << 16) | (pairLo << 12) | (k0 << 8);
      if (pairHi) return (CAT_PAIR << 20) | (pairHi << 16) | (k0 << 12) | (k1 << 8) | (k2 << 4);
      return (CAT_HIGH << 20) | (k0 << 16) | (k1 << 12) | (k2 << 8) | (k3 << 4) | k4;
    }

    // Джокерный 5-карточный оценщик
    let sameSuit = true, suit = null, rankMask = 0, hasDup = false, m = 0;
    wcnt.fill(0);

    for (let i = 0; i < 5; i++) {
      const c = cards[i];
      if (c.rank === 0) continue;
      if (suit === null) suit = c.suit;
      else if (c.suit !== suit) sameSuit = false;
      wcnt[c.rank]++;
      if (wcnt[c.rank] > 1) hasDup = true;
      rankMask |= (1 << c.rank);
      natRanks[m++] = c.rank;
    }

    // Сортировка натуральных рангов на месте
    for (let i = 1; i < m; i++) {
      let v = natRanks[i], j = i - 1;
      while (j >= 0 && natRanks[j] < v) { natRanks[j + 1] = natRanks[j]; j--; }
      natRanks[j + 1] = v;
    }

    if (sameSuit && !hasDup) {
      for (let high = 14; high >= 5; high--) {
        if ((rankMask & ~WINDOW_MASKS[high]) === 0) return (CAT_STRAIGHTFLUSH << 20) | (high << 16);
      }
    }
    for (let r = 14; r >= 2; r--) {
      if (wcnt[r] >= 4 - jokers) {
        let jl = jokers - (4 - wcnt[r]);
        let kicker = (jl > 0) ? (r === 14 ? 13 : 14) : 0;
        if (kicker === 0) {
          for (let i = 0; i < m; i++) if (natRanks[i] !== r) { kicker = natRanks[i]; break; }
        }
        return (CAT_QUADS << 20) | (r << 16) | (kicker << 12);
      }
    }
    if (jokers === 1) {
      let p1 = 0, p2 = 0;
      for (let r = 14; r >= 2; r--) {
        if (wcnt[r] === 2) { if (p1 === 0) p1 = r; else if (p2 === 0) p2 = r; }
      }
      if (p1 && p2) return (CAT_FULLHOUSE << 20) | (p1 << 16) | (p2 << 12);
    }
    if (sameSuit) {
      let key = (CAT_FLUSH << 20), need = jokers, filled = 0;
      for (let r = 14; r >= 2 && filled < 5; r--) {
        if (rankMask & (1 << r)) key |= (r << (16 - 4 * filled++));
        else if (need > 0) { key |= (r << (16 - 4 * filled++)); need--; }
      }
      return key;
    }
    if (!hasDup) {
      for (let high = 14; high >= 5; high--) {
        if ((rankMask & ~WINDOW_MASKS[high]) === 0) return (CAT_STRAIGHT << 20) | (high << 16);
      }
    }
    for (let r = 14; r >= 2; r--) {
      if (wcnt[r] >= 3 - jokers) {
        let k0 = 0, k1 = 0;
        for (let i = 0; i < m; i++) {
          if (natRanks[i] === r) continue;
          if (k0 === 0) k0 = natRanks[i]; else { k1 = natRanks[i]; break; }
        }
        return (CAT_TRIPS << 20) | (r << 16) | (k0 << 12) | (k1 << 8);
      }
    }
    return (CAT_PAIR << 20) | (natRanks[0] << 16) | (natRanks[1] << 12) | (natRanks[2] << 8) | (natRanks[3] << 4);
  }

  // Каскадный демут джокеров (Rule of Wilds)
  function key5AtMost(cards, bound) {
    let jc = 0, j0 = -1, j1 = -1;
    for (let i = 0; i < 5; i++) {
      if (cards[i].rank === 0) {
        jc++;
        if (j0 === -1) j0 = i; else j1 = i;
      }
    }
    if (jc === 0) {
      const k = evaluate5(cards);
      return k <= bound ? k : -1;
    }
    let best = -1;
    const buf = cards.map(c => ({ rank: c.rank, suit: c.suit }));
    if (jc === 1) {
      for (let r = 14; r >= 2; r--) {
        buf[j0].rank = r;
        const k = evaluate5(buf);
        if (k <= bound && k > best) best = k;
      }
    } else {
      for (let r1 = 14; r1 >= 2; r1--) {
        buf[j0].rank = r1;
        for (let r2 = r1; r2 >= 2; r2--) {
          buf[j1].rank = r2;
          const k = evaluate5(buf);
          if (k <= bound && k > best) best = k;
        }
      }
    }
    return best;
  }

  function key3AtMost(cards, bound) {
    let jc = 0, j0 = -1, j1 = -1;
    for (let i = 0; i < 3; i++) {
      if (cards[i].rank === 0) {
        jc++;
        if (j0 === -1) j0 = i; else j1 = i;
      }
    }
    if (jc === 0) {
      const k = evaluate3(cards);
      return k <= bound ? k : -1;
    }
    let best = -1;
    const buf = cards.map(c => ({ rank: c.rank, suit: c.suit }));
    if (jc === 1) {
      for (let r = 14; r >= 2; r--) {
        buf[j0].rank = r;
        const k = evaluate3(buf);
        if (k <= bound && k > best) best = k;
      }
    } else {
      for (let r1 = 14; r1 >= 2; r1--) {
        buf[j0].rank = r1;
        for (let r2 = r1; r2 >= 2; r2--) {
          buf[j1].rank = r2;
          const k = evaluate3(buf);
          if (k <= bound && k > best) best = k;
        }
      }
    }
    return best;
  }

  function getRoyalties(topK, midK, botK) {
    let roy = 0;
    const tCat = topK >>> 20;
    if (tCat === CAT_TRIPS) roy += 10 + ((topK >>> 16) & 0xF) - 2;
    else if (tCat === CAT_PAIR) {
      const r = (topK >>> 16) & 0xF;
      if (r >= 6) roy += r - 5;
    }
    roy += (midK === ROYAL_KEY) ? 50 : MID_ROY[midK >>> 20];
    roy += (botK === ROYAL_KEY) ? 25 : BOT_ROY[botK >>> 20];
    return roy;
  }

  function getFLCards(topK) {
    const cat = topK >>> 20;
    if (cat === CAT_TRIPS) return 17;
    if (cat === CAT_PAIR) {
      const r = (topK >>> 16) & 0xF;
      if (r === 12) return 14; // QQ
      if (r === 13) return 15; // KK
      if (r === 14) return 16; // AA
    }
    return 0;
  }

  // =========================================================================
  // 3. FANTASYLAND SOLVER (БЕЗОПАСНЫЙ И ТОЧНЫЙ 13-17 КАРТ)
  // =========================================================================
  function solveFantasyland(cards) {
    const n = cards.length;
    let bestObj = -1e9;
    let best = null;

    function combos5(arr) {
      const res = [];
      const len = arr.length;
      for (let a = 0; a < len; a++)
      for (let b = a + 1; b < len; b++)
      for (let c = b + 1; c < len; c++)
      for (let d = c + 1; d < len; d++)
      for (let e = d + 1; e < len; e++)
        res.push([arr[a], arr[b], arr[c], arr[d], arr[e]]);
      return res;
    }

    const allIndices = Array.from({ length: n }, (_, i) => i);
    const botCombos = combos5(allIndices);

    for (let bIdx of botCombos) {
      const bMask = (1 << bIdx[0]) | (1 << bIdx[1]) | (1 << bIdx[2]) | (1 << bIdx[3]) | (1 << bIdx[4]);
      const bCards = bIdx.map(i => cards[i]);
      const bKey = evaluate5(bCards);
      const botStays = (bKey >>> 20) >= CAT_QUADS;

      const rem1 = allIndices.filter(i => !(bMask & (1 << i)));
      const midCombos = combos5(rem1);

      for (let mIdx of midCombos) {
        const mMask = (1 << mIdx[0]) | (1 << mIdx[1]) | (1 << mIdx[2]) | (1 << mIdx[3]) | (1 << mIdx[4]);
        const mCards = mIdx.map(i => cards[i]);
        let mKey = evaluate5(mCards);

        if (mKey > bKey) {
          mKey = key5AtMost(mCards, bKey);
          if (mKey < 0) continue;
        }

        const used = bMask | mMask;
        const rem2 = allIndices.filter(i => !(used & (1 << i)));
        const rc = rem2.length;

        // Динамический безопасный перебор топа C(rc, 3)
        for (let i0 = 0; i0 < rc - 2; i0++) {
          for (let i1 = i0 + 1; i1 < rc - 1; i1++) {
            for (let i2 = i1 + 1; i2 < rc; i2++) {
              const tCards = [cards[rem2[i0]], cards[rem2[i1]], cards[rem2[i2]]];
              let tKey = evaluate3(tCards);
              if (tKey > mKey) {
                tKey = key3AtMost(tCards, mKey);
                if (tKey < 0) continue;
              }

              const stays = botStays || ((tKey >>> 20) === CAT_TRIPS);
              const roys = getRoyalties(tKey, mKey, bKey);
              const stayBonus = FL_VALUES_JOKER[n] || 20.0;
              // Приоритет рестея: +100000 гарантирует победу ре-фантазии
              const obj = roys + (stays ? (stayBonus + 100000.0) : 0);

              if (obj > bestObj) {
                bestObj = obj;
                best = {
                  top: tCards,
                  middle: mCards,
                  bottom: bCards,
                  royalties: roys,
                  stays: stays,
                  score: stays ? (obj - 100000.0) : obj
                };
              }
            }
          }
        }
      }
    }
    return best;
  }

  // =========================================================================
  // 4. TIME-BUDGETED REAL-TIME SOLVER (ПОЛНЫЕ ВЫЧИСЛЕНИЯ 3.6 СЕК)
  // =========================================================================
  function getFullDeck() {
    const d = [];
    for (let r = 2; r <= 14; r++) for (let s of ['c', 'd', 'h', 's']) d.push({ rank: r, suit: s });
    d.push({ rank: 0, suit: 'c', raw: 'X1' });
    d.push({ rank: 0, suit: 'd', raw: 'X2' });
    return d;
  }

  function getLiveDeck(deadCards) {
    const deadSet = new Set(deadCards.map(cardId));
    return getFullDeck().filter(c => !deadSet.has(cardId(c)));
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // Генерация допустимых ходов улицы (2 карты на борд, 1 сброс)
  function generateStreetMoves(board, drawn) {
    const candidates = [];
    const rows = ['top', 'middle', 'bottom'];

    for (let d = 0; d < 3; d++) {
      const discarded = drawn[d];
      const placed = drawn.filter((_, i) => i !== d);

      for (let r1 of rows) {
        for (let r2 of rows) {
          const tAdd = (r1 === 'top' ? 1 : 0) + (r2 === 'top' ? 1 : 0);
          const mAdd = (r1 === 'middle' ? 1 : 0) + (r2 === 'middle' ? 1 : 0);
          const bAdd = (r1 === 'bottom' ? 1 : 0) + (r2 === 'bottom' ? 1 : 0);

          if (board.top.length + tAdd > 3) continue;
          if (board.middle.length + mAdd > 5) continue;
          if (board.bottom.length + bAdd > 5) continue;

          const nb = {
            top: [...board.top],
            middle: [...board.middle],
            bottom: [...board.bottom]
          };
          nb[r1].push(placed[0]);
          nb[r2].push(placed[1]);

          candidates.push({
            board: nb,
            moves: [{ card: placed[0], row: r1 }, { card: placed[1], row: r2 }],
            discarded: discarded,
            simSum: 0,
            simCount: 0,
            foulCount: 0,
            flCount: 0,
            royaltySum: 0
          });
        }
      }
    }
    return candidates;
  }

  // Честная симуляция добора и завершения раздачи
  function simulateRollout(baseBoard, liveDeck) {
    const deck = shuffle([...liveDeck]);
    const simBoard = {
      top: [...baseBoard.top],
      middle: [...baseBoard.middle],
      bottom: [...baseBoard.bottom]
    };

    let ptr = 0;
    const need = (3 - simBoard.top.length) + (5 - simBoard.middle.length) + (5 - simBoard.bottom.length);
    const streets = Math.floor(need / 2);

    // Доигрывание улиц по честным правилам (из 3 выбираем 2)
    for (let s = 0; s < streets; s++) {
      const c0 = deck[ptr++];
      const c1 = deck[ptr++];
      ptr++; // сброс 1 карты

      if (simBoard.bottom.length < 5) {
        simBoard.bottom.push(c0);
        if (simBoard.middle.length < 5) simBoard.middle.push(c1);
        else if (simBoard.top.length < 3) simBoard.top.push(c1);
      } else if (simBoard.middle.length < 5) {
        simBoard.middle.push(c0);
        if (simBoard.top.length < 3) simBoard.top.push(c1);
      } else if (simBoard.top.length < 3) {
        simBoard.top.push(c0);
      }
    }

    let bKey = evaluate5(simBoard.bottom);
    let mKey = evaluate5(simBoard.middle);
    let tKey = evaluate3(simBoard.top);

    if (mKey > bKey) mKey = key5AtMost(simBoard.middle, bKey);
    if (tKey > mKey) tKey = key3AtMost(simBoard.top, mKey);

    const fouled = (bKey < mKey) || (mKey < tKey) || (mKey < 0) || (tKey < 0);
    if (fouled) return { score: -FOUL_WEIGHT, foul: 1, fl: 0, roy: 0 };

    const roy = getRoyalties(tKey, mKey, bKey);
    const flCards = getFLCards(tKey);
    const flVal = flCards > 0 ? (FL_VALUES_JOKER[flCards] || 6.5) : 0;
    return { score: roy + flVal, foul: 0, fl: flCards > 0 ? 1 : 0, roy: roy };
  }

  // Главный вычислительный цикл на 3.6 секунды чистого времени
  function solveStreetBudgeted(currentBoard, drawn, deadCards, updateHUDCallback) {
    const candidates = generateStreetMoves(currentBoard, drawn);
    if (candidates.length === 0) return null;

    const liveDeck = getLiveDeck([...deadCards, ...drawn]);
    const startTime = Date.now();
    const DEADLINE = startTime + 3600; // 3.6 секунды безостановочных вычислений

    let totalSimulations = 0;

    // Равномерный непрерывный стресс-тест процессора
    while (Date.now() < DEADLINE) {
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        // Пакет по 10 симуляций на кандидата для минимизации накладных расходов таймера
        for (let k = 0; k < 10; k++) {
          const res = simulateRollout(c.board, liveDeck);
          c.simSum += res.score;
          c.foulCount += res.foul;
          c.flCount += res.fl;
          c.royaltySum += res.roy;
          c.simCount++;
          totalSimulations++;
        }
      }
    }

    // Сортировка по математическому ожиданию EV
    candidates.sort((a, b) => (b.simSum / b.simCount) - (a.simSum / a.simCount));
    const best = candidates[0];

    updateHUDCallback(`Просчитано симуляций: <b>${totalSimulations.toLocaleString()}</b><br>` +
                      `EV: <b>+${(best.simSum / best.simCount).toFixed(2)}</b> | ` +
                      `Фантазия: <b>${((best.flCount / best.simCount) * 100).toFixed(1)}%</b> | ` +
                      `Фаул: <b>${((best.foulCount / best.simCount) * 100).toFixed(1)}%</b>`);

    return best;
  }

  // =========================================================================
  // 5. ЖЕЛЕЗОБЕТОННЫЙ ХУК WEBSOCKET И UI ИНДИКАТОР
  // =========================================================================
  let activeWS = null;
  let mySeat = "0";
  let boardState = { top: [], middle: [], bottom: [] };
  let allDeadCards = [];
  let pendingCards = [];
  let currentStreet = 1;
  let isFantasyland = false;

  const hud = document.createElement('div');
  hud.style.cssText = `
    position: fixed; top: 10px; right: 10px; z-index: 9999999;
    background: rgba(13, 17, 23, 0.95); color: #58a6ff; padding: 12px 16px;
    border-radius: 8px; border: 1.5px solid #58a6ff; font-family: -apple-system, monospace;
    font-size: 13px; line-height: 1.4; box-shadow: 0 4px 20px rgba(0,0,0,0.8);
    pointer-events: none; min-width: 260px;
  `;
  hud.innerHTML = `<b>OFC GTO Engine</b><br><span style="color:#8b949e">Подключение к столу...</span>`;
  document.body.appendChild(hud);

  function setHUD(text, color = '#58a6ff') {
    hud.style.borderColor = color;
    hud.innerHTML = `<b>OFC GTO Engine</b><br>${text}`;
  }

  function handlePacket(xmlText, ws) {
    activeWS = ws;
    if (!xmlText.includes('<Message>') && !xmlText.includes('<TableDetails>')) return;

    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');

    const seatsEl = doc.querySelector('Seats[me]');
    if (seatsEl) mySeat = seatsEl.getAttribute('me');

    if (doc.querySelector('NewHand')) {
      boardState = { top: [], middle: [], bottom: [] };
      allDeadCards = [];
      pendingCards = [];
      currentStreet = 1;
      isFantasyland = false;
      setHUD(`<span style="color:#e3b341">Новая раздача. Ждем карт...</span>`);
    }

    // Чтение всех открытых карт стола (Dead Cards)
    doc.querySelectorAll('Card').forEach(c => {
      const code = c.textContent.trim() || c.getAttribute('name');
      const parsed = parseCard(code);
      if (parsed && !allDeadCards.some(d => d.raw === parsed.raw)) {
        allDeadCards.push(parsed);
      }
    });

    // Раздача карт
    doc.querySelectorAll('DealingCards').forEach(d => {
      const seatEl = d.querySelector(`Seat[id="${mySeat}"]`);
      if (seatEl) {
        const st = d.getAttribute('street');
        if (st) currentStreet = parseInt(st, 10);
        pendingCards = Array.from(seatEl.querySelectorAll('Card')).map(c => ({
          id: c.getAttribute('id'),
          name: c.textContent.trim(),
          parsed: parseCard(c.textContent.trim())
        }));

        if (pendingCards.length >= 13) {
          isFantasyland = true;
          setHUD(`<span style="color:#d2a8ff">ФАНТАЗИЯ (${pendingCards.length} карт)</span>`);
        } else {
          setHUD(`Улица ${currentStreet}: получено ${pendingCards.length} карт`);
        }
      }
    });

    const active = doc.querySelector(`ActiveChange[seat="${mySeat}"]`);
    if (active && pendingCards.length > 0) {
      triggerGTOEvaluation();
    }
  }

  // Перехват всех каналов входящих сообщений
  const origOnMessageDesc = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
  Object.defineProperty(WebSocket.prototype, 'onmessage', {
    set: function (fn) {
      const wrapped = function (ev) {
        if (typeof ev.data === 'string') handlePacket(ev.data, this);
        return fn.apply(this, arguments);
      };
      return origOnMessageDesc.set.call(this, wrapped);
    },
    get: function () {
      return origOnMessageDesc.get.call(this);
    },
    configurable: true
  });

  const origAddEventListener = WebSocket.prototype.addEventListener;
  WebSocket.prototype.addEventListener = function (type, listener, opt) {
    if (type === 'message') {
      const wrapped = function (ev) {
        if (typeof ev.data === 'string') handlePacket(ev.data, this);
        return listener.apply(this, arguments);
      };
      return origAddEventListener.call(this, type, wrapped, opt);
    }
    return origAddEventListener.apply(this, arguments);
  };

  const origSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    activeWS = this;
    return origSend.apply(this, arguments);
  };

  // =========================================================================
  // 6. ЗАПУСК ВЫЧИСЛЕНИЙ И ОТПРАВКА ХОДА РОВНО В 4.0 СЕКУНДЫ
  // =========================================================================
  function triggerGTOEvaluation() {
    const turnStartTime = Date.now();

    if (isFantasyland) {
      setHUD(`<span style="color:#d2a8ff">Решаем Fantasyland на GPU/CPU...</span>`);
      setTimeout(() => {
        const cards = pendingCards.map(c => c.parsed);
        const bestFL = solveFantasyland(cards);

        if (!bestFL) { setHUD(`<span style="color:red">Ошибка Fantasyland!</span>`, 'red'); return; }

        function mapIDs(handList) {
          return handList.map(h => pendingCards.find(pc => pc.name === h.raw));
        }

        const f = mapIDs(bestFL.top);
        const m = mapIDs(bestFL.middle);
        const b = mapIDs(bestFL.bottom);
        const d = pendingCards.filter(pc => !f.includes(pc) && !m.includes(pc) && !b.includes(pc));

        let xml = `<LayOut>\n  <Discarded>\n`;
        d.forEach(c => xml += `    <Card name="${c.name}" id="${c.id}"/>\n`);
        xml += `  </Discarded>\n  <Hands>\n`;
        xml += `    <Hand name="FRONT"><Cards>${f.map(c => `<Card name="${c.name}" id="${c.id}"/>`).join('')}</Cards></Hand>\n`;
        xml += `    <Hand name="MIDDLE"><Cards>${m.map(c => `<Card name="${c.name}" id="${c.id}"/>`).join('')}</Cards></Hand>\n`;
        xml += `    <Hand name="BACK"><Cards>${b.map(c => `<Card name="${c.name}" id="${c.id}"/>`).join('')}</Cards></Hand>\n`;
        xml += `  </Hands>\n</LayOut>`;

        const elapsed = Date.now() - turnStartTime;
        const delay = Math.max(0, 4000 - elapsed);

        setTimeout(() => {
          activeWS.send(xml);
          setHUD(`<span style="color:#3fb950">Фантазия отправлена! Роялти: ${bestFL.royalties}, Рестей: ${bestFL.stays ? 'ДА' : 'НЕТ'}</span>`, '#3fb950');
          pendingCards = [];
        }, delay);
      }, 50);
      return;
    }

    // Запуск 3.6 секунд честных симуляций Монте-Карло
    setHUD(`<span style="color:#e3b341">Глубокий Monte Carlo расчет...</span>`);
    setTimeout(() => {
      const drawn = pendingCards.map(c => c.parsed);
      const bestMove = solveStreetBudgeted(boardState, drawn, allDeadCards, (info) => {
        setHUD(info, '#58a6ff');
      });

      if (!bestMove) return;

      const m1 = pendingCards.find(c => c.name === bestMove.moves[0].card.raw);
      const m2 = pendingCards.find(c => c.name === bestMove.moves[1].card.raw);
      const disc = pendingCards.find(c => c.name === bestMove.discarded.raw);

      const r1 = bestMove.moves[0].row === 'top' ? 'FRONT' : (bestMove.moves[0].row === 'middle' ? 'MIDDLE' : 'BACK');
      const r2 = bestMove.moves[1].row === 'top' ? 'FRONT' : (bestMove.moves[1].row === 'middle' ? 'MIDDLE' : 'BACK');

      const p1 = boardState[bestMove.moves[0].row].length;
      const p2 = boardState[bestMove.moves[1].row].length + (bestMove.moves[0].row === bestMove.moves[1].row ? 1 : 0);

      const moveXml = `<MoveCards>\n  <Moves>\n` +
                      `    <Move id="${m1.id}" name="${m1.name}" hand="${r1}" place="${p1}"/>\n` +
                      `    <Move id="${m2.id}" name="${m2.name}" hand="${r2}" place="${p2}"/>\n` +
                      `  </Moves>\n</MoveCards>`;

      const layoutXml = `<LayOut>\n  <Discarded><Card name="${disc.name}" id="${disc.id}"/></Discarded>\n  <Hands>\n` +
                        `    <Hand name="${r1}"><Cards><Card id="${m1.id}">${m1.name}</Card></Cards></Hand>\n` +
                        `    <Hand name="${r2}"><Cards><Card id="${m2.id}">${m2.name}</Card></Cards></Hand>\n` +
                        `  </Hands>\n</LayOut>`;

      boardState[bestMove.moves[0].row].push(m1.parsed);
      boardState[bestMove.moves[1].row].push(m2.parsed);

      const elapsed = Date.now() - turnStartTime;
      const delay = Math.max(0, 4000 - elapsed);

      setTimeout(() => {
        activeWS.send(moveXml);
        setTimeout(() => activeWS.send(layoutXml), 80);
        pendingCards = [];
      }, delay);
    }, 50);
  }

  setHUD(`Ожидание активности стола...<br><span style="color:#8b949e;font-size:11px;">Сделайте клик или дождитесь хода</span>`);
})();
