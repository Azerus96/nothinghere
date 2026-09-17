(function () {
  'use strict';

  if (window.__OFC_GTO_LOADED__) {
    console.log('[OFC Engine] Бот уже активен.');
    return;
  }
  window.__OFC_GTO_LOADED__ = true;

  // =========================================================================
  // 1. КОНСТАНТЫ И ПРАВИЛА (54 КАРТЫ, 2 ДЖОКЕРА, ULTIMATE)
  // =========================================================================
  const CAT_HIGH = 0, CAT_PAIR = 1, CAT_TWOPAIR = 2, CAT_TRIPS = 3;
  const CAT_STRAIGHT = 4, CAT_FLUSH = 5, CAT_FULLHOUSE = 6, CAT_QUADS = 7, CAT_STRAIGHTFLUSH = 8;

  const FL_VALUES = { 14: 6.5, 15: 19.6, 16: 41.8, 17: 87.2 };
  const FOUL_PENALTY = 9.0;

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

  // FIX F6: robust parsing — case-insensitive ranks, Unicode suits, rejects garbage
  function parseCard(str) {
    if (!str) return null;
    str = String(str).trim();
    if (!str) return null;
    if (str === 'X1' || str === 'Joker0') return { rank: 0, suit: 'c', raw: str };
    if (str === 'X2' || str === 'Joker1') return { rank: 0, suit: 'd', raw: str };
    const len = str.length;
    if (len < 2) return null;
    const sRaw = str[len - 1];
    const sMap = { 'c': 'c', 'd': 'd', 'h': 'h', 's': 's', 'C': 'c', 'D': 'd', 'H': 'h', 'S': 's', '\u2663': 'c', '\u2666': 'd', '\u2665': 'h', '\u2660': 's' };
    const s = sMap[sRaw];
    if (!s) return null;
    const rStr = str.substring(0, len - 1).trim().toUpperCase();
    let r = 0;
    if (rStr === 'A') r = 14;
    else if (rStr === 'K') r = 13;
    else if (rStr === 'Q') r = 12;
    else if (rStr === 'J') r = 11;
    else if (rStr === 'T' || rStr === '10') r = 10;
    else r = parseInt(rStr, 10);
    if (!(r >= 2 && r <= 14)) return null;
    return { rank: r, suit: s, raw: str };
  }

    function evaluate3(c) {
    if (!c || c.length < 3) return 0;
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
    if (!cards || cards.length < 5) return 0;
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
        if (c >= 4) quad = r; // FIX F7: guard c===5 (impossible hands from demotion enumeration)
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
        else if (hi === 14 && k1 === 5) sh = 5; // Колесо A-2-3-4-5 исправлено
      }

      if (isFlush && sh) return (CAT_STRAIGHTFLUSH << 20) | (sh << 16);
      if (quad) return (CAT_QUADS << 20) | (quad << 16) | ((k0 || 14) << 12); // FIX F7: safe kicker
      if (trip && pairHi) return (CAT_FULLHOUSE << 20) | (trip << 16) | (pairHi << 12);
      if (isFlush) return (CAT_FLUSH << 20) | (k0 << 16) | (k1 << 12) | (k2 << 8) | (k3 << 4) | k4;
      if (sh) return (CAT_STRAIGHT << 20) | (sh << 16);
      if (trip) return (CAT_TRIPS << 20) | (trip << 16) | (k0 << 12) | (k1 << 8);
      if (pairLo) return (CAT_TWOPAIR << 20) | (pairHi << 16) | (pairLo << 12) | (k0 << 8);
      if (pairHi) return (CAT_PAIR << 20) | (pairHi << 16) | (k0 << 12) | (k1 << 8) | (k2 << 4);
      return (CAT_HIGH << 20) | (k0 << 16) | (k1 << 12) | (k2 << 8) | (k3 << 4) | k4;
    }

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

  // Каскадный демут джокера во флеш и стриты
  // FIX F1: off-suit candidate must differ from flushSuit (was 'c' — collided with clubs)
  // FIX F2: skip impossible duplicate-card assignments (joker = card already in hand)
  function key5AtMost(cards, bound) {
    let jc = 0, j0 = -1, j1 = -1;
    let flushSuit = null, allSuited = true;
    const natCard = new Uint8Array(60); // rank*4+suitId
    for (let i = 0; i < 5; i++) {
      if (cards[i].rank === 0) {
        jc++;
        if (j0 === -1) j0 = i; else j1 = i;
      } else {
        if (flushSuit === null) flushSuit = cards[i].suit;
        else if (cards[i].suit !== flushSuit) allSuited = false;
        natCard[cards[i].rank * 4 + (cards[i].suit === 'c' ? 0 : cards[i].suit === 'd' ? 1 : cards[i].suit === 'h' ? 2 : 3)] = 1;
      }
    }
    if (jc === 0) {
      const k = evaluate5(cards);
      return k <= bound ? k : -1;
    }
    let best = -1;
    const buf = cards.map(c => ({ rank: c.rank, suit: c.suit }));
    const offSuit = (flushSuit === 'c') ? 'd' : 'c'; // FIX F1
    const suits = (allSuited && flushSuit !== null) ? [flushSuit, offSuit] : ['c'];
    for (const s of suits) {
      const sId = s === 'c' ? 0 : s === 'd' ? 1 : s === 'h' ? 2 : 3;
      // FIX F2: duplicate-card skips ONLY in the flush-forming branch (mixed-suit reps are value-correct)
      const flushBranch = (allSuited && flushSuit !== null && s === flushSuit);
      if (jc === 1) {
        buf[j0].suit = s;
        for (let r = 14; r >= 2; r--) {
          if (flushBranch && natCard[r * 4 + sId]) continue; // FIX F2
          buf[j0].rank = r;
          const k = evaluate5(buf);
          if (k <= bound && k > best) best = k;
        }
      } else {
        buf[j0].suit = s;
        for (let r1 = 14; r1 >= 2; r1--) {
          if (flushBranch && natCard[r1 * 4 + sId]) continue; // FIX F2
          buf[j0].rank = r1;
          for (let r2 = r1; r2 >= 2; r2--) {
            if (flushBranch && (r2 === r1 || natCard[r2 * 4 + sId])) continue; // FIX F2: identical/impossible cards
            buf[j1].suit = s;
            buf[j1].rank = r2;
            const k = evaluate5(buf);
            if (k <= bound && k > best) best = k;
          }
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
      if (r === 12) return 14;
      if (r === 13) return 15;
      if (r === 14) return 16;
    }
    return 0;
  }

  // =========================================================================
  // 3. FANTASYLAND SOLVER (БЫСТРЫЙ И ТОЧНЫЙ BRANCH & BOUND)
  // =========================================================================
  function solveFantasyland(cards) {
    const n = cards.length;
    let bestObj = -1e9;
    let best = null;
    const flDeadline = Date.now() + 10000; // FIX F10: hard time cap
    let botIter = 0;

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

    // Сортируем боттом по силе для раннего отсечения слабых рук
    const ratedBots = [];
    for (let bIdx of botCombos) {
      const bCards = bIdx.map(i => cards[i]);
      const bKey = evaluate5(bCards);
      ratedBots.push({ bIdx, bKey, bCards });
    }
    ratedBots.sort((x, y) => y.bKey - x.bKey);

    for (let { bIdx, bKey, bCards } of ratedBots) {
      if ((++botIter & 127) === 0 && Date.now() > flDeadline) break; // FIX F10
      // Отсекаем боттомы слабее двух пар, если карт 15+
      if (n >= 15 && (bKey >>> 20) < CAT_TWOPAIR) continue;

      const bMask = (1 << bIdx[0]) | (1 << bIdx[1]) | (1 << bIdx[2]) | (1 << bIdx[3]) | (1 << bIdx[4]);
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
              const stayBonus = FL_VALUES[n] || 20.0;
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
    if (!best) { // FIX F10: emergency greedy fallback — never leave Fantasyland unanswered
      const sorted = cards.slice().sort((x, y) => ((y.rank === 0 ? 15 : y.rank) - (x.rank === 0 ? 15 : x.rank)));
      const bC = sorted.slice(0, 5), mC = sorted.slice(5, 10), tC = sorted.slice(10, 13);
      const bK2 = evaluate5(bC);
      let mK2 = evaluate5(mC); if (mK2 > bK2) mK2 = key5AtMost(mC, bK2);
      let tK2 = evaluate3(tC); if (mK2 >= 0 && tK2 > mK2) tK2 = key3AtMost(tC, mK2);
      if (mK2 >= 0 && tK2 >= 0) {
        const roys = getRoyalties(tK2, mK2, bK2);
        const stays = (bK2 >>> 20) >= CAT_QUADS || ((tK2 >>> 20) === CAT_TRIPS);
        best = { top: tC, middle: mC, bottom: bC, royalties: roys, stays: stays, score: roys };
      }
    }
    return best;
  }

  // =========================================================================
  // 4. НЕБЛОКИРУЮЩИЙСЯ ТАЙМ-БЮДЖЕТНЫЙ SOLVER (3.6 СЕК)
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

  function generateInitialMoves(cards) {
    const candidates = [];
    for (let code = 0; code < 243; code++) {
      let temp = code;
      const t = [], m = [], b = [];
      for (let i = 0; i < 5; i++) {
        const r = temp % 3;
        temp = Math.floor(temp / 3);
        if (r === 0) t.push(cards[i]);
        else if (r === 1) m.push(cards[i]);
        else b.push(cards[i]);
      }
      if (t.length > 3 || m.length > 5 || b.length > 5) continue;
      candidates.push({
        board: { top: t, middle: m, bottom: b },
        moves: [
          ...t.map(c => ({ card: c, row: 'top' })),
          ...m.map(c => ({ card: c, row: 'middle' })),
          ...b.map(c => ({ card: c, row: 'bottom' }))
        ],
        discarded: null,
        simSum: 0, simCount: 0, foulCount: 0, flCount: 0, royaltySum: 0
      });
    }
    return candidates;
  }

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
            simSum: 0, simCount: 0, foulCount: 0, flCount: 0, royaltySum: 0
          });
        }
      }
    }
    return candidates;
  }

  // Безопасная укладка карт: обе карты гарантированно находят слот
  function placeCardInFirstSlot(b, card) {
    if (b.bottom.length < 5) { b.bottom.push(card); return; }
    if (b.middle.length < 5) { b.middle.push(card); return; }
    if (b.top.length < 3) { b.top.push(card); return; }
  }

  // FIX F8: partial Fisher-Yates (only the prefix we deal) + reusable scratch deck
  // FIX F9: opponent-aware full scoring (row wins, scoop, fouls, opponent royalties/FL)
  const rollDeck = new Array(64);
  function simulateRollout(baseBoard, liveDeck) {
    const L = liveDeck.length;
    const myNeed = (3 - baseBoard.top.length) + (5 - baseBoard.middle.length) + (5 - baseBoard.bottom.length);
    let oppStreets = 0, oppCount = 0;
    for (const seat in oppBoards) {
      const ob = oppBoards[seat];
      const need = (3 - ob.top.length) + (5 - ob.middle.length) + (5 - ob.bottom.length);
      oppStreets += Math.ceil(need / 2);
      oppCount++;
    }
    const myStreets = Math.ceil(myNeed / 2); // FIX: ceil — completes odd leftover slot too
    const K = Math.min(L, 3 * (myStreets + oppStreets));
    for (let i = 0; i < L; i++) rollDeck[i] = liveDeck[i];
    for (let i = 0; i < K; i++) {
      const j = i + ((Math.random() * (L - i)) | 0);
      const t = rollDeck[i]; rollDeck[i] = rollDeck[j]; rollDeck[j] = t;
    }

    const simBoard = {
      top: [...baseBoard.top],
      middle: [...baseBoard.middle],
      bottom: [...baseBoard.bottom]
    };
    let ptr = 0;
    for (let s = 0; s < myStreets; s++) {
      if (ptr + 3 > L) break; // safety
      const c0 = rollDeck[ptr++];
      const c1 = rollDeck[ptr++];
      ptr++; // сброс
      placeCardInFirstSlot(simBoard, c0);
      placeCardInFirstSlot(simBoard, c1);
    }

    let bKey = evaluate5(simBoard.bottom);
    let mKey = evaluate5(simBoard.middle);
    let tKey = evaluate3(simBoard.top);

    if (mKey > bKey) mKey = key5AtMost(simBoard.middle, bKey);
    if (tKey > mKey) tKey = key3AtMost(simBoard.top, mKey);

    const fouled = (bKey < mKey) || (mKey < tKey) || (bKey < 0) || (mKey < 0) || (tKey < 0);

    // complete opponents' boards from the same shuffled deck
    let oppDelta = 0;
    for (const seat in oppBoards) {
      const ob = oppBoards[seat];
      const op = { top: [...ob.top], middle: [...ob.middle], bottom: [...ob.bottom] };
      const need = (3 - op.top.length) + (5 - op.middle.length) + (5 - op.bottom.length);
      const st = Math.ceil(need / 2);
      for (let s = 0; s < st; s++) {
        if (ptr + 3 > L) break; // safety
        const c0 = rollDeck[ptr++];
        const c1 = rollDeck[ptr++];
        ptr++;
        placeCardInFirstSlot(op, c0);
        placeCardInFirstSlot(op, c1);
      }
      let obK = evaluate5(op.bottom), omK = evaluate5(op.middle), otK = evaluate3(op.top);
      if (omK > obK) omK = key5AtMost(op.middle, obK);
      if (otK > omK) otK = key3AtMost(op.top, omK);
      const oppFoul = (obK < omK) || (omK < otK) || obK < 0 || omK < 0 || otK < 0;
      if (oppFoul) { oppDelta += 6; continue; }
      const oRoy = getRoyalties(otK, omK, obK);
      const oFl = getFLCards(otK);
      const oFlV = oFl > 0 ? (FL_VALUES[oFl] || 6.5) : 0;
      if (fouled) { oppDelta -= 6 + oRoy + oFlV; continue; }
      let rows = Math.sign(tKey - otK) + Math.sign(mKey - omK) + Math.sign(bKey - obK);
      if (rows === 3) rows += 3; else if (rows === -3) rows -= 3;
      oppDelta += rows - oRoy - oFlV;
    }

    if (oppCount === 0) {
      // no opponent info yet — legacy scoring
      if (fouled) return { score: -FOUL_PENALTY, foul: 1, fl: 0, roy: 0 };
      const roy = getRoyalties(tKey, mKey, bKey);
      const flCards = getFLCards(tKey);
      const flVal = flCards > 0 ? (FL_VALUES[flCards] || 6.5) : 0;
      return { score: roy + flVal, foul: 0, fl: flCards > 0 ? 1 : 0, roy: roy };
    }
    if (fouled) return { score: oppDelta, foul: 1, fl: 0, roy: 0 };
    const roy = getRoyalties(tKey, mKey, bKey);
    const flCards = getFLCards(tKey);
    const flVal = flCards > 0 ? (FL_VALUES[flCards] || 6.5) : 0;
    return { score: oppDelta + roy + flVal, foul: 0, fl: flCards > 0 ? 1 : 0, roy: roy };
  }

    // Асинхронный расчет: кванты по 50 мс не вешают страницу
  function solveStreetBudgetedAsync(currentBoard, drawn, deadCards, isStreet1, onProgress, onDone) {
    const candidates = isStreet1 ? generateInitialMoves(drawn) : generateStreetMoves(currentBoard, drawn);
    if (!candidates || candidates.length === 0) { onDone(null); return; }

    const liveDeck = getLiveDeck([...deadCards, ...drawn]);
    const startTime = Date.now();
    const DURATION = 3600; // 3.6 секунды чистого счета
    let totalSimulations = 0;

    function step() {
      const now = Date.now();
      if (now - startTime >= DURATION) {
        candidates.sort((a, b) => (b.simSum / b.simCount) - (a.simSum / a.simCount));
        const best = candidates[0];
        onDone(best, totalSimulations);
        return;
      }

      // Квант вычислений
      const qStart = Date.now();
      for (let i = 0; i < candidates.length; i++) {
        if ((i & 7) === 0 && Date.now() - qStart > 55) break; // FIX F11: bound quantum wall time
        const c = candidates[i];
        for (let k = 0; k < 6; k++) {
          const res = simulateRollout(c.board, liveDeck);
          c.simSum += res.score;
          c.foulCount += res.foul;
          c.flCount += res.fl;
          c.royaltySum += res.roy;
          c.simCount++;
          totalSimulations++;
        }
      }

      const elapsed = ((now - startTime) / 1000).toFixed(1);
      onProgress(`Счет: <b>${totalSimulations.toLocaleString()}</b> симуляций (${elapsed}s)`);
      setTimeout(step, 0); // Отдаем поток браузеру для плавной отрисовки
    }

    step();
  }

  // =========================================================================
  // 5. ПЕРЕХВАТЧИК WEBSOCKET И UI
  // =========================================================================
  let activeWS = null;
  let mySeat = "0";
  let boardState = { top: [], middle: [], bottom: [] };
  let allDeadCards = [];
  let pendingCards = [];
  let currentStreet = 1;
  let isFantasyland = false;
  let oppBoards = {};   // FIX F9: seat -> {top, middle, bottom} of opponents
  let solving = false;  // FIX F4: re-entrancy guard
  let pendingGeneration = 0; // FIX F4: token to protect pendingCards across delayed sends
  window.__OFC_HOOKS__ = { // test/inspection hook (harmless in production)
    setOppBoards: (o) => { oppBoards = o || {}; },
    getOppBoards: () => oppBoards,
    get solving() { return solving; },
    resetFlags: () => { solving = false; }
  };

  const hud = document.createElement('div');
  hud.style.cssText = `
    position: fixed; top: 10px; right: 10px; z-index: 9999999;
    background: rgba(13, 17, 23, 0.95); color: #58a6ff; padding: 12px 16px;
    border-radius: 8px; border: 1.5px solid #58a6ff; font-family: -apple-system, monospace;
    font-size: 13px; line-height: 1.4; box-shadow: 0 4px 20px rgba(0,0,0,0.8);
    pointer-events: none; min-width: 260px;
  `;
  hud.innerHTML = `<b>OFC GTO Engine</b><br><span style="color:#8b949e">Поиск сокета...</span>`;
  document.body.appendChild(hud);

  function setHUD(text, color = '#58a6ff') {
    hud.style.borderColor = color;
    hud.innerHTML = `<b>OFC GTO Engine</b><br>${text}`;
  }

  function syncBoardFromXML(doc) {
    const hands = doc.querySelectorAll(`CombinationChange[seat="${mySeat}"] Hand, PlayerAction[seat="${mySeat}"] Hand`);
    hands.forEach(h => {
      const name = h.getAttribute('name');
      const rKey = (name === 'FRONT') ? 'top' : (name === 'MIDDLE' ? 'middle' : 'bottom');
      const cards = Array.from(h.querySelectorAll('Card')).map(c => parseCard(c.textContent.trim() || c.getAttribute('name')));
      if (cards.length > 0 && cards.length >= boardState[rKey].length) boardState[rKey] = cards; // FIX: never shrink rows (partial-packet safety)
    });
  }

  function handlePacket(xmlText, ws) {
    if (!activeWS) {
      activeWS = ws;
      setHUD(`<span style="color:#3fb950">Сокет подключен к столу!</span>`);
    }

    if (!xmlText.includes('<Message>') && !xmlText.includes('<TableDetails>')) return;

    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');

    const seatsEl = doc.querySelector('Seats[me]');
    if (seatsEl) mySeat = seatsEl.getAttribute('me');

    // FIX F5: bind to the socket where MY seat receives game events (not just any first Message socket)
    if (doc.querySelector('DealingCards Seat[id="' + mySeat + '"]') || doc.querySelector('ActiveChange[seat="' + mySeat + '"]')) {
      activeWS = ws;
    }

    if (doc.querySelector('NewHand')) {
      boardState = { top: [], middle: [], bottom: [] };
      oppBoards = {}; // FIX F9
      allDeadCards = [];
      pendingCards = [];
      currentStreet = 1;
      isFantasyland = false;
      setHUD(`<span style="color:#e3b341">Новая раздача. Ждем карт...</span>`);
    }

    syncBoardFromXML(doc);

    // FIX F9: track opponents' boards for opponent-aware rollouts
    doc.querySelectorAll('CombinationChange').forEach(cc => {
      const seat = cc.getAttribute('seat');
      if (seat === null || seat === mySeat) return;
      const ob = { top: [], middle: [], bottom: [] };
      let any = false;
      cc.querySelectorAll('Hand').forEach(h => {
        const name = h.getAttribute('name');
        const rKey = (name === 'FRONT') ? 'top' : (name === 'MIDDLE' ? 'middle' : 'bottom');
        const cards = Array.from(h.querySelectorAll('Card'))
          .map(c => parseCard(c.textContent.trim() || c.getAttribute('name'))).filter(Boolean);
        if (cards.length > 0) { ob[rKey] = cards; any = true; }
      });
      if (any) oppBoards[seat] = ob;
    });

    doc.querySelectorAll('Card').forEach(c => {
      const code = c.textContent.trim() || c.getAttribute('name');
      const p = parseCard(code);
      if (p && !allDeadCards.some(d => d.raw === p.raw)) allDeadCards.push(p);
    });

    doc.querySelectorAll('DealingCards').forEach(d => {
      const seatEl = d.querySelector(`Seat[id="${mySeat}"]`);
      if (seatEl) {
        const st = d.getAttribute('street');
        if (st) currentStreet = parseInt(st, 10);
        pendingGeneration++; // FIX F4
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
      triggerTurn();
    }
  }

  function attachToSocket(ws) {
    if (!ws || ws.__ofc_hooked__) return;
    ws.__ofc_hooked__ = true;
    activeWS = ws;

    ws.addEventListener('message', function (ev) {
      if (typeof ev.data === 'string') handlePacket(ev.data, ws);
    });

    if (ws.onmessage && !ws.onmessage.__ofc_wrapped__) {
      const old = ws.onmessage;
      ws.onmessage = function (ev) {
        if (typeof ev.data === 'string') handlePacket(ev.data, ws);
        return old.apply(this, arguments);
      };
      ws.onmessage.__ofc_wrapped__ = true;
    }

    setHUD(`<span style="color:#3fb950">Сокет подключен! Ожидание...</span>`);
  }

  const origSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    attachToSocket(this);
    return origSend.apply(this, arguments);
  };

  const origAdd = WebSocket.prototype.addEventListener;
  WebSocket.prototype.addEventListener = function (type, listener, opt) {
    attachToSocket(this);
    return origAdd.apply(this, arguments);
  };

  // =========================================================================
  // 6. ХОД БОТА
  // =========================================================================
  function triggerTurn() {
    if (solving) return; // FIX F4: no re-entrant solving (duplicate ActiveChange)
    if (!pendingCards || pendingCards.length === 0) return; // FIX F3: desync/empty guard (was: crash)
    solving = true;
    const myGen = pendingGeneration;
    const turnStartTime = Date.now();

    if (isFantasyland) {
      setHUD(`<span style="color:#d2a8ff">Решаем Fantasyland...</span>`);
      setTimeout(() => {
        try {
          const cards = pendingCards.map(c => c.parsed);
          if (cards.length < 13) { solving = false; return; } // FIX F3
          const bestFL = solveFantasyland(cards);

          if (!bestFL) { setHUD(`<span style="color:red">Ошибка Fantasyland!</span>`, 'red'); solving = false; return; }

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
            try {
              activeWS.send(xml);
              setHUD(`<span style="color:#3fb950">Фантазия отправлена! Роялти: ${bestFL.royalties}, Рестей: ${bestFL.stays ? 'ДА' : 'НЕТ'}</span>`, '#3fb950');
            } finally {
              if (myGen === pendingGeneration) pendingCards = []; // FIX F4: don't wipe newer street's cards
              solving = false;
            }
          }, delay);
        } catch (e) {
          solving = false;
          setHUD(`<span style="color:red">Ошибка FL: ${e.message}</span>`, 'red');
        }
      }, 50);
      return;
    }

    const drawn = pendingCards.map(c => c.parsed);
    const isSt1 = (currentStreet === 1);

    solveStreetBudgetedAsync(
      boardState,
      drawn,
      allDeadCards,
      isSt1,
      (progressText) => setHUD(progressText, '#58a6ff'),
      (bestMove, totalSims) => {
        if (!bestMove) { solving = false; setHUD('<span style="color:red">Нет ходов!</span>', 'red'); return; } // FIX F4
        try {
          if (isSt1) {
            let fIdx = 0, mIdx = 0, bIdx = 0;
            let fCards = [], mCards = [], bCards = [];
            let xmlMoves = `<MoveCards>\n  <Moves>\n`;

            pendingCards.forEach(c => {
              const m = bestMove.moves.find(bm => bm.card.raw === c.name);
              const rowName = (m.row === 'top') ? 'FRONT' : (m.row === 'middle' ? 'MIDDLE' : 'BACK');
              const place = (m.row === 'top') ? fIdx++ : (m.row === 'middle' ? mIdx++ : bIdx++);
              xmlMoves += `    <Move id="${c.id}" name="${c.name}" hand="${rowName}" place="${place}"/>\n`;

              if (m.row === 'top') fCards.push(c);
              else if (m.row === 'middle') mCards.push(c);
              else bCards.push(c);
            });
            xmlMoves += `  </Moves>\n</MoveCards>`;

            let xmlLayout = `<LayOut>\n  <Discarded/>\n  <Hands>\n` +
                            `    <Hand name="FRONT"><Cards>${fCards.map(c => `<Card name="${c.name}" id="${c.id}"/>`).join('')}</Cards></Hand>\n` +
                            `    <Hand name="MIDDLE"><Cards>${mCards.map(c => `<Card name="${c.name}" id="${c.id}"/>`).join('')}</Cards></Hand>\n` +
                            `    <Hand name="BACK"><Cards>${bCards.map(c => `<Card name="${c.name}" id="${c.id}"/>`).join('')}</Cards></Hand>\n` +
                            `  </Hands>\n</LayOut>`;

            boardState.top.push(...fCards.map(c => c.parsed));
            boardState.middle.push(...mCards.map(c => c.parsed));
            boardState.bottom.push(...bCards.map(c => c.parsed));

            const elapsed = Date.now() - turnStartTime;
            const delay = Math.max(0, 4000 - elapsed);

            setTimeout(() => {
              try {
                activeWS.send(xmlMoves);
                setTimeout(() => activeWS.send(xmlLayout), 100);
              } finally {
                if (myGen === pendingGeneration) pendingCards = []; // FIX F4
                solving = false;
              }
            }, delay);
            return;
          }

          // Улицы 2-5
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
            try {
              activeWS.send(moveXml);
              setTimeout(() => activeWS.send(layoutXml), 100);
            } finally {
              if (myGen === pendingGeneration) pendingCards = []; // FIX F4
              solving = false;
            }
          }, delay);
        } catch (e) {
          solving = false;
          setHUD(`<span style="color:red">Ошибка: ${e.message}</span>`, 'red');
        }
      }
    );
  }
})();
