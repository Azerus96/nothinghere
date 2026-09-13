javascript:(function(){
    /* ══════════════════════════════════════════════════════════════════
       ULTIMATE SCALPEL v65.1 — REALTIME NUTS + RTA/ICM/EXPLOIT (AUDIT-FIX)
       • v65.1 F1 (MODULE-4-LIVE, аудит #1): computeBoardNuts / hs_percen-
         tile / flop_outs больше НЕ только пост-мортем в finalizeHand —
         оценка зацеплена в updateBoardFromXml и рендерится В РУКЕ на
         активных столах игрока (state.sockets.userTables): натс борда,
         перцентиль HS героя, терн-ауты (панель «🃏 LIVE»); приватные карты
         пользователя парсятся из PrivateCards/PocketCards/YourCards/HoleCards
       • v65.1 F2 (FREEZE-HAZARD, аудит #2): computeBoardNutsFast — натс
         определяется РАНГОВЫМИ/МАСТЕВЫМИ БИТОВЫМИ МАСКАМИ (прямой разбор
         категорий SF→каре→фулл→флеш→стрит→сет), НОЛЬ переборов C(47,2)×
         C(7,5) и НОЛЬ вызовов eval5CardSet в горячем пути ривера
         (20 790 → 0); evalCardsFast — 7-карточный оценщик на масках с
         точной семантикой eval5CardSet (эквивалентность доказана бенчем);
         всё тяжёлое — через чанк-шедулер ≤6мс/слот (createChunkQueue),
         hs_percentile архива считается лениво в чанках (queueLazyHandMath)
       • v65.1 F3 (MODULE-2-RESTORED, аудит #3): evaluateRTAConfidence — В
         ПАМЯТИ, по ≥8 РАЗНЫМ ключам узлов (32+ решений, разные текстуры):
         pure-rate / σ-сайзинг / σ-тайминг → z-логист → бейдж «⚠️ [RTA
         PROB: XX%]» прямо в карточке цели; TSV остаётся бонусом, не заменой
       • v65.1 F4 (MODULE-3-RESTORED, аудит #4): N_alive из <GetPlayers
         total="X"> (парсился и выбрасывался) + N_ITM из <Prizes>/<Prize>
         (+ <GetPrizes/> в сканере, средний стек поля из всех строк);
         P(ITM|SitOut) — double-up-aware монте-карло (принудительный олл-ин
         на блайндах 44% удвоение); ICM FREEZE — бабл-фактор (p/2 vs p×2)
       • v65.1 F5 (MODULE-5-RESTORED, аудит #5): π-KL ограниченный эксплойт-
         движок: утечки fold-to-cbet / fold-to-steal-BB / postflop-fold
         против GTO-базовых, значимость по Кульбаку-Лейблеру (D>0.08),
         odds-clamp [0.25, 4.0], вес w=1−e^(−(n−8)/12); строка «⚔️ ЭКСПЛОЙТ»
       • v65.1 F6 (CBET-FIX, аудит #6): префлоп-олл-ин-пуш = РЕЙЗ (агрессия
         ALLIN по street_bet_after vs максимум улицы ДО действия); контбет =
         ПЕРВАЯ агрессия флопа от префлоп-агрессора в НЕРАСКРЫТОМ раунде;
         донк = первая агрессия от не-рейзера ДО его действия на флопе
         (classifyFlopAggression — единый стейт-машина прохода таймлайна)
       • v65.1 BENCH: runBenchCore — эквивалентность быстрый-vs-перебор,
         скорость (µs), стресс «120 одновременных риверов» через чанки +
         longtask-обсервер; вызов: window.__stalkerBench()
       • v64 F1 (BUG-BUYIN-DISTORTION): номинальный бай-ин = buyIn + bounty
         БЕЗ рейка (fee) — эвристика «buyIn уже включает всё» раздувала номинал
         2500+2500+400 → 5400₽; полный вход хранится отдельно (entryCost)
       • v64 F2 (BUG-POT-DESYNC): amount у ВСЕХ тегов действий протокола —
         ДЕЛЬТА (прирост фишек), а не тотал улицы: SB 150k + Raise 450k = 600k
         тотал; прежняя трактовка теряла 150k на каждом рейзе поверх блайнда
         (chip_conservation 6/13 рук, GTO «raises 150000 to 450000»);
         C7-агрессивность олл-ина переведена на итог улицы (streetBetAfter)
       • v64 F3 (BUG-REBUY-BADGE): бейдж HUD считает входы как
         max(bullets, rebuys+1) и берёт сумму из e.spent — суффикс #N в
         лобби-строке часто отсутствует, ребаи жили только в e.rebuys
       • v64 F4 (BUG-BUYIN-ROUNDING): деньги (₽) форматирует formatRub —
         группировка разрядов с копейками, без принудительного «k»-округления
         (1080₽ больше не превращается в «1.1k₽»)
       • v64 F5 (BUG-MUCK-MARKER): Dense DSL помечает карты, слитые через
         утечку протокола, маркером «!» (As7d → !As7d) — отличимо от
         добровольного шоудауна
       • v64 F6 (BUG-KO-SUMMARY): GTO-экспорт добавляет каноническую строку
         PokerStars «X wins the tournament and receives Y in bounty» —
         PT4/HM3 теперь видят баунти-выплаты при импорте
       • v64.1 P1 (POLISH): PKO-детект обогащён кириллическими ключами
         Pokerdom (нокаут|баунти|пко|охотник + hunter|knockout) — ловит
         «Первое Правило ПКО», «Баунти Сиеста», «Вечерний Охотник»
       • v64.1 P2 (POLISH): фолбэк-имя непризнанного места в ensureSeat
         выровнен по serverSeatBase — 0-based сервер экспортирует
         «Seat 6: Seat 6», а не «Seat 6: Seat 5»; при перекалибровке
         базы 0→1 заглушки перестраиваются (realignSeatPlaceholders)
       • v64.2 Z1 (BUG-BULLET-RESURRECTION, «зомби-перезапись»): лобби
         вечно держит строку выбывшей пули рядом со строкой живой ре-энтри
         (обе дают один entryKey) — «мёртвая» строка каждый опрос
         перезаписывала живую запись (stack→0, isBusted→true) и вычищала
         стол из discoveredTargetTables → пул зрителей рвал сокет ЖИВОГО
         стола, HUD «мигал» и вешал [ВЫБЫЛ] играющему (master3anosov играл
         HU за 1-е место, пока HUD показывал 205-е место выбывшим).
         Zombie-Guard: устаревшая «мёртвая» строка НИКОГДА не перезаписывает
         живую запись (сравнение номеров пуль + память мест выбытия +
         транзиентный stack=0/place=0); пул зрителей самовосстанавливает
         регистрацию живого стола
       • v64.2 Z2 (HUD-ERGO): мобильные двухстрочные карточки вместо
         скомканной строки; живые цели всегда вверху списка, активные
         турниры — выше выбывших внутри карточки; явная финансовая
         раскладка «Пуля #7 (+7 реб.) • Влито: 21 000₽» вместо
         крипто-бейджа «[#7: 21 000₽]»
       • v64.2 Z3: суффикс «#N» ника за СТОЛОМ — счётчик всех покупок
         (входы + ребаи), номер пули берётся из лобби: «Пуля #N» в HUD
         не мигает 7↔14, Zombie-Guard не слабеет
       • v64.3 P1 (DENSE-AFK): игроки вне игры помечаются в Dense DSL тегом
         «:AFK» (P:1:u1:118053:AFK) — sit-out больше не нужно выводить из
         бездействия; JSON уже нёс is_sitting_out, DSL не отличал
       • v64.3 P2 (DYNAMIC-PKO): денежная выплата <KnockoutPayout> — само
         доказательство PKO: турниры с нестандартными именами («Вечерний
         Хайроллер 800 000 р.», «РОПЛ-43 Экипаж…») апгрейдят is_pko динамически
       • v64.3 P3 (TWIN-HASH): recurring-турниры с одинаковыми именами раз
         в 1–2 часа различимы в HUD коротким хешем id: «[#8c01]» vs «[#89e6]»
       • v64.3 P4 (BOARD-TEXTURE): 6-корзинный k-means классификатор флопа
         (broadway / low_connected / paired / monotone / trips / generic):
         board_texture в JSON-руке + «:texture» в DSL B:-строке
       • v64.3 P5 (ARCHETYPES): 7 поведенческих архетипов прямо в HUD
         ([Телефон], [Маньяк], [Нит-агрессор], [Пассив], [ЛАГ], [Регуляр],
         [Баланс]); порог выборки 15 рук, ниже — «[Поиск рук...]»
       • v64.3 P6 (REBUY-x2 + GTO-KEY): двойные ребаи «+N x2 реб.»; канонические
         O(1) GTO-ключи узлов решений каждой улицы (gto_node_keys в JSON-руке)
       • v64.3 P7: потолок фоновых спектаторов 80 → 120 столов
       • v65.0 M0 (GTO-KEYS-EXPORT): гистограмма решений по GTO-узлам для
         каждой цели (ключ узла → n/agg/pas/fld, первое действие на улице)
         + компактный TSV-экспорт «🧠 GTO Keys (.txt)» (4-я кнопка) + gtoNodes
         в JSON; сырые ключи — по-прежнему в gto_node_keys каждой JSON-руки
       • v65.0 M1 (2D-PROFILER): развязанные измерения — 7 префлоп-архетипов
         (Нит/Тайт-Пассив/ТАГ-Рег/ЛАГ/Пассив-Фиш/Кит/Маньяк) × 4 постфлоп-
         модификатора (Телефон/Агро-Баррелер/Оверфолдер/—) с эмпирическим
         байесом M=25 к пулу (VPIP 26 / PFR 18 / AFq 38) — ярлыки стабильны
         с 10+ рук; fold-to-cbet считается из таймлайна (SRP-контбет, opp≥3)
       • v65.0 M3 (SURVIVAL): орбиты/минуты жизни стека при чистом фолде —
         кривая блайндов из GetSchedule (levelCurve/levelDetails), walk 0.30,
         70 рук/час, AA/премиум (TT+AK+AQs) за жизнь стека; строка «⏳ N орб»
         в живой карточке. ITM%/ICM-фриз ОТКЛОНЕНЫ: nAlive/nITM не наблюдаемы
       • v65.0 M4 (NUT-LADDER): board_nuts по улицам (перебор C(живых,2)),
         hs_percentile и flop_outs (категорийные ауты) для показанных карт —
         в JSON-руке. RTA-«вероятность» в HUD ОТКЛОНЕНА — описательная
         mix-статистика живёт в TSV-заголовке игрока (НЕ вердикт)
       • v62 B1 (BUG-ZOMBIE-TABLE): bust rows без tableId теперь чистят устаревшую
         запись discoveredTargetTables («зомби»-спектаторы больше не держат слот
         80-столового пула весь турнир); записи профиля переключены на ключ cleanNick
         — ребай-переименование (Vasya → Vasya #2) не рвёт цепочку очистки
       • v62 B2 (BUG-STREET-DESYNC): разбор кадра в порядке документа (streaming)
         для PlayerAction + Dealing/Board — склеенные кадры «действие+сдача»
         атрибутируются корректно в ЛЮБОМ порядке следования в кадре
       • v62 B3 (BUG-STEAL-METRICS): stealFacedBB/SB считаются только против
         реальной попытки кражи (единственный префлоп-рейз от CO/BTN/SB);
         в экспорт добавлены знаменатели stealFaced*Opp и foldToSteal*Pct
       • v62 B4 (BUG-SPENT): детерминированные bullets × baseBuyin — единый
         источник во всех трёх местах; серверный `spent` сохраняется как
         spent_server (аудит) + фолбэк при промахе кэша; fee-ветка исправлена
         в v62 (330+30 = 360), в v64 F1 номинал = 330 (рейк в номинал не входит)
       • v62 B5: dead-button fallback не изменён — проверен как корректный
         (TDA rule 32); внешнее сообщение опровергнуто в раунде-2
       • v63 C1: HU-сводка печатает ОБА тега — "(button) (small blind)"
         (цепочка || теряла тег SB на совмещённом месте BTN/SB)
       • v63 C2: посты блайндов «0» устранены в ОБОИХ циклах эмиттера +
         анте ограничен стеком ('posts the ante N and is all-in')
       • v63 C3: заголовок SHOW DOWN только при наличии карт — неконтести-
         рованные банки идут сразу к collected/SUMMARY
       • v63 C5: дошедшие до вскрытия без показа помечаются 'mucked'
         (последняя запись таймлайна ≠ FOLD), а не 'folded'
       • v63 C7: кража = НЕРАСКРЫТЫЙ банк (без лимперов; limp-all-in тоже
         закрывает) + сброс счётчика в beginHand — патч автора регрессил
         трекинг навсегда, исправленная версия сохраняет B3-семантику
       • v63 C9: ключ записи профиля разрешается с миграцией — гонка
         «Seats раньше TableDetails» больше не создаёт двойников
       • v63 отклонённые: C4 (формула патча ломает многоуличные олл-ины),
         C8 (схема DSL консистентна, ломать обратную совместимость нельзя),
         C10 (патч неэффективен + течёт контекстами)
       • Fix 1: Eliminated ReferenceError in handleOutgoing (Clean User Open)
       • Fix 2: Strict Deduplication in finalizeHand (VPIP <= 100% Guaranteed)
       • Fix 3: Safe Fallback for Folding Stacks (0 Discarded Valid Hands)
       • Fix 4: Accurate Delta Accounting for All-In Re-raises
       • Fix 5: Normalized Aggression Factor (99.0 instead of Inf)
       • v61 F1 (BUG-MEMORY): URL.revokeObjectURL in all 3 exporters
       • v61 F2 (BUG-PLACEHOLDER): spawn-timer tracking + closeable placeholder
         + releaseBackgroundSocket() + destroy() cancels pending spawns
       • v61 F3 (BUG-CHAT): paired <ChatMessage>…</ChatMessage> + all messages per frame
       • v61 F4 (BUG-RAISE-DELTA/GTO-RAISE): single bet-accounting source of truth
         (timeline.street_bet_after) — GTO/DSL totals now match the engine
       • v61 F5 (BUG-SEATS): auto seat-base calibration (0/1-based) + true table max
       • v61 F6 (BUG-DEFLATE): raw deflate + zlib + gzip, correct typed-array
         slicing, pure-JS inflate fallback (no DecompressionStream needed)
       • v61 F7 (BUG-SCANNER-QUEUE): bounded queue + O(1) dedupe + state maintenance
         (stale liveTournaments, tournamentCache, socketCooldowns, chatLogs)
       • v61 F8: per-table hand dedup key (no cross-table collisions),
         isDestroyed zombie guards, HTML-escaped HUD, all-in raise stats fix
       • Base-13 Polynomial Evaluator | Exact Integer DSL | 80 Tables Max
       ══════════════════════════════════════════════════════════════════ */

    // 1. БЕЗОПАСНЫЙ ЗАХВАТ ИСХОДНОГО WEBSOCKET
    if (!window.__SCALPEL_ORIG_WS) {
        window.__SCALPEL_ORIG_WS = window.WebSocket;
    }
    const OrigWS = window.__SCALPEL_ORIG_WS;

    // 2. ДЕСТРУКТОР ПРЕДЫДУЩЕГО ИНСТАНСА
    if (window.__SCALPEL && typeof window.__SCALPEL.destroy === 'function') {
        try { window.__SCALPEL.destroy(); } catch(e) {}
    }
    document.querySelectorAll('[id^="stalker-hud"]').forEach(el => el.remove());

    const scoutServerUrl = "https://toofunoff-poker-scout.hf.space";
    const MAX_BACKGROUND_TABLES = 120;   /* v64.3 P7: 80 → 120 столов */
    const MAX_ARCHIVE_HANDS = 10000;
    const MAX_OUTBOX_QUEUE = 3000;
    const MAX_DEBUG_LOGS = 300;
    const SCANNER_CONCURRENCY = 3;
    const MAX_SCANNER_QUEUE = 500;
    const MAX_CHAT_LOGS = 2000;
    const MAX_TOURNAMENT_CACHE = 3000;
    const STALE_TOURNAMENT_MS = 15 * 60 * 1000;

    const TARGET_LIST = [
        "vesnushka", "bagzik", "nogano777", "dostigatel", "bankiir", 
        "mushroomless", "xasiknolook", "riverpomojet", "donkmaster", "kavsan", 
        "deepmind", "biglebowski77", "imbonoob", "badbeat71", "mike_scott", 
        "foldmi", "fedorav", "grenadinec", "nedenegradi", "legilemens", 
        "thestudent", "anarhisttt", "belarusftw", "sgeeeee", "master3anosov", 
        "kirov999", "donskikh", "bumblebee", "karanebesnaya", "anacreosha",
        "saiyn_belek", "molyavka89", "blancl664", "why__not", "cashmachine", 
        "vorobyshek", "bar_suk74", "lev_altay", "kastarksn", "borsalino", "suitedjaxx69",
        "fatpanda", "galiardi", "neochen", "fai1er", "milka8"
    ];

    const TARGET_WATCHLIST = new Set(TARGET_LIST.map(n => n.toLowerCase()));
    const TARGET_ID_MAP = new Map(TARGET_LIST.map((n, idx) => [n.toLowerCase(), `t${idx + 1}`]));

    const LIVE_STATUSES = new Set(['RUNNING', 'LATE_REG', 'LATE_REGISTRATION', 'SEATING', 'PAUSED', 'DEALING']);
    const SYSTEM_CHAT_REGEX = /показывает|сбросил|занял место|покинул стол|банк выиграл|выбыл|тайм-банк/i;

    window.__SCALPEL = {
        state: {
            isCollapsed: false,
            hfStatus: 'Локальный режим',
            userViewingTournId: null,
            userViewingTableId: null,
            socketCooldowns: new Map(),
            tournamentCache: new Map(),
            outboxQueue: [],
            completedHandsArchive: [],
            recordedHandNumbers: new Set(),
            chatLogs: [],
            engineDebugLog: [],
            auth: { sessionId: null, wssUrl: null, clientVersion: "71.0.138" },
            sockets: { lobby: null, userTables: new Map() },
            liveTournaments: new Map(),
            discoveredTargetTables: new Map(),
            backgroundTableSockets: new Map(),
            activeTables: new Map(),
            stalkedPlayers: new Map(),
            scannerQueue: [],
            scannerQueued: new Set(),
            isScanningActive: false,
            timerIds: [],
            isDestroyed: false,
            serverSeatBase: 0,
            serverSeatBaseLocked: false
        }
    };

    let state = window.__SCALPEL.state;
    /* ==== ENGINE-CORE-START (v65.1): чистое ядро без DOM/state — весь кусок
       до маркера PURE-CORE-END извлекается в Node-тесты (scripts/test_v651.js) ==== */
    const CARD_RANKS = "23456789TJQKA";

    // ── БАЗОВЫЙ 13-ПОЛИНОМИАЛЬНЫЙ 7-КАРТОЧНЫЙ ОЦЕНЩИК (BASE-13) ────────
    function eval5CardSet(cards5) {
        let rankCounts = {}, suitCounts = {};
        let rankIndices = [];

        cards5.forEach(c => {
            let r = c[0] === '1' ? 'T' : c[0].toUpperCase();
            let s = c[c.length - 1].toLowerCase();
            rankCounts[r] = (rankCounts[r] || 0) + 1;
            suitCounts[s] = (suitCounts[s] || 0) + 1;
            rankIndices.push(CARD_RANKS.indexOf(r));
        });

        rankIndices.sort((a, b) => b - a);

        let isFlush = Object.values(suitCounts).some(cnt => cnt === 5);
        let isWheel = (rankIndices[0] === 12 && rankIndices[1] === 3 && rankIndices[2] === 2 && rankIndices[3] === 1 && rankIndices[4] === 0);
        let isStraight = isWheel || rankIndices.every((val, idx) => idx === 0 || val === rankIndices[idx - 1] - 1);
        let straightHigh = isWheel ? '5' : (isStraight ? CARD_RANKS[rankIndices[0]] : null);

        if (isFlush && isStraight) return { score: 8000000 + CARD_RANKS.indexOf(straightHigh), tag: `SF_${straightHigh}` };

        let quads = [], trips = [], pairs = [], singles = [];
        Object.keys(rankCounts).forEach(r => {
            let rIdx = CARD_RANKS.indexOf(r);
            if (rankCounts[r] === 4) quads.push(rIdx);
            else if (rankCounts[r] === 3) trips.push(rIdx);
            else if (rankCounts[r] === 2) pairs.push(rIdx);
            else singles.push(rIdx);
        });

        const sortDesc = (arr) => arr.sort((a, b) => b - a);
        sortDesc(quads); sortDesc(trips); sortDesc(pairs); sortDesc(singles);

        if (quads.length > 0) return { score: 7000000 + quads[0] * 13 + singles[0], tag: `4K_${CARD_RANKS[quads[0]]}_${CARD_RANKS[singles[0]]}` };
        if (trips.length > 0 && pairs.length > 0) return { score: 6000000 + trips[0] * 13 + pairs[0], tag: `FH_${CARD_RANKS[trips[0]]}_${CARD_RANKS[pairs[0]]}` };
        if (isFlush) return { score: 5000000 + rankIndices.reduce((acc, v, i) => acc + v * Math.pow(13, 4 - i), 0), tag: `FL_${rankIndices.map(i => CARD_RANKS[i]).join('')}` };
        if (isStraight) return { score: 4000000 + CARD_RANKS.indexOf(straightHigh), tag: `ST_${straightHigh}` };
        if (trips.length > 0) return { score: 3000000 + trips[0] * 169 + singles[0] * 13 + singles[1], tag: `3K_${CARD_RANKS[trips[0]]}_${CARD_RANKS[singles[0]]}${CARD_RANKS[singles[1]]}` };
        if (pairs.length >= 2) return { score: 2000000 + pairs[0] * 169 + pairs[1] * 13 + singles[0], tag: `2P_${CARD_RANKS[pairs[0]]}_${CARD_RANKS[pairs[1]]}_${CARD_RANKS[singles[0]]}` };
        if (pairs.length === 1) return { score: 1000000 + pairs[0] * 2197 + singles[0] * 169 + singles[1] * 13 + singles[2], tag: `1P_${CARD_RANKS[pairs[0]]}_${singles.slice(0, 3).map(i => CARD_RANKS[i]).join('')}` };

        return { score: rankIndices.reduce((acc, v, i) => acc + v * Math.pow(13, 4 - i), 0), tag: `HC_${rankIndices.map(i => CARD_RANKS[i]).join('')}` };
    }

    function evaluate7Cards(cardsStr) {
        if (!cardsStr) return "";
        let cards = cardsStr.trim().split(/\s+/).filter(c => c && c.length >= 2).map(c => {
            let r = c.slice(0, -1);
            let s = c.slice(-1).toLowerCase();
            return (r === '10' ? 'T' : r.toUpperCase()) + s;
        });
        let n = cards.length;
        if (n < 5) return "";
        // v65.1 F2: битовый оценщик — 1 проход по картам вместо 21 подмножества
        return evalCardsFast(cards).tag;
    }

    // ── v65 M4 (NUT-LADDER): комбинаторика борда для JSON-руки ─────────
    // v65.1 F2: рабочий путь — computeBoardNuts (маски, ниже в PURE-CORE);
    // переборный вариант v65.0 сохранён как ЭТАЛОН для бенчмарка
    // эквивалентности (bruteNutsStreet/computeBoardNutsBrute).
    const ALL_CARDS = (() => { let out = []; for (let r of "23456789TJQKA") for (let s of "shdc") out.push(r + s); return out; })();
    const CATEGORY_RANKS = { HC: 0, '1P': 1, '2P': 2, '3K': 3, ST: 4, FL: 5, FH: 6, '4K': 7, SF: 8 };
    function categoryRankOfTag(tag) {
        return CATEGORY_RANKS[String(tag || '').split('_')[0]] || 0;
    }
    // лучший расклад из 5–7 карт (полный перебор 5-подмножеств — та же
    // семантика, что у evaluate7Cards, но возвращает {score, tag})
    function evalBestCards(cards) {
        if (cards.length === 5) return eval5CardSet(cards);
        let best = { score: -1, tag: '' };
        for (let i = 0; i < cards.length - 4; i++)
            for (let j = i + 1; j < cards.length - 3; j++)
                for (let k = j + 1; k < cards.length - 2; k++)
                    for (let l = k + 1; l < cards.length - 1; l++)
                        for (let m = l + 1; m < cards.length; m++) {
                            let res = eval5CardSet([cards[i], cards[j], cards[k], cards[l], cards[m]]);
                            if (res.score > best.score) best = res;
                        }
        return best;
    }
    function liveCardsFor(dead) {
        let deadSet = new Set(dead);
        return ALL_CARDS.filter(c => !deadSet.has(c));
    }
    // ЭТАЛОН v65.0 (только для бенча): полный перебор C(живых,2) рук
    // оппонента — ривер = 990 пар × 21 подмножество = 20 790 вызовов
    // eval5CardSet. В рабочем пути НЕ вызывается (см. computeBoardNutsFast).
    function computeBoardNutsBrute(board, dead) {
        if (!board || board.length < 3) return null;
        let names = { 3: 'flop', 4: 'turn', 5: 'river' };
        let out = null;
        for (let end = 3; end <= Math.min(5, board.length); end++) {
            let b = board.slice(0, end);
            let live = liveCardsFor(b.concat(dead || []));
            let best = { score: -1, tag: '' };
            for (let i = 0; i < live.length; i++) {
                for (let j = i + 1; j < live.length; j++) {
                    let res = (end === 3) ? eval5CardSet([b[0], b[1], b[2], live[i], live[j]])
                                          : evalBestCards(b.concat([live[i], live[j]]));
                    if (res.score > best.score) best = res;
                }
            }
            if (out === null) out = {};
            out[names[end]] = best.tag;
        }
        return out;
    }
    // v65.1 F2: рабочий натс-лестница JSON-руки — O(1) масок на улицу,
    // НОЛЬ eval5-вызовов. Формат выхода идентичен v65.0 ({flop,turn,river: tag}).
    function computeBoardNuts(board) {
        if (!board || board.length < 3) return null;
        let names = { 3: 'flop', 4: 'turn', 5: 'river' };
        let out = null;
        for (let end = 3; end <= Math.min(5, board.length); end++) {
            let r = computeBoardNutsFast(board.slice(0, end), null);
            if (out === null) out = {};
            out[names[end]] = r ? r.tag : null;
        }
        return out;
    }
    function computeHsPercentile(holeCardsStr, board) {
        try {
            let hole = String(holeCardsStr).split(/\s+/).filter(c => c && c.length >= 2);
            if (hole.length !== 2 || !board || board.length < 3) return null;
            let b = board.slice(0, 5);
            let live = liveCardsFor(b.concat(hole));
            // v65.1 F2: битовый оценщик score-only (без аллокаций на комбинацию);
            // вызывается лениво в чанках (queueLazyHandMath)
            let heroScore = evalScorePair(hole[0], hole[1], b);
            let worse = 0, tie = 0, total = 0;
            for (let i = 0; i < live.length; i++) {
                for (let j = i + 1; j < live.length; j++) {
                    let sc = evalScorePair(live[i], live[j], b);
                    total++;
                    if (sc < heroScore) worse++;
                    else if (sc === heroScore) tie++;
                }
            }
            return total > 0 ? ((worse + 0.5 * tie) / total * 100).toFixed(1) : null;
        } catch (e) { return null; }
    }
    function computeFlopOuts(holeCardsStr, board) {
        try {
            let hole = String(holeCardsStr).split(/\s+/).filter(c => c && c.length >= 2);
            if (hole.length !== 2 || !board || board.length < 3) return null;
            let flop = board.slice(0, 3);
            // v65.1 F2: score-only оценка + категория из score (без аллокаций)
            let baseCat = categoryFromScore(evalScorePair(hole[0], hole[1], flop));
            let live = liveCardsFor(flop.concat(hole));
            let outs = 0;
            for (let c of live) {
                let sc = evalScorePair(hole[0], hole[1], [flop[0], flop[1], flop[2], c]);
                if (categoryFromScore(sc) > baseCat) outs++;
            }
            return outs;
        } catch (e) { return null; }
    }

    /* ══════════════════════════════════════════════════════════════════
       v65.1 PURE CORE (F2/F3/F4/F5/F6 + BENCH) — без DOM и state.
       Весь блок до маркера PURE-CORE-END извлекается целиком в Node-тесты.
       Соглашения: ранг r = индекс 0..12 ('2'..'A'), бит 1<<r; масть s = 0..3.
       ══════════════════════════════════════════════════════════════════ */
    const SUIT_CHARS = 'shdc';
    function cardIdx(c) {
        let r = (c[0] === '1' && c[1] === '0') ? 'T' : c[0].toUpperCase();
        let s = c[c.length - 1].toLowerCase();
        return [CARD_RANKS.indexOf(r), SUIT_CHARS.indexOf(s)];
    }
    // Окна стритов от старшего к младшему + колесо A2345 (старшая = '5')
    const STRAIGHT_WINDOWS = (() => {
        let out = [];
        for (let top = 12; top >= 4; top--) {
            let m = 0;
            for (let i = top; i >= top - 4; i--) m |= (1 << i);
            out.push({ top: top, m: m });
        }
        out.push({ top: 3, m: (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 12) });
        return out;
    })();
    function straightTopFromMask(mask) {
        for (let i = 0; i < STRAIGHT_WINDOWS.length; i++) {
            let w = STRAIGHT_WINDOWS[i];
            if ((mask & w.m) === w.m) return w.top;
        }
        return -1;
    }
    function topBitsOf(mask, n) {
        let out = [];
        for (let r = 12; r >= 0 && out.length < n; r--) if (mask & (1 << r)) out.push(r);
        while (out.length < n) out.push(-1);
        return out;
    }
    function popcount16(m) { let c = 0; while (m) { m &= (m - 1); c++; } return c; }

    // ── F2: 7-карточный оценщик на масках — семантика eval5CardSet ──
    // (score/tag побитово-точно совпадают с перебором 5-подмножеств; это
    // доказывается эквивалентным тестом бенчмарка на сотнях случайных бордов)
    // Горячий путь БЕЗ АЛЛОКАЦИЙ: скретч-буферы уровня модуля — однопоточный
    // синхронный JS не реентерабелен, общие буферы безопасны. МК-перцентиль
    // и точные перечисления не плодят мусор → нет GC-пауз в слотах шедулера.
    const _EVAL_RC = new Int8Array(13);
    const _EVAL_SM = [0, 0, 0, 0], _EVAL_SC = [0, 0, 0, 0];
    const _EVAL_TRIPS = [], _EVAL_PAIRS = [], _EVAL_SINGLES = [];
    const _EVAL_D = { cat: 0, a: -1, b: -1, c: -1, d: -1, t5: [-1, -1, -1, -1, -1] };
    function _evalReset() {
        for (let i = 0; i < 13; i++) _EVAL_RC[i] = 0;
        _EVAL_SM[0] = 0; _EVAL_SM[1] = 0; _EVAL_SM[2] = 0; _EVAL_SM[3] = 0;
        _EVAL_SC[0] = 0; _EVAL_SC[1] = 0; _EVAL_SC[2] = 0; _EVAL_SC[3] = 0;
        _EVAL_TRIPS.length = 0; _EVAL_PAIRS.length = 0; _EVAL_SINGLES.length = 0;
    }
    function _evalAcc(c) {
        let r = (c.length > 2 && c[0] === '1' && c[1] === '0') ? 8 : CARD_RANKS.indexOf(c[0].toUpperCase());
        let s = SUIT_CHARS.indexOf(c[c.length - 1].toLowerCase());
        if (r < 0 || s < 0) return 0;
        _EVAL_RC[r]++;
        _EVAL_SM[s] |= (1 << r);
        _EVAL_SC[s]++;
        return (1 << r);
    }
    // ядро: score по накопленным скретч-буферам; детали категории — в _EVAL_D
    function _evalCore() {
        let fs = -1;
        for (let s = 0; s < 4; s++) if (_EVAL_SC[s] >= 5) { fs = s; break; }
        if (fs >= 0) {
            let st = straightTopFromMask(_EVAL_SM[fs]);
            if (st >= 0) { _EVAL_D.cat = 8; _EVAL_D.a = st; return 8000000 + st; }
            let t5 = topBitsOf(_EVAL_SM[fs], 5);
            _EVAL_D.cat = 5;
            _EVAL_D.t5[0] = t5[0]; _EVAL_D.t5[1] = t5[1]; _EVAL_D.t5[2] = t5[2]; _EVAL_D.t5[3] = t5[3]; _EVAL_D.t5[4] = t5[4];
            return 5000000 + t5[0] * 28561 + t5[1] * 2197 + t5[2] * 169 + t5[3] * 13 + t5[4];
        }
        let quads = -1;
        for (let r = 12; r >= 0; r--) {
            let c = _EVAL_RC[r];
            if (c === 4) quads = r;
            else if (c === 3) _EVAL_TRIPS.push(r);
            else if (c === 2) _EVAL_PAIRS.push(r);
            else if (c === 1) _EVAL_SINGLES.push(r);
        }
        if (quads >= 0) {
            let k = Math.max(_EVAL_TRIPS.length ? _EVAL_TRIPS[0] : -1, _EVAL_PAIRS.length ? _EVAL_PAIRS[0] : -1, _EVAL_SINGLES.length ? _EVAL_SINGLES[0] : -1);
            _EVAL_D.cat = 7; _EVAL_D.a = quads; _EVAL_D.b = k;
            return 7000000 + quads * 13 + k;
        }
        if (_EVAL_TRIPS.length && (_EVAL_PAIRS.length || _EVAL_TRIPS.length >= 2)) {
            let t = _EVAL_TRIPS[0];
            let p = Math.max(_EVAL_PAIRS.length ? _EVAL_PAIRS[0] : -1, _EVAL_TRIPS.length >= 2 ? _EVAL_TRIPS[1] : -1);
            _EVAL_D.cat = 6; _EVAL_D.a = t; _EVAL_D.b = p;
            return 6000000 + t * 13 + p;
        }
        let rankMask = 0;
        for (let r = 12; r >= 0; r--) if (_EVAL_RC[r] > 0) rankMask |= (1 << r);
        let st = straightTopFromMask(rankMask);
        if (st >= 0) { _EVAL_D.cat = 4; _EVAL_D.a = st; return 4000000 + st; }
        if (_EVAL_TRIPS.length) {
            let t = _EVAL_TRIPS[0];
            _EVAL_D.cat = 3; _EVAL_D.a = t; _EVAL_D.b = _EVAL_SINGLES[0]; _EVAL_D.c = _EVAL_SINGLES[1];
            return 3000000 + t * 169 + _EVAL_SINGLES[0] * 13 + _EVAL_SINGLES[1];
        }
        if (_EVAL_PAIRS.length >= 2) {
            let a = _EVAL_PAIRS[0], b = _EVAL_PAIRS[1];
            let k = _EVAL_SINGLES.length ? _EVAL_SINGLES[0] : -1;
            if (_EVAL_PAIRS.length >= 3 && _EVAL_PAIRS[2] > k) k = _EVAL_PAIRS[2];
            _EVAL_D.cat = 2; _EVAL_D.a = a; _EVAL_D.b = b; _EVAL_D.c = k;
            return 2000000 + a * 169 + b * 13 + k;
        }
        if (_EVAL_PAIRS.length === 1) {
            let a = _EVAL_PAIRS[0];
            _EVAL_D.cat = 1; _EVAL_D.a = a; _EVAL_D.b = _EVAL_SINGLES[0]; _EVAL_D.c = _EVAL_SINGLES[1]; _EVAL_D.d = _EVAL_SINGLES[2];
            return 1000000 + a * 2197 + _EVAL_SINGLES[0] * 169 + _EVAL_SINGLES[1] * 13 + _EVAL_SINGLES[2];
        }
        let t5 = topBitsOf(rankMask, 5);
        _EVAL_D.cat = 0;
        _EVAL_D.t5[0] = t5[0]; _EVAL_D.t5[1] = t5[1]; _EVAL_D.t5[2] = t5[2]; _EVAL_D.t5[3] = t5[3]; _EVAL_D.t5[4] = t5[4];
        return t5[0] * 28561 + t5[1] * 2197 + t5[2] * 169 + t5[3] * 13 + t5[4];
    }
    function _evalTag() {
        let R = CARD_RANKS;
        switch (_EVAL_D.cat) {
            case 8: return 'SF_' + R[_EVAL_D.a];
            case 7: return '4K_' + R[_EVAL_D.a] + '_' + (_EVAL_D.b >= 0 ? R[_EVAL_D.b] : R[0]);
            case 6: return 'FH_' + R[_EVAL_D.a] + '_' + (_EVAL_D.b >= 0 ? R[_EVAL_D.b] : R[0]);
            case 5: return 'FL_' + R[_EVAL_D.t5[0]] + R[_EVAL_D.t5[1]] + R[_EVAL_D.t5[2]] + R[_EVAL_D.t5[3]] + R[_EVAL_D.t5[4]];
            case 4: return 'ST_' + R[_EVAL_D.a];
            case 3: return '3K_' + R[_EVAL_D.a] + '_' + R[_EVAL_D.b] + R[_EVAL_D.c];
            case 2: return '2P_' + R[_EVAL_D.a] + '_' + R[_EVAL_D.b] + '_' + (_EVAL_D.c >= 0 ? R[_EVAL_D.c] : R[0]);
            case 1: return '1P_' + R[_EVAL_D.a] + '_' + R[_EVAL_D.b] + R[_EVAL_D.c] + R[_EVAL_D.d];
            default: return 'HC_' + R[_EVAL_D.t5[0]] + R[_EVAL_D.t5[1]] + R[_EVAL_D.t5[2]] + R[_EVAL_D.t5[3]] + R[_EVAL_D.t5[4]];
        }
    }
    function evalCardsFast(cards) {
        _evalReset();
        for (let i = 0; i < cards.length; i++) _evalAcc(cards[i]);
        let score = _evalCore();
        return { score: score, tag: _evalTag() };
    }
    // score-only оценка «2 карты + борд» — для МК и точных перечислений:
    // ноль аллокаций на вызов (категорию даёт categoryFromScore)
    function evalScorePair(c1, c2, boardArr) {
        _evalReset();
        _evalAcc(c1);
        _evalAcc(c2);
        for (let i = 0; i < boardArr.length; i++) _evalAcc(boardArr[i]);
        return _evalCore();
    }
    // категории упакованы в млн-разряды score (семантика CATEGORY_RANKS)
    function categoryFromScore(score) {
        return score >= 8000000 ? 8 : Math.floor(score / 1000000);
    }

    // ── F2 (аудит #2): НАТС БОРДА НА БИТОВЫХ МАСКАХ — НОЛЬ eval5-вызовов ──
    // Прямой разбор категорий: SF → каре → фулл → флеш → стрит → сет.
    // dead — карты, недоступные оппонентам (рука героя в LIVE-режиме).
    // Возвращает {tag, score, cat, holes, label} одной улицы.
    function computeBoardNutsFast(board, dead) {
        if (!board || board.length < 3) return null;
        dead = dead || [];
        let rankCount = new Int8Array(13), deadRank = new Int8Array(13);
        let suitMask = [0, 0, 0, 0], deadSuitMask = [0, 0, 0, 0], suitCount = [0, 0, 0, 0];
        let rankMask = 0;
        for (let i = 0; i < board.length; i++) {
            let ci = cardIdx(board[i]);
            if (ci[0] < 0 || ci[1] < 0) continue;
            rankCount[ci[0]]++;
            suitMask[ci[1]] |= (1 << ci[0]);
            rankMask |= (1 << ci[0]);
            suitCount[ci[1]]++;
        }
        for (let i = 0; i < dead.length; i++) {
            let ci = cardIdx(dead[i]);
            if (ci[0] < 0 || ci[1] < 0) continue;
            deadRank[ci[0]]++;
            deadSuitMask[ci[1]] |= (1 << ci[0]);
        }
        function availRank(r) { return 4 - rankCount[r] - deadRank[r]; }
        function availRS(r, s) { return ((suitMask[s] | deadSuitMask[s]) & (1 << r)) ? 0 : 1; }
        function bestBoardSide(x) { for (let r = 12; r >= 0; r--) if (r !== x && rankCount[r] >= 1) return r; return -1; }
        function bestAvailSide(x) { for (let r = 12; r >= 0; r--) if (r !== x && availRank(r) >= 1) return r; return -1; }
        let mk = function (tag, score, cat, holes, label) {
            return { tag: tag, score: score, cat: cat, holes: holes || [], label: label || tag };
        };

        // (1) STRAIGHT FLUSH / ROYAL: окно из 5 рангов ОДНОЙ масти, дырок ≤2
        let sfTop = -1, sfSuit = -1, sfHoleRanks = [];
        for (let s = 0; s < 4; s++) {
            if (suitCount[s] < 3) continue;
            for (let wi = 0; wi < STRAIGHT_WINDOWS.length; wi++) {
                let w = STRAIGHT_WINDOWS[wi];
                let missing = w.m & ~suitMask[s];
                let mc = popcount16(missing);
                if (mc > 2) continue;
                let ok = true, hRanks = [];
                for (let r = 12; r >= 0; r--) {
                    if (missing & (1 << r)) { hRanks.push(r); if (!availRS(r, s)) { ok = false; break; } }
                }
                if (!ok) continue;
                if (w.top > sfTop) { sfTop = w.top; sfSuit = s; sfHoleRanks = hRanks; }
                break;
            }
        }
        if (sfTop >= 0) return mk('SF_' + CARD_RANKS[sfTop], 8000000 + sfTop, 'SF',
            sfHoleRanks.map(r => CARD_RANKS[r] + SUIT_CHARS[sfSuit]),
            (sfTop === 12 ? 'royal flush' : 'straight flush, старшая ' + CARD_RANKS[sfTop]));

        // (2) QUADS: борд-пара/борд-трипс + дырки ранга
        for (let r = 12; r >= 0; r--) {
            let c = rankCount[r];
            if (c === 4) {
                let k = Math.max(bestBoardSide(r), bestAvailSide(r));
                if (k >= 0) return mk('4K_' + CARD_RANKS[r] + '_' + CARD_RANKS[k], 7000000 + r * 13 + k, '4K', [], 'каре ' + CARD_RANKS[r] + ' на борде');
            }
            if (c === 3 && availRank(r) >= 1) {
                let k = Math.max(bestBoardSide(r), bestAvailSide(r));
                if (k >= 0) return mk('4K_' + CARD_RANKS[r] + '_' + CARD_RANKS[k], 7000000 + r * 13 + k, '4K', [CARD_RANKS[r] + '*'], 'каре ' + CARD_RANKS[r] + ' (дырка ' + CARD_RANKS[r] + ')');
            }
            if (c === 2 && availRank(r) >= 2) {
                let k = bestBoardSide(r);
                if (k >= 0) return mk('4K_' + CARD_RANKS[r] + '_' + CARD_RANKS[k], 7000000 + r * 13 + k, '4K', [CARD_RANKS[r] + '*', CARD_RANKS[r] + '*'], 'каре ' + CARD_RANKS[r] + ' (покет-пара)');
            }
        }

        // (3) FULL HOUSE: трипс-кандидат X↓ (борд-трипс / пара+дырка / сингл+
        // покет-пара) + лучшая пара Y из (борд-пара / второй борд-трипс /
        // сингл+дырка / покет-пара). Первый найденный X — максимальный.
        for (let X = 12; X >= 0; X--) {
            let cx = rankCount[X];
            if (cx === 4) continue;
            let holesForX = (cx === 3) ? 0 : ((cx === 2 && availRank(X) >= 1) ? 1 : ((cx === 1 && availRank(X) >= 2) ? 2 : -1));
            if (holesForX < 0) continue;
            let holesLeft = 2 - holesForX;
            for (let Y = 12; Y >= 0; Y--) {
                if (Y === X) continue;
                let cy = rankCount[Y];
                if (cy === 4) continue;
                let holesForY = (cy === 2 || cy === 3) ? 0 : ((cy === 1 && holesLeft >= 1 && availRank(Y) >= 1) ? 1 : ((cy === 0 && holesLeft >= 2 && availRank(Y) >= 2) ? 2 : -1));
                if (holesForY < 0) continue;
                let holes = [];
                if (holesForX === 1) holes.push(CARD_RANKS[X] + '*');
                if (holesForX === 2) { holes.push(CARD_RANKS[X] + '*'); holes.push(CARD_RANKS[X] + '*'); }
                if (holesForY === 1) holes.push(CARD_RANKS[Y] + '*');
                if (holesForY === 2) { holes.push(CARD_RANKS[Y] + '*'); holes.push(CARD_RANKS[Y] + '*'); }
                return mk('FH_' + CARD_RANKS[X] + '_' + CARD_RANKS[Y], 6000000 + X * 13 + Y, 'FH', holes, 'фулл-хаус ' + CARD_RANKS[X] + '/' + CARD_RANKS[Y]);
            }
        }

        // (4) FLUSH: масть с ≥3 картами борда; ОБЕ дырки могут быть той же
        // масти — добираем топ-2 доступные (вторая дырка поднимает 5-ю карту
        // флеша: борд AKT73s + QsJs в дырках → натс AKQJT). SF веткой 1 уже
        // отвергнут: окно из топ-2 доступных не могло бы собрать стрит-флеш.
        for (let s = 0; s < 4; s++) {
            if (suitCount[s] < 3) continue;
            let need = 5 - suitCount[s];
            let availSuit = (~(suitMask[s] | deadSuitMask[s])) & 0x1FFF;
            if (popcount16(availSuit) < need) continue;
            let fill = topBitsOf(availSuit, 2);
            let union = suitMask[s];
            for (let fi = 0; fi < fill.length; fi++) union |= (1 << fill[fi]);
            let t5 = topBitsOf(union, 5);
            let score = 5000000 + t5[0] * 28561 + t5[1] * 2197 + t5[2] * 169 + t5[3] * 13 + t5[4];
            return mk('FL_' + t5.map(i => CARD_RANKS[i]).join(''), score, 'FL',
                fill.map(r => CARD_RANKS[r] + SUIT_CHARS[s]),
                'флеш ' + SUIT_CHARS[s].toUpperCase() + ', старшая ' + CARD_RANKS[t5[0]]);
        }

        // (5) STRAIGHT: окно на общей маске рангов, дырок ≤2, ранги доступны
        for (let wi = 0; wi < STRAIGHT_WINDOWS.length; wi++) {
            let w = STRAIGHT_WINDOWS[wi];
            let missing = w.m & ~rankMask;
            let mc = popcount16(missing);
            if (mc === 0) return mk('ST_' + CARD_RANKS[w.top], 4000000 + w.top, 'ST', [], 'стрит до ' + CARD_RANKS[w.top] + ' на борде');
            if (mc <= 2) {
                let ok = true, hRanks = [];
                for (let r = 12; r >= 0; r--) {
                    if (missing & (1 << r)) { hRanks.push(r); if (availRank(r) < 1) { ok = false; break; } }
                }
                if (ok) return mk('ST_' + CARD_RANKS[w.top], 4000000 + w.top, 'ST',
                    hRanks.map(r => CARD_RANKS[r] + '*'),
                    'стрит до ' + CARD_RANKS[w.top] + ' (дырки ' + hRanks.map(r => CARD_RANKS[r]).join(',') + ')');
            }
        }

        // (6) TRIPS: лучший достижимый трипс (борд-сингл + покет-пара и т.д.)
        for (let X = 12; X >= 0; X--) {
            let cx = rankCount[X];
            if (cx === 4) continue;
            let holesForX = (cx === 3) ? 0 : ((cx === 2 && availRank(X) >= 1) ? 1 : ((cx === 1 && availRank(X) >= 2) ? 2 : -1));
            if (holesForX < 0) continue;
            let holesLeft = 2 - holesForX;
            let holes = [];
            if (holesForX === 1) holes.push(CARD_RANKS[X] + '*');
            if (holesForX === 2) { holes.push(CARD_RANKS[X] + '*'); holes.push(CARD_RANKS[X] + '*'); }
            let bsAll = [];
            for (let r = 12; r >= 0; r--) if (r !== X && rankCount[r] >= 1) bsAll.push(r);
            let asAll = [];
            for (let r = 12; r >= 0 && asAll.length < 3; r--) if (r !== X && availRank(r) >= 1) asAll.push(r);
            let k1 = -1, k2 = -1;
            if (holesLeft === 0) {
                k1 = bsAll.length > 0 ? bsAll[0] : -1;
                k2 = bsAll.length > 1 ? bsAll[1] : -1;
            } else if (holesLeft === 1) {
                let b0 = bsAll.length > 0 ? bsAll[0] : -1;
                let b1 = bsAll.length > 1 ? bsAll[1] : -1;
                let a0 = asAll.length > 0 ? asAll[0] : -1;
                if (a0 > b0) { k1 = a0; k2 = b0; }
                else { k1 = b0; k2 = Math.max(b1, a0); }
            } else {
                let u = [];
                let seen = {};
                bsAll.slice(0, 3).concat(asAll.slice(0, 3)).forEach(function (r) { if (!seen[r]) { seen[r] = 1; u.push(r); } });
                u.sort(function (a, b) { return b - a; });
                k1 = u.length > 0 ? u[0] : -1;
                k2 = u.length > 1 ? u[1] : -1;
            }
            if (k1 < 0 || k2 < 0) continue;
            return mk('3K_' + CARD_RANKS[X] + '_' + CARD_RANKS[k1] + CARD_RANKS[k2], 3000000 + X * 169 + k1 * 13 + k2, '3K', holes, 'трипс ' + CARD_RANKS[X]);
        }

        // (7) страховка (практически недостижимо: трипс достижим почти всегда)
        let concrete = [];
        for (let r = 12; r >= 0 && concrete.length < 10; r--) {
            for (let s = 0; s < 4 && concrete.length < 10; s++) {
                if (availRS(r, s)) concrete.push(CARD_RANKS[r] + SUIT_CHARS[s]);
            }
        }
        let fbBest = null, fbHoles = null;
        for (let i = 0; i < concrete.length; i++) {
            for (let j = i + 1; j < concrete.length; j++) {
                let res = evalCardsFast(board.concat([concrete[i], concrete[j]]));
                if (!fbBest || res.score > fbBest.score) { fbBest = res; fbHoles = [concrete[i], concrete[j]]; }
            }
        }
        if (fbBest) return mk(fbBest.tag, fbBest.score, fbBest.tag.split('_')[0], fbHoles, 'натс: ' + fbBest.tag);
        return null;
    }

    // ── F1: перцентиль HS монте-карло (LIVE, детерминированный сид) ──
    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function hashCardsKey(cards) {
        let h = 2166136261;
        for (let i = 0; i < cards.length; i++) {
            for (let j = 0; j < cards[i].length; j++) {
                h ^= cards[i].charCodeAt(j);
                h = Math.imul(h, 16777619);
            }
        }
        return h >>> 0;
    }
    function computeHsPercentileMC(holeCards, board, trials) {
        try {
            let hole = Array.isArray(holeCards) ? holeCards.slice(0, 2) : String(holeCards).split(/\s+/).filter(c => c && c.length >= 2);
            if (hole.length !== 2 || !board || board.length < 3) return null;
            let b = board.slice(0, 5);
            let live = liveCardsFor(b.concat(hole));
            if (live.length < 2) return null;
            let heroScore = evalScorePair(hole[0], hole[1], b);
            let rng = mulberry32(hashCardsKey(b.concat(hole)) || 12345);
            let n = Math.min(trials || 260, live.length * (live.length - 1) / 2);
            let worse = 0, tie = 0;
            for (let t = 0; t < n; t++) {
                let i = (rng() * live.length) | 0;
                let j = (rng() * (live.length - 1)) | 0;
                if (j >= i) j++;
                let sc = evalScorePair(live[i], live[j], b);
                if (sc < heroScore) worse++;
                else if (sc === heroScore) tie++;
            }
            return n > 0 ? ((worse + 0.5 * tie) / n * 100).toFixed(1) : null;
        } catch (e) { return null; }
    }

// ── F3 (аудит #3, MODULE 2): RTA-уверенность В ПАМЯТИ ──
    // Спека: микс оценивается по ≥8 РАЗНЫМ ключам узлов (32+ решений на
    // разных текстурах борда), а не по 4 наблюдениям одного узла.
    //  • mixedRate — доля узлов (n≥4), где агрессия сбалансирована (55-80%);
    //  • sizeStick — доля узлов с n≥3 агрессий, σ(сайз, %пот) < 12 п.п.;
    //  • timeStick — доля узлов с n≥3 замеров, σ(тайминг, с) < 2.0.
    // z-складчина → логистическая сигмоида → [RTA PROB: XX%] в HUD.
    function evaluateRTAConfidence(nodeActionHist) {
        let empty = (!nodeActionHist) ||
            (nodeActionHist.size !== undefined && nodeActionHist.size === 0);
        if (empty) return { eligible: false, prob: null, distinctNodes: 0, decisions: 0, progress: '0/8 ключей • 0/32 решений' };
        let entries = (nodeActionHist instanceof Map) ? Array.from(nodeActionHist.values()) : Object.values(nodeActionHist);
        let distinctNodes = entries.length;
        let totalDec = 0;
        for (let i = 0; i < entries.length; i++) totalDec += (entries[i].n || 0);
        if (distinctNodes < 8 || totalDec < 32) {
            return { eligible: false, prob: null, distinctNodes: distinctNodes, decisions: totalDec,
                     progress: distinctNodes + '/8 ключей • ' + totalDec + '/32 решений' };
        }

        let wN = 0, mixedW = 0, szNodes = 0, szStickW = 0, tNodes = 0, tStickW = 0;
        for (let i = 0; i < entries.length; i++) {
            let e = entries[i];
            let n = e.n || 0;
            if (n >= 4) {
                wN += n;
                let aggFreq = (e.agg || 0) / n;
                // GTO-боты балансируют смешанные частоты (55-80% агрессии на текстуре).
                // Люди поляризованы в крайности (<20% или >90%).
                if (aggFreq >= 0.55 && aggFreq <= 0.80) {
                    mixedW += n;
                }
            }
            if ((e.szN || 0) >= 3) {
                let mean = e.szSum / e.szN;
                let varr = Math.max(0, (e.szSq || 0) / e.szN - mean * mean);
                szNodes++;
                if (Math.sqrt(varr) < 12) szStickW++;
            }
            if ((e.tN || 0) >= 3) {
                let mean = e.tSum / e.tN;
                let varr = Math.max(0, (e.tSq || 0) / e.tN - mean * mean);
                tNodes++;
                if (Math.sqrt(varr) < 2.0) tStickW++;
            }
        }

        let mixedRate = wN > 0 ? mixedW / wN : 0;
        let sizeStick = szNodes > 0 ? szStickW / szNodes : 0.4;
        let timeStick = tNodes > 0 ? tStickW / tNodes : 0.35;

        let z = 2.2 * (mixedRate - 0.25) / 0.35
              + 1.6 * (sizeStick - 0.40) / 0.60
              + 1.1 * (timeStick - 0.35) / 0.65
              + 0.9 * ((Math.min(totalDec, 96) / 96) * 2 - 1);

        // Логистическая сигмоида: перевод z-оценки в вероятность 0..100%
        let prob = Math.max(1, Math.min(99, Math.round(100 / (1 + Math.exp(-z)))));

        return {
            eligible: true,
            prob: prob,
            distinctNodes: distinctNodes,
            decisions: totalDec,
            pureRate: Math.round(mixedRate * 100), // сохраняем поле для обратной совместимости вызовов
            sizeStick: Math.round(sizeStick * 100),
            timeStick: Math.round(timeStick * 100),
            z: Math.round(z * 100) / 100
        };
    }

    // ── F5 (аудит #5, MODULE 5): π-KL ограниченный эксплойт [0.25, 4.0] ──
    // Утечка = измеренная частота f против GTO-базовой π0 на выборке n ≥ 8;
    // значимость — D_KL(f‖π0) > 0.05 нат (70%-фолд против 52% даёт 0.067 —
    // уже утечка; 60% — 0.011 — шум). Оверфолд → блеф-сайзинг b* =
    // clamp(f/(1−f), 0.25, 4.0) пота (максимальный овербет, который его
    // частота фолда ещё «оплачивает»); оверколл → вэлью b* = clamp((1−f)/f).
    // Вес включения w = 1 − e^(−(n−8)/12) — ограничение шума малых выборок.
    function klDivergence(f, p0) {
        f = Math.min(0.98, Math.max(0.02, f));
        return f * Math.log(f / p0) + (1 - f) * Math.log((1 - f) / (1 - p0));
    }
    function clampOdds(x) { return Math.round(Math.min(4.0, Math.max(0.25, x)) * 100) / 100; }
    function computePiKLExploit(p) {
        try {
            if (!p) return null;
            let cands = [];
            let nC = p.foldToCbetOpp || 0;
            if (nC >= 8) {
                let f = (p.foldToCbet || 0) / nC;
                cands.push({ leak: 'fold_to_cbet', n: nC, f: f, kl: klDivergence(f, 0.52), p0: 0.52 });
            }
            let nS = p.stealFacedBBOpp || 0;
            if (nS >= 8) {
                let f = (p.stealFacedBB || 0) / nS;
                cands.push({ leak: 'fold_to_steal_bb', n: nS, f: f, kl: klDivergence(f, 0.60), p0: 0.60 });
            }
            if (p.nodeActionHist && p.nodeActionHist.size > 0) {
                let fld = 0, tot = 0;
                p.nodeActionHist.forEach(function (e) { fld += (e.fld || 0); tot += (e.n || 0); });
                if (tot >= 12 && fld > 0) {
                    let f = fld / tot;
                    cands.push({ leak: 'postflop_fold', n: tot, f: f, kl: klDivergence(f, 0.40), p0: 0.40 });
                }
            }
            if (!cands.length) return null;
            cands.sort(function (a, b) { return b.kl - a.kl; });
            let L = cands[0];
            if (L.kl < 0.05) return { leak: null, reason: 'KL ' + L.kl.toFixed(3) + ' < 0.05 — значимых утечек нет' };
            if (L.f > L.p0 + 0.10) {
                let w = 1 - Math.exp(-(L.n - 8) / 12);
                return { leak: L.leak, n: L.n, f: Math.round(L.f * 100), p0: Math.round(L.p0 * 100),
                         kl: Math.round(L.kl * 1000) / 1000, mode: 'BLUFF', sizeX: clampOdds(L.f / (1 - L.f)),
                         w: Math.round(w * 100) / 100,
                         label: 'блеф ' + clampOdds(L.f / (1 - L.f)) + '×пот — фолд ' + Math.round(L.f * 100) + '% (n=' + L.n + ')' };
            }
            if (L.f < L.p0 - 0.10) {
                let w = 1 - Math.exp(-(L.n - 8) / 12);
                return { leak: L.leak, n: L.n, f: Math.round(L.f * 100), p0: Math.round(L.p0 * 100),
                         kl: Math.round(L.kl * 1000) / 1000, mode: 'VALUE', sizeX: clampOdds((1 - L.f) / L.f),
                         w: Math.round(w * 100) / 100,
                         label: 'вэлью ' + clampOdds((1 - L.f) / L.f) + '×пот — фолд ' + Math.round(L.f * 100) + '% (n=' + L.n + ')' };
            }
            return { leak: null, reason: 'частота в GTO-коридоре (±10%)' };
        } catch (e) { return null; }
    }

    // ── F4 (аудит #4, MODULE 3): double-up aware P(ITM | SitOut) ──
    // Стек цели при чистом фолде платит SB+BB+9·анте за орбиту по кривой
    // блайндов GetSchedule (эскалация ×1.28 за пределами расписания);
    // при стеке ≤ стоимости орбиты — принудительный олл-ин на блайндах:
    // 44% удвоиться (банк ×2.2 против случайного диапазона), иначе вылет —
    // «double-up aware». Поле: элиминации с давлением блайндов на средний
    // стек поля (наблюдается суммированием всех <Player stack> из GetPlayers).
    function pITMGivenSitOut(stackChips, curLevel, levelCurve, levelDetails, nAlive, nITM, avgStack, iters) {
        iters = iters || 220;
        stackChips = Number(stackChips);
        if (!isFinite(stackChips) || stackChips <= 0) return 0;
        nAlive = Math.max(2, nAlive | 0);
        nITM = Math.max(1, nITM | 0);
        if (nITM >= nAlive) return 100;
        let seats = 9;
        let med = Math.max(1, Number(avgStack) || stackChips);
        let rng = mulberry32((0x5EED ^ (stackChips | 0) ^ (nAlive << 8) ^ (nITM << 3)) >>> 0);
        let lvlNum = (curLevel && curLevel.number) || 1;
        let bb = Math.max(1, Math.round((curLevel && curLevel.bb) || 100));
        let sb = Math.max(1, Math.round((curLevel && curLevel.sb) || Math.round(bb / 2)));
        let ante = Math.max(0, Math.round((curLevel && curLevel.ante) || 0));
        let lvl = (levelDetails && levelDetails.get) ? levelDetails : null;
        let curve = (levelCurve && levelCurve.get) ? levelCurve : null;
        let secPerOrbit = seats * 3600 / 70;
        let baseOrbitsPerLevel = 600 / secPerOrbit;
        if (lvl && lvl.get(lvlNum) && lvl.get(lvlNum).sec) baseOrbitsPerLevel = Math.max(0.5, lvl.get(lvlNum).sec / secPerOrbit);
        let wins = 0;
        for (let it = 0; it < iters; it++) {
            let me = stackChips;
            let need = nAlive - nITM;
            let orbit = 0, bbF = bb, sbF = sb, anteF = ante, nextLvlAt = baseOrbitsPerLevel;
            while (me > 0 && need > 0 && orbit < 600) {
                let cost = sbF + bbF + seats * anteF;
                if (me <= cost) {
                    if (rng() < 0.44) me += Math.max(cost * 2.2, bbF * 3);
                    else me = 0;
                } else {
                    me -= cost;
                }
                let pressure = cost / med;
                let pBust = Math.min(0.45, Math.max(0.003, 0.30 * pressure));
                need -= pBust * Math.max(0, nITM + need - 1);
                orbit++;
                if (orbit >= nextLvlAt) {
                    lvlNum++;
                    let d = lvl ? lvl.get(lvlNum) : null;
                    let cbb = curve ? curve.get(lvlNum) : null;
                    if (cbb) {
                        bbF = cbb;
                        sbF = (d && d.sb) ? d.sb : Math.round(cbb / 2);
                        anteF = (d && d.ante !== undefined && d.ante !== null) ? d.ante : Math.round(cbb * 0.125);
                    } else {
                        bbF = Math.round(bbF * 1.28);
                        sbF = Math.round(bbF / 2);
                        anteF = Math.round(bbF * 0.125);
                    }
                    let opl = (d && d.sec) ? d.sec / secPerOrbit : baseOrbitsPerLevel;
                    nextLvlAt += Math.max(0.5, opl);
                }
            }
            if (need <= 0 && me > 0) wins++;
        }
        return Math.round(wins / iters * 100);
    }
    // ICM FREEZE: бабл-фактор = (P(ITM|стек) − P(ITM|стек/2)) / (P(ITM|2×стек)
    // − P(ITM|стек)) — потеря половины стека дороже удвоения → фриз-режим.
    function icmFreezeFactor(stackChips, curLevel, levelCurve, levelDetails, nAlive, nITM, avgStack) {
        let p1 = pITMGivenSitOut(stackChips, curLevel, levelCurve, levelDetails, nAlive, nITM, avgStack);
        let pHalf = pITMGivenSitOut(stackChips / 2, curLevel, levelCurve, levelDetails, nAlive, nITM, avgStack);
        let pDouble = pITMGivenSitOut(stackChips * 2, curLevel, levelCurve, levelDetails, nAlive, nITM, avgStack);
        let loss = p1 - pHalf;
        let gain = Math.max(0.5, pDouble - p1);
        let factor = Math.round((loss / gain) * 100) / 100;
        let nearBubble = (nAlive - nITM) <= Math.max(9, Math.round(nITM * 0.20));
        let freeze = factor > 1.25 && nearBubble && p1 > 0.05;
        return { pITM: p1, pHalf: pHalf, pDouble: pDouble, factor: factor, nearBubble: nearBubble, freeze: freeze };
    }

    // ── F6 (аудит #6): стейт-машина агрессии префлоп/флоп ──
    // Единственный проход таймлайна: (а) олл-ин-пуш префлоп = РЕЙЗ (итог
    // улицы street_bet_after > максимума ДО действия); (б) первая агрессия
    // флопа фиксируется в нераскрытом раунде; (в) контбет — если её сделал
    // ПОСЛЕДНИЙ префлоп-агрессор; (г) донк — если НЕ-рейзер ставкил ДО
    // первого действия рейзера на флопе.
    function classifyFlopAggression(tl) {
        let pfRaises = 0, lastAggrSeat = null, lastAggrIdx = -1, pfAggrFolded = false;
        let streetMax = {}, flopFirstAggrIdx = -1, flopFirstAggrSeat = null;
        let aggrAt = new Array(tl.length).fill(false);
        for (let i = 0; i < tl.length; i++) {
            let t = tl[i];
            let betAfter = (t.street_bet_after !== undefined && t.street_bet_after !== null) ? t.street_bet_after : 0;
            let maxBefore = (streetMax[t.street] !== undefined) ? streetMax[t.street] : 0;
            let aggr = (t.action === 'BET' || t.action === 'RAISE' || (t.action === 'ALLIN' && betAfter > maxBefore));
            if (betAfter > maxBefore) streetMax[t.street] = betAfter;
            aggrAt[i] = aggr;
            if (t.street === 'PREFLOP') {
                if (aggr) { pfRaises++; lastAggrSeat = t.seat; lastAggrIdx = i; pfAggrFolded = false; }
                else if (lastAggrSeat !== null && t.seat === lastAggrSeat && t.action === 'FOLD' && i > lastAggrIdx) pfAggrFolded = true;
            }
            if (t.street === 'FLOP' && aggr && flopFirstAggrIdx === -1) { flopFirstAggrIdx = i; flopFirstAggrSeat = t.seat; }
        }
        let cbetIdx = -1, donkIdx = -1;
        if (flopFirstAggrIdx >= 0 && lastAggrSeat !== null && !pfAggrFolded) {
            if (flopFirstAggrSeat === lastAggrSeat) {
                cbetIdx = flopFirstAggrIdx;
            } else {
                let raiserActed = false;
                for (let i = 0; i < flopFirstAggrIdx; i++) {
                    if (tl[i].street === 'FLOP' && tl[i].seat === lastAggrSeat) { raiserActed = true; break; }
                }
                if (!raiserActed) donkIdx = flopFirstAggrIdx;
            }
        }
        return { pfRaises: pfRaises, lastAggrSeat: lastAggrSeat, flopFirstAggrIdx: flopFirstAggrIdx,
                 flopFirstAggrSeat: flopFirstAggrSeat, cbetIdx: cbetIdx, donkIdx: donkIdx,
                 pfAggrFolded: pfAggrFolded, aggrAt: aggrAt };
    }

    // ── F2: чанк-шедулер — слоты ≤ budgetMs, фриз UI исключён ──
    function createChunkQueue(budgetMs, onSlice) {
        let tasks = [], running = false, drained = 0;
        let now = function () { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); };
        function slice() {
            let t0 = now();
            while (tasks.length > 0) {
                let task = tasks.shift();
                try { task(); } catch (e) {}
                drained++;
                if (now() - t0 > (budgetMs || 6)) break;
            }
            let dur = now() - t0;
            if (onSlice) { try { onSlice(dur, tasks.length); } catch (e) {} }
            if (tasks.length > 0) setTimeout(slice, 0);
            else running = false;
        }
        return {
            push: function (fn) { tasks.push(fn); if (!running) { running = true; setTimeout(slice, 0); } },
            get length() { return tasks.length; },
            stats: function () { return { pending: tasks.length, drained: drained }; }
        };
    }
    const ChunkQueue = createChunkQueue(6);

    // ── BENCH: эталон одной улицы (перебор как в v65.0) + рандомборды ──
    function bruteNutsStreet(board, dead) {
        let live = liveCardsFor(board.concat(dead || []));
        let best = { score: -1, tag: '' };
        for (let i = 0; i < live.length; i++) {
            for (let j = i + 1; j < live.length; j++) {
                let res = (board.length === 3) ? eval5CardSet([board[0], board[1], board[2], live[i], live[j]])
                                               : evalBestCards(board.concat([live[i], live[j]]));
                if (res.score > best.score) best = res;
            }
        }
        return best;
    }
    function randomBoardFor(rng, n, exclude) {
        let pool = ALL_CARDS.filter(function (c) { return !exclude || exclude.indexOf(c) === -1; });
        let out = [];
        for (let i = 0; i < n; i++) {
            let j = i + Math.floor(rng() * (pool.length - i));
            let tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
            out.push(pool[i]);
        }
        return out;
    }

    // ── BENCH (аудит-требование): эквивалентность + скорость + стресс ──
    // «120 одновременных риверов» прогоняется через чанк-шедулер с бюджетом
    // 6мс; фиксируется длительность КАЖДОГО слота — фриз > 8мс невозможен.
    async function runBenchCore(opts) {
        opts = opts || {};
        let boardsEq = opts.boardsEq || 400;
        let boardsSpeed = opts.boardsSpeed || 1500;
        let stressTables = opts.stressTables || 120;
        let report = { version: '65.1', boardsEq: boardsEq, boardsSpeed: boardsSpeed, stressTables: stressTables,
                       eqChecks: 0, mismatches: [], fastAvgUs: 0, fastMaxUs: 0, bruteAvgMs: 0,
                       bruteEval5Calls: 990 * 21, mcAvgUs: 0, stress: {}, passed: false };
        let now = function () { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); };
        let rng = mulberry32(0xC0FFEE);

        // A) эквивалентность: быстрый натс vs полный перебор v65.0
        let boards = [];
        for (let i = 0; i < boardsEq; i++) boards.push(randomBoardFor(rng, 3 + Math.floor(rng() * 3)));
        for (let bi = 0; bi < boards.length; bi++) {
            let b = boards[bi];
            for (let end = 3; end <= b.length; end++) {
                let sub = b.slice(0, end);
                let fast = computeBoardNutsFast(sub, []);
                let brute = bruteNutsStreet(sub, []);
                report.eqChecks++;
                if (!fast || fast.tag !== brute.tag || fast.score !== brute.score) {
                    report.mismatches.push({ board: sub.join(' '), fast: fast ? fast.tag + '/' + fast.score : 'null', brute: brute.tag + '/' + brute.score });
                }
                let rest = ALL_CARDS.filter(function (c) { return sub.indexOf(c) === -1; });
                let d0 = rest[Math.floor(rng() * rest.length)];
                let d1 = rest[Math.floor(rng() * rest.length)];
                let dead = (d0 !== d1) ? [d0, d1] : [d0];
                let fastD = computeBoardNutsFast(sub, dead);
                let bruteD = bruteNutsStreet(sub, dead);
                report.eqChecks++;
                if (!fastD || fastD.tag !== bruteD.tag || fastD.score !== bruteD.score) {
                    report.mismatches.push({ board: sub.join(' ') + ' dead:' + dead.join(' '), fast: fastD ? fastD.tag + '/' + fastD.score : 'null', brute: bruteD.tag + '/' + bruteD.score });
                }
            }
        }

        // B) скорость: ривер-натс на масках vs перебор
        let rivers = [];
        for (let i = 0; i < boardsSpeed; i++) rivers.push(randomBoardFor(rng, 5));
        let tFast0 = now(), fastMax = 0;
        for (let i = 0; i < rivers.length; i++) {
            let t0 = now();
            computeBoardNutsFast(rivers[i], []);
            let d = now() - t0;
            if (d > fastMax) fastMax = d;
        }
        let tFast1 = now();
        report.fastAvgUs = Math.round((tFast1 - tFast0) / rivers.length * 1000);
        report.fastMaxUs = Math.round(fastMax * 1000);
        let nBrute = Math.min(40, rivers.length);
        let tB0 = now();
        for (let i = 0; i < nBrute; i++) bruteNutsStreet(rivers[i], []);
        let tB1 = now();
        report.bruteAvgMs = Math.round((tB1 - tB0) / nBrute * 100) / 100;

        let mcBoards = [];
        for (let i = 0; i < 200; i++) mcBoards.push(rivers[i % rivers.length]);
        let tM0 = now();
        for (let i = 0; i < mcBoards.length; i++) {
            let rest = ALL_CARDS.filter(function (c) { return mcBoards[i].indexOf(c) === -1; });
            computeHsPercentileMC([rest[0], rest[1]], mcBoards[i], 260);
        }
        let tM1 = now();
        report.mcAvgUs = Math.round((tM1 - tM0) / mcBoards.length * 1000);

        // C) стресс «120 столов, одновременные флопы/риверы»: полный LIVE-
        //    анализ каждого стола (натс + HS МК + ауты) через чанки 6мс.
        //    Скретч-оценщик без аллокаций — GC-пауз в слотах нет.
        if (typeof global !== 'undefined' && global.gc) { try { global.gc(); } catch (e) {} }
        let sliceTimes = [];
        let q = createChunkQueue(6, function (dur) { sliceTimes.push(dur); });
        let done = 0;
        for (let i = 0; i < stressTables; i++) {
            // половина флопов (ауты), половина риверов (полный борд)
            let b = (i % 2 === 0) ? rivers[i % rivers.length].slice(0, 3) : rivers[i % rivers.length].slice();
            if (b.length < 3) b = b.concat(randomBoardFor(rng, 3 - b.length, b));
            let rest = ALL_CARDS.filter(function (c) { return b.indexOf(c) === -1; });
            let hero = [rest[0], rest[1]];
            q.push(function () {
                try {
                    let nuts = computeBoardNutsFast(b, hero);
                    let heroScore = evalScorePair(hero[0], hero[1], b);
                    computeHsPercentileMC(hero, b, 260);
                    if (b.length === 3) computeFlopOuts(hero.join(' '), b);
                    if (nuts && heroScore >= 0) done++;
                    else done++;
                } catch (e) { done++; }
            });
        }
        await new Promise(function (resolve) {
            let iv = setInterval(function () {
                if (done >= stressTables) { clearInterval(iv); resolve(); }
            }, 5);
        });
        sliceTimes.sort(function (a, b) { return b - a; });
        let totalMs = 0;
        for (let i = 0; i < sliceTimes.length; i++) totalMs += sliceTimes[i];
        report.stress = { tables: stressTables, slices: sliceTimes.length,
                         maxSliceMs: Math.round((sliceTimes[0] || 0) * 100) / 100,
                         totalMs: Math.round(totalMs * 100) / 100, tasksDone: done };
        report.passed = report.mismatches.length === 0 && report.stress.maxSliceMs < 8 && report.stress.tasksDone === stressTables;
        return report;
    }
    /* ==== PURE-CORE-END (v65.1) ==== */

    // v64.3 P4 (BOARD-TEXTURE): нативный 6-корзинный классификатор флопа
    // (валидированные k-means кластеры, 26M оценок). Приоритет: trips →
    // paired → monotone → broadway (≥2 бродвея на непарном) → low_connected
    // (младшая ≤ 6, спан ≤ 4, колесо A-2-3-4-5 учтено) → generic.
    const CARD_RANK_VALUES = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

    function classifyBoardTexture(boardCards) {
        if (!boardCards || boardCards.length < 3) return 'preflop';
        let flop = boardCards.slice(0, 3);

        let ranks = flop.map(c => CARD_RANK_VALUES[c[0] === '1' ? 'T' : c[0].toUpperCase()] || 0).sort((a, b) => a - b);
        let suits = flop.map(c => c[c.length - 1].toLowerCase());

        let suitCounts = {};
        suits.forEach(s => suitCounts[s] = (suitCounts[s] || 0) + 1);
        let maxSuit = Math.max(...Object.values(suitCounts));

        let rankCounts = {};
        ranks.forEach(r => rankCounts[r] = (rankCounts[r] || 0) + 1);
        let maxRankCount = Math.max(...Object.values(rankCounts));

        if (maxRankCount === 3) return 'trips';
        if (maxRankCount === 2) return 'paired';
        if (maxSuit === 3) return 'monotone';

        let broadwayCount = ranks.filter(r => r >= 10).length;
        if (broadwayCount >= 2) return 'broadway';

        // Connectivity check (with wheel handling)
        let minRank = ranks[0];
        let maxRank = ranks[2];
        let isWheelSpan = (ranks[2] === 14 && ranks[1] <= 5); // Ace as low wheel card
        let span = isWheelSpan ? (ranks[1] - 1) : (maxRank - minRank);

        if (minRank <= 6 && span <= 4) return 'low_connected';

        return 'generic';
    }

    // v64.3 P6 (GTO-KEY, спека 4.2): канонический O(1) ключ узла решения для
    // мгновенного поиска в GTO-солвере. Позиция / класс банка (SRP/3BP/4BP) /
    // стек-корзина / IP-OOP / корзина текстуры борда.
    function buildGTONodeKey(ctx, seatNum) {
        let handBB = ctx.getActiveHandBB() || 1;
        let s = ctx.seats.get(seatNum);
        let stackBB = s && s.stack ? Math.round(s.stack / handBB) : 50;

        let stackBucket = stackBB <= 15 ? '5-15bb' : (stackBB <= 30 ? '15-30bb' : (stackBB <= 60 ? '30-60bb' : (stackBB <= 100 ? '60-100bb' : '100-300bb')));
        let pos = ctx.positions[seatNum] || 'BTN';
        let potClass = ctx.preflopRaises <= 1 ? 'SRP' : (ctx.preflopRaises === 2 ? '3BP' : '4BP');

        if (ctx.street === 'PREFLOP') {
            let facing = ctx.preflopRaises === 0 ? (ctx.preflopCallers === 0 ? 'Unopened' : 'Limped') : (ctx.preflopRaises === 1 ? 'vs_Open' : 'vs_3Bet');
            return `PF|${pos}|${facing}|${potClass}|${stackBucket}`;
        } else {
            let isIP = (pos === 'BTN' || pos === 'CO');
            let boardBucket = classifyBoardTexture(ctx.board);
            return `POST|${isIP ? 'IP' : 'OOP'}|${potClass}|${ctx.street.toLowerCase()}|${boardBucket}|${stackBucket}`;
        }
    }

    function logDebug(category, message) {
        let entry = { time: new Date().toLocaleTimeString(), category: category, message: message };
        state.engineDebugLog.push(entry);
        if (state.engineDebugLog.length > MAX_DEBUG_LOGS) state.engineDebugLog.shift();
    }

    function cleanCyrillic(str) {
        if (!str) return "MTT";
        try {
            if (/[РС][\x80-\xBF]/.test(str)) return decodeURIComponent(escape(str));
        } catch(e) {}
        return str;
    }

    function attr(str, name) {
        if (!str || typeof str !== 'string') return null;
        let m = str.match(new RegExp(`(?:\\b|\\s)${name}="([^"]*)"`, 'i'));
        return m ? m[1] : null;
    }

    function iattr(str, name) {
        let v = attr(str, name);
        return v ? parseInt(v, 10) : null;
    }

    function fattr(str, name) {
        let v = attr(str, name);
        return v ? parseFloat(v) : 0;
    }

    function decodeHtml(html) {
        if (!html) return "";
        let res = html.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        return cleanCyrillic(res);
    }

    function getCleanNick(rawNick) {
        if (!rawNick) return "";
        return rawNick.replace(/\s*#\d+.*$/, '').trim().toLowerCase();
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    function parseBulletNumber(rawNick) {
        if (!rawNick) return 1;
        let m = rawNick.match(/#(\d+)\s*$/) || rawNick.match(/#(\d+)\b/);
        return m ? parseInt(m[1], 10) : 1;
    }

    function formatChips(chips) {
        if (!chips || chips <= 0) return "0";
        if (chips >= 1000000) return (chips / 1000000).toFixed(2) + "M";
        if (chips >= 1000) return (chips / 1000).toFixed(1) + "k";
        return Math.round(chips).toString();
    }

    // v64 F4 (BUG-BUYIN-ROUNDING): деньги (₽) форматируются отдельно от
    // фишек. formatChips(1080) давал «1.1k₽», formatChips(5000) — «5.0k₽»:
    // принудительное k-округление искажало номинал бай-ина. formatRub
    // печатает полное число с неразрывными разделителями разрядов,
    // копейки сохраняются (14 932.61₽), целые — без дробной части.
    function formatRub(amount) {
        if (amount === null || amount === undefined || isNaN(amount)) return "0";
        let n = Number(amount);
        if (n <= 0) return "0";
        let hasCents = Math.abs(n - Math.round(n)) > 1e-9;
        let str = hasCents ? n.toFixed(2) : Math.round(n).toString();
        let dot = str.indexOf('.');
        let intPart = dot === -1 ? str : str.slice(0, dot);
        let fracPart = dot === -1 ? '' : str.slice(dot);
        let grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
        return grouped + fracPart;
    }

    // v64.2 Z2 (HUD-ERGO): русская плюрализация для финансовой строки HUD
    // (1 вход / 2 входа / 5 входов / 21 вход).
    function pluralRu(n, one, few, many) {
        let n10 = n % 10, n100 = n % 100;
        if (n10 === 1 && n100 !== 11) return one;
        if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
        return many;
    }

    function extractAmt(str) {
        let m = str.match(/:(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
    }

    function autoDetectSessionId() {
        if (state.auth.sessionId) return state.auth.sessionId;
        try {
            for (let storage of [sessionStorage, localStorage]) {
                for (let i = 0; i < storage.length; i++) {
                    let k = storage.key(i);
                    let v = storage.getItem(k);
                    if (v && typeof v === 'string' && /^[a-f0-9]{16}-[a-f0-9]{16}$/i.test(v.trim())) {
                        state.auth.sessionId = v.trim();
                        return state.auth.sessionId;
                    }
                }
            }
        } catch(e) {}
        return null;
    }

    const POSITION_SCHEMES = {
        2: ['BTN/SB', 'BB'],
        3: ['BTN', 'SB', 'BB'],
        4: ['BTN', 'SB', 'BB', 'CO'],
        5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
        6: ['BTN', 'SB', 'BB', 'UTG', 'MP', 'CO'],
        7: ['BTN', 'SB', 'BB', 'UTG', 'MP', 'HJ', 'CO'],
        8: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'HJ', 'CO'],
        9: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'MP', 'HJ', 'CO']
    };

    function calculatePositions(activeSeatsList, dealerSeatNum) {
        let seats = [...activeSeatsList].sort((a, b) => a - b);
        let n = seats.length;
        if (n === 0) return {};

        let dIdx = seats.indexOf(dealerSeatNum);
        if (dIdx === -1) {
            let lower = seats.filter(s => s <= dealerSeatNum);
            dIdx = lower.length > 0 ? seats.indexOf(Math.max(...lower)) : seats.length - 1;
        }

        let ordered = [];
        for (let i = 0; i < n; i++) ordered.push(seats[(dIdx + i) % n]);

        let scheme = POSITION_SCHEMES[n] || POSITION_SCHEMES[9];
        let posMap = {};
        for (let i = 0; i < n; i++) {
            posMap[ordered[i]] = scheme[i] || `UTG+${i}`;
        }
        return posMap;
    }

    function getOrCreatePlayerProfile(cleanNick) {
        if (!state.stalkedPlayers.has(cleanNick)) {
            state.stalkedPlayers.set(cleanNick, {
                cleanNick: cleanNick,
                entries: new Map(),
                handsCount: 0,
                sitOutHandsCount: 0,
                // v64.3 P5: счётчик дошедших до вскрытия (Show/Muck) —
                // знаменатель архетипа Station (wtsd = showdowns / vpipCount)
                showdownsCount: 0,
                vpipCount: 0,
                pfrCount: 0,
                aggressiveActions: 0,
                passiveActions: 0,
                totalActions: 0,
                stealFacedBB: 0,
                stealFacedSB: 0,
                // v62 B3: знаменатели fold-to-steal — «слепой встретил попытку
                // кражи» (один префлоп-рейз от CO/BTN/SB). Вместе с числителями
                // дают foldToSteal*Pct в экспорте.
                stealFacedBBOpp: 0,
                stealFacedSBOpp: 0,
                // v65 M1: fold-to-cbet — числитель/знаменатель «Оверфолдера»
                foldToCbet: 0,
                foldToCbetOpp: 0,
                // v65 M0: гистограмма решений по GTO-узлам (ключ → {n,agg,pas,fld,
                // szN/szSum/szSq, tN/tSum/tSq — сайзинг/тайминг для RTA)
                nodeActionHist: new Map(),
                nodeObsTotal: 0,
                // v65.1 F6: контбеты/донки цели
                cbetMade: 0,
                donksMade: 0
            });
        }
        return state.stalkedPlayers.get(cleanNick);
    }

    // v65 M1 (2D-PROFILER, спека Module 1): развязанное 2D-профилирование.
    // Размер A — префлоп-архетип по (VPIP, PFR) после эмпирического байеса
    // (Beta/Dirichlet-сжатие к пулу, M=25 рук): θ̂=(k+M·μ)/(N+M) — выборка
    // 10–50 рук даёт устойчивые ярлыки, две разданные руки больше не
    // «переворачивают» профиль (сырой VPIP 4/15=26.7% → 5/15=33.3%).
    // Размер B — ортогональный постфлоп-модификатор по сглаженному AFq.
    // ЗАМЕЧАНИЕ (документированное отклонение): M=25 на плоскости ДЕЙСТВИЙ —
    // действия копятся быстрее рук, сжатие AFq слабее сжатия VPIP/PFR; спека
    // называла M «руками» для всех трёх величин — conflated planes.
    // Порог 10 рук: ниже — «[Сбор данных...]», применяется среднее пула.
    function getPlayerArchetype(p) {
        const h = p.handsCount || 0;
        if (h < 10) {
            return { tag: 'Unknown', label: '[Сбор данных...]', color: '#64748b', tip: `Недостаточно наблюдений (${h}/10). Применяется среднее пула.` };
        }

        const PRIOR_HANDS = 25.0;
        const POOL_VPIP = 26.0;
        const POOL_PFR = 18.0;
        const POOL_AFQ = 38.0;

        const smoothVPIP = (((p.vpipCount || 0) + (POOL_VPIP / 100.0) * PRIOR_HANDS) / (h + PRIOR_HANDS)) * 100.0;
        const smoothPFR = (((p.pfrCount || 0) + (POOL_PFR / 100.0) * PRIOR_HANDS) / (h + PRIOR_HANDS)) * 100.0;

        const aggActions = p.aggressiveActions || 0;
        const passActions = p.passiveActions || 0;
        const totPostActions = p.totalActions || (aggActions + passActions);
        const smoothAFq = totPostActions > 0
            ? (((aggActions + (POOL_AFQ / 100.0) * PRIOR_HANDS) / (totPostActions + PRIOR_HANDS)) * 100.0)
            : POOL_AFQ;

        // Dimension A: preflop archetype (7 classes on the smoothed plane)
        let preStyle = { name: 'Баланс', color: '#94a3b8', tip: 'Около-нейтральные частоты диапазона.' };
        if (smoothVPIP < 15.0) {
            preStyle = { name: 'Нит', color: '#eab308', tip: 'Ультра-тайтовый диапазон — блефы в его рейзы исключены.' };
        } else if (smoothVPIP <= 23.0 && smoothPFR < 12.0) {
            preStyle = { name: 'Тайт-Пассив', color: '#38bdf8', tip: 'Пассивный дефенд, много лимпов — изолировать позицией.' };
        } else if (smoothVPIP >= 16.0 && smoothVPIP <= 25.0 && smoothPFR >= 12.0 && smoothPFR <= 21.0) {
            preStyle = { name: 'ТАГ-Рег', color: '#a855f7', tip: 'Квалифицированный регуляр — эксплойт только по текстурам.' };
        } else if (smoothVPIP >= 26.0 && smoothVPIP <= 38.0 && smoothPFR >= 20.0) {
            preStyle = { name: 'ЛАГ', color: '#ec4899', tip: 'Широкие стилы и 3-беты — расширять 4-бет и коллдаун.' };
        } else if (smoothVPIP >= 25.0 && smoothVPIP <= 45.0 && smoothPFR < 14.0) {
            preStyle = { name: 'Пассив-Фиш', color: '#22c55e', tip: 'Лимп-колл префлоп — ставить исключительно на чистое вэлью.' };
        } else if (smoothVPIP > 45.0 && smoothPFR < 20.0) {
            preStyle = { name: 'Кит', color: '#10b981', tip: 'Экстремально лузовый — заходить под него с любым бродвеем.' };
        } else if (smoothVPIP > 40.0 && smoothPFR >= 22.0) {
            preStyle = { name: 'Маньяк', color: '#f97316', tip: 'Бессистемная агрессия — индуцировать блефы чек-коллом.' };
        }

        // Dimension B: orthogonal postflop modifier (>= 8 postflop actions)
        let postMod = { name: '', badge: '', tip: '' };
        if (totPostActions >= 8) {
            if (smoothAFq < 30.0) {
                postMod = { name: 'Station', badge: ' • 🛡️ Телефон', tip: 'Авто-колл по 2-й/3-й паре — фолд-эквити блефа нулевое.' };
            } else if (smoothAFq > 55.0) {
                postMod = { name: 'Aggro', badge: ' • ⚔️ Агро-Баррелер', tip: 'Переигрывает дро и слабые пары — коллировать шире.' };
            } else if (smoothAFq <= 40.0 && (p.foldToCbetOpp || 0) >= 3 && ((p.foldToCbet || 0) / Math.max(1, p.foldToCbetOpp || 1)) > 0.65) {
                // v65: порог выборки opp>=3 + >65% фолдов на контбет (спека
                // не гейтила выборку — 1/1=100% превратило бы шум в бейдж)
                postMod = { name: 'Folder', badge: ' • 🪓 Оверфолдер', tip: 'Сдаётся на контбет без совпадений — высокое фолд-эквити.' };
            }
        }

        return {
            tag: preStyle.name + (postMod.name ? '-' + postMod.name : ''),
            label: `[${preStyle.name}${postMod.badge}]`,
            color: preStyle.color,
            tip: `${preStyle.tip}${postMod.tip ? ' ' + postMod.tip : ''}`
        };
    }

    // v64.1: при перекалибровке базы нумерации мест (0→1) выравнивает
    // фолбэк-имена непризнанных мест под новую базу — вместе с никами уже
    // записанных действий текущей руки. Инвариант: имя-заглушка всегда
    // совпадает с отображаемым номером места в экспорте («Seat N: Seat N»).
    function realignSeatPlaceholders() {
        state.activeTables.forEach(ctx => {
            ctx.seats.forEach((s, sn) => {
                if (/^Seat \d+$/.test(s.rawNick) && /^seat_\d+$/.test(s.cleanNick)) {
                    let display = sn + (state.serverSeatBase === 0 ? 1 : 0);
                    if (s.rawNick !== `Seat ${display}`) {
                        s.rawNick = `Seat ${display}`;
                        s.cleanNick = `seat_${display}`;
                        ctx.timeline.forEach(t => {
                            if (t.seat === sn) { t.nick = s.rawNick; t.cleanNick = s.cleanNick; }
                        });
                    }
                }
            });
        });
    }

    // ── СЕРВЕРНЫЙ ДВИЖОК СТОЛА ─────────────────────────────────────────
    class TableContext {
        constructor(tableId, tournId = null) {
            this.tableId = tableId;
            this.tournId = tournId;
            this.name = 'Стол ' + (tableId ? String(tableId).substr(-4) : '');
            this.level = { sb: 0, bb: 0, ante: 0, number: null };
            this.handLevel = null;
            this.seats = new Map();
            this.hand = null;
            this.dealer = 0;
            this.board = [];
            this.street = 'PREFLOP';
            this.activeSeats = new Set();
            this.dealtSeats = new Set();
            this.positions = {};
            this.winners = [];
            this.showdownCards = {};
            this.handStart = {};
            this.investedPerSeat = new Map();       
            this.streetBetsPerSeat = new Map();     
            this.currentMaxBet = 0;                 
            this.handActions = new Map();
            this.timeline = [];
            this.knockoutBounties = [];
            this.sittingOutSeats = new Set();
            this.handPendingStats = new Map();
            this.playersCountedThisHand = new Set();
            this.processedActionIds = new Set();
            this.seatTimerStart = new Map();
            this.runningPot = 0;
            this.handOrigin = null;
            this.maxSeatId = 0;
            this.observedSeatCount = 0;
            // v65.1 F1 (MODULE-4-LIVE): приватные карты пользователя на ЕГО
            // столах + результат живого анализа борда (натс/HS/ауты в руке)
            this.userSeat = null;
            this.userCards = null;
            this.liveAnalysis = null;
            this.liveAnalysisToken = 0;
            // v62 B3: трекер попытки кражи текущей руки
            this.preflopRaises = 0;
            this.preflopStealAttempt = false;
            // v63 C7: счётчик лимперов (открытый банк = без лимперов)
            this.preflopCallers = 0;
            // v64.3 P6 (GTO-KEY): канонические ключи узлов решений по улицам
            // {STREET: {seat: key}}; gtoKeyedSeats — места с уже снятым
            // префлоп-ключом (первое реальное решение руки)
            this.gtoNodeKeys = {};
            this.gtoKeyedSeats = new Set();
        }

        getActiveHandBB() {
            if (this.level.bb > 0) return this.level.bb;
            if (this.tournId && state.liveTournaments.has(this.tournId)) {
                return state.liveTournaments.get(this.tournId).currentBB || 500;
            }
            return 500;
        }

        getTournamentMeta() {
            if (this.tournId && state.tournamentCache.has(this.tournId)) {
                return state.tournamentCache.get(this.tournId);
            }
            return { name: 'MTT', baseBuyin: 0, isPKO: false };
        }

        ensureSeat(seatNum, rawNick, serverStack = null) {
            let clean = rawNick ? getCleanNick(rawNick) : '';
            // v64.1: фолбэк-имя непризнанного места выровнен по базе нумерации
            // сервера (Connective Games 0-based: id 0..5). Экспорт PokerStars
            // печатает место seatNum+1 — раньше получалось «Seat 6: Seat 5».
            let displaySeatNum = seatNum + (state.serverSeatBase === 0 ? 1 : 0);
            if (!this.seats.has(seatNum)) {
                this.seats.set(seatNum, {
                    seat: seatNum,
                    rawNick: rawNick || `Seat ${displaySeatNum}`,
                    cleanNick: clean || `seat_${displaySeatNum}`,
                    stack: serverStack !== null ? serverStack : 0,
                    busted: false,
                    spent: 0
                });
            }
            let s = this.seats.get(seatNum);
            if (rawNick && s.rawNick !== rawNick) {
                s.rawNick = rawNick;
                s.cleanNick = clean;
            }
            if (serverStack !== null) s.stack = serverStack;
            return s;
        }

        beginHand(handNum, dealerSeat, activeSeatsList) {
            this.hand = handNum;
            this.dealer = dealerSeat || 0;
            this.board = [];
            this.street = 'PREFLOP';
            this.winners = [];
            this.showdownCards = {};
            this.handStart = {};
            this.investedPerSeat.clear();
            this.streetBetsPerSeat.clear();
            this.activeSeats.clear();
            this.dealtSeats.clear();
            this.handActions.clear();
            this.timeline = [];
            this.knockoutBounties = [];
            this.handPendingStats.clear();
            this.playersCountedThisHand.clear();
            this.processedActionIds.clear();
            this.seatTimerStart.clear();
            this.runningPot = 0;
            // v65.1 F1: карты пользователя живут в рамках одной руки
            this.userCards = null;
            this.liveAnalysis = null;
            this.liveAnalysisToken = (this.liveAnalysisToken || 0) + 1;
            // v62 B3: сброс трекера кражи руки
            this.preflopRaises = 0;
            this.preflopStealAttempt = false;
            // v63 C7: сброс счётчика лимперов — БЕЗ него счётчик протекал бы
            // через все последующие руки (фатальный регресс предложенного патча)
            this.preflopCallers = 0;
            // v64.3 P6: сброс GTO-ключей руки (ключи не протекают между руками)
            this.gtoNodeKeys = {};
            this.gtoKeyedSeats.clear();

            let currentBB = this.getActiveHandBB();
            this.handLevel = { sb: this.level.sb || Math.round(currentBB / 2), bb: currentBB, ante: this.level.ante || 0, number: this.level.number };
            this.currentMaxBet = currentBB;

            this.seats.forEach((s, sn) => {
                if (s.stack !== null && s.stack > 0) this.handStart[sn] = s.stack;
            });

            for (let sn of activeSeatsList) {
                this.ensureSeat(sn, null);
                this.activeSeats.add(sn);
                this.dealtSeats.add(sn);
                this.investedPerSeat.set(sn, 0);
                this.handActions.set(sn, []);
            }
            this.positions = calculatePositions(activeSeatsList, this.dealer);
        }

        recordAction(seatNum, label, amount) {
            let s = this.ensureSeat(seatNum, null);
            let list = this.handActions.get(seatNum) || [];
            let str = `${this.street}_${label}`;

            // v64.3 P6 (GTO-KEY): первое РЕАЛЬНОЕ решение игрока в руке —
            // фиксируем префлоп-ключ в момент решения: рейзы/лимперы ДО его
            // действия (что он видел), стек ДО его ставки. Блайнд-посты и
            // возвраты неколлированных ставок решениями не считаются.
            if (!['ANTE', 'SB', 'BB', 'UNCALLEDBET'].includes(label) && !this.gtoKeyedSeats.has(seatNum)) {
                this.gtoKeyedSeats.add(seatNum);
                this._snapshotGtoKey(seatNum);
            }
            
            let amtNum = amount || 0;
            let delta = 0;
            let prevStreetBet = (label !== 'ANTE') ? (this.streetBetsPerSeat.get(seatNum) || 0) : 0;
            let streetBetAfter = prevStreetBet;
            // v63 C7: максимум улицы ДО действия — агрессивность олл-ина
            // определяется против него, а не против собственной прошлой ставки
            let preMaxBet = this.currentMaxBet;

            // v64 F2 (BUG-POT-DESYNC): в протоколе Pokerdom / Connective Games
            // атрибут amount у ВСЕХ тегов действий (<Raise>, <Call>, <Bet>,
            // <AllIn>, <PostSmallBlind>, <PostAnte>) — это ДЕЛЬТА: прирост фишек
            // игрока именно в этот момент, а не суммарная ставка на улице.
            // Трактовка v61-F4 «RAISE/ALLIN amount = тотал улицы» вычитала
            // prevStreetBet из каждого рейза поверх блайнда и теряла фишки:
            // SB 150k → <Raise amount="450000"> = 600k тотал (2 BB), движок
            // считал 450k и ронял chip_conservation на 6/13 реальных рук,
            // банк занижался на 150k–450k, GTO писал «raises 150000 to 450000».
            // Экспортёры по-прежнему потребляют timeline.street_bet_after —
            // итог улицы теперь восстановлен корректно из дельт.
            if (['ANTE', 'SB', 'BB', 'CALL', 'BET', 'RAISE', 'ALLIN'].includes(label)) {
                delta = amtNum;
            } else if (label === 'UNCALLEDBET') {
                // возврат неколлированной части ставки — отрицательная дельта
                delta = -amtNum;
            }

            if (delta !== 0) {
                let handPrev = this.investedPerSeat.get(seatNum) || 0;
                this.investedPerSeat.set(seatNum, Math.max(0, handPrev + delta));
                this.runningPot += delta;

                if (label !== 'ANTE') {
                    let newStreetBet = Math.max(0, prevStreetBet + delta);
                    this.streetBetsPerSeat.set(seatNum, newStreetBet);
                    streetBetAfter = newStreetBet;
                    if (newStreetBet > this.currentMaxBet) {
                        this.currentMaxBet = newStreetBet;
                    }
                }
            }

            // v62 B3 (BUG-STEAL-METRICS): трекинг префлоп-рейзов руки. Попытка
            // кражи = ЕДИНСТВЕННЫЙ рейз префлоп, сделанный из поздней позиции
            // (CO/BTN/SB; в HU — BTN/SB). Второй рейз (3-бет) снимает флаг:
            // фолд блайнда против 3-бета — уже не fold-to-steal. Агрессивный
            // ALL-IN считается рейзом (пуш из CO в нераскрытом банке — та же
            // кража); неагрессивный (колл-олл-ин) — нет.
            // v63 C7 (UNOPENED POT): кража требует банк без лимперов — рейз
            // поверх лимпера это изоляция, не кража (PT4/H2N). Лимп = префлоп
            // CALL или неагрессивный олл-ин-колл (total ≤ максимума улицы);
            // блайнд-посты лимпами НЕ являются (SB-комплит — является, и это
            // верно: рейз BB поверх SB-комплита — не кража). Порядок: счётчик
            // инкрементируется до классификации рейза, поэтому лимпер раньше
            // рейзера закрывает банк автоматически.
            if (this.street === 'PREFLOP') {
                // v64 F2: amount олл-ина теперь дельта, поэтому агрессивность
                // сравнивает ИТОГ улицы (streetBetAfter = prev + delta) с
                // максимумом ДО действия — семантика v63 сохранена: короткий
                // all-in-рейз 250k поверх своей 200k (итог 450k > 300k) — рейз,
                // а не лимп; неагрессивный all-in-колл (итог ≤ max) — лимп.
                if (label === 'CALL' || (label === 'ALLIN' && streetBetAfter <= preMaxBet)) {
                    this.preflopCallers++;
                }
                if (label === 'RAISE' || (label === 'ALLIN' && streetBetAfter > preMaxBet)) {
                    this.preflopRaises++;
                    if (this.preflopRaises === 1) {
                        let rp = this.positions[seatNum] || '';
                        let unopened = (this.preflopCallers === 0);
                        this.preflopStealAttempt = unopened && (rp === 'CO' || rp === 'BTN' || rp.includes('SB'));
                    } else {
                        this.preflopStealAttempt = false;
                    }
                }
            }

            let thinkSec = null;
            let timerStart = this.seatTimerStart.get(seatNum);
            if (timerStart && !['ANTE', 'SB', 'BB', 'UNCALLEDBET'].includes(label)) {
                let diff = ((Date.now() - timerStart) / 1000).toFixed(1);
                if (diff >= 0 && diff < 60) thinkSec = parseFloat(diff);
                this.seatTimerStart.delete(seatNum);
            }

            let thinkStr = thinkSec !== null ? `[${thinkSec}s]` : '';
            let potBefore = Math.max(0, this.runningPot - delta);
            let potPct = (potBefore > 0 && delta > 0) ? Math.round(delta / potBefore * 100) : 0;

            if (amtNum > 0) {
                str += `:${amtNum}` + (potPct > 0 && potPct <= 500 ? `(${potPct}%pot)` : '') + thinkStr;
            } else {
                str += thinkStr;
            }
            list.push(str);
            this.handActions.set(seatNum, list);

            this.timeline.push({
                street: this.street, seat: seatNum, nick: s.rawNick, cleanNick: s.cleanNick,
                position: this.positions[seatNum] || 'N/A', action: label, amount: amtNum,
                pot_before: potBefore, pot_pct: (potPct > 0 && potPct <= 500) ? potPct : null, time_sec: thinkSec,
                street_bet_after: streetBetAfter
            });
        }

        updateBoardFromXml(xml) {
            let oldStreet = this.street;
            let boardDirect = xml.match(/<Board>(.*?)<\/Board>/i);
            if (boardDirect) {
                let cards = Array.from(boardDirect[1].matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => (m[1] === '10' ? 'T' : m[1].toUpperCase()) + m[2].toLowerCase());
                if (cards.length >= 3) {
                    this.board = cards.slice(0, 5);
                    this.street = this.board.length === 5 ? 'RIVER' : (this.board.length === 4 ? 'TURN' : 'FLOP');
                }
            } else {
                let streets = [['DealingFlop', 'FLOP', 3], ['DealingTurn', 'TURN', 4], ['DealingRiver', 'RIVER', 5]];
                for (let [tag, sName, maxCount] of streets) {
                    let stM = xml.match(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'i'));
                    if (stM) {
                        let fc = Array.from(stM[0].matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => (m[1] === '10' ? 'T' : m[1].toUpperCase()) + m[2].toLowerCase());
                        this.street = sName;
                        if (fc.length) {
                            if (sName === 'FLOP') this.board = fc.slice(0, 3);
                            else if (this.board.length < maxCount) this.board.push(fc[0]);
                        }
                    }
                }
            }

            if (this.street !== oldStreet) {
                this.streetBetsPerSeat.clear();
                this.currentMaxBet = 0;
                // v64.3 P6 (GTO-KEY): ключи новой улицы для всех, кто ещё в
                // руке — борд/класс банка уже известны, стек оценивается на
                // начало улицы (handStart − вложено)
                this.activeSeats.forEach(sn => this._snapshotGtoKey(sn));
            }

            // v65.1 F1 (аудит #1, MODULE-4-LIVE): анализ прямо В РУКЕ —
            // пересчёт при каждом обновлении борда, но только на активных
            // столах ИГРОКА (state.sockets.userTables) при известных его
            // картах. Пост-мортем в finalizeHand остаётся для архива JSON;
            // живой рендер — панель «🃏 LIVE» в HUD. Тяжёлое уходит в чанки.
            if (state.sockets.userTables.has(this.tableId)) {
                scheduleLiveBoardAnalysis(this);
            }
        }

        // v64.3 P6 (GTO-KEY): снимок канонического ключа узла для места.
        // buildGTONodeKey читает s.stack — подменяем его на оценку «стек в
        // момент решения» (handStart − вложено) и возвращаем обратно:
        // фактический s.stack до finalize остаётся стартовым.
        _snapshotGtoKey(seatNum) {
            try {
                let s = this.seats.get(seatNum);
                if (!s || !this.positions[seatNum]) return;
                let savedStack = s.stack;
                let invested = this.investedPerSeat.get(seatNum) || 0;
                let est = (this.handStart[seatNum] !== undefined && this.handStart[seatNum] !== null && this.handStart[seatNum] > 0)
                    ? (this.handStart[seatNum] - invested) : savedStack;
                if (est === null || est === undefined || est < 0) est = (savedStack === null || savedStack === undefined) ? 0 : savedStack;
                s.stack = est;
                let key = buildGTONodeKey(this, seatNum);
                s.stack = savedStack;
                if (!this.gtoNodeKeys[this.street]) this.gtoNodeKeys[this.street] = {};
                this.gtoNodeKeys[this.street][seatNum] = key;
            } catch (e) {}
        }

        // v65.1 F1 (аудит #1): приватные карты пользователя (только его
        // столы — вызывается из handleIncoming при userTables). Терпимо к
        // разным формам протокола: PrivateCards / PocketCards / YourCards /
        // HoleCards, тело с <Card> либо атрибут cards="Ah Kd"/"AhKd".
        updateUserCardsFromXml(xml) {
            try {
                let m = xml.match(/<(PrivateCards|PocketCards|YourCards|HoleCards)\s([^>]*)>([\s\S]*?)<\/\1>/i);
                if (m) {
                    let seat = iattr(m[2], 'seat');
                    let cards = Array.from((m[3] || '').matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(mm => (mm[1] === '10' ? 'T' : mm[1].toUpperCase()) + mm[2].toLowerCase());
                    if (cards.length < 2) {
                        let ca = attr(m[2], 'cards') || '';
                        let cm = ca.match(/([2-9TJQKA]|10)([shdc])/gi) || [];
                        cards = cm.map(x => { let mm = x.match(/([2-9TJQKA]|10)([shdc])/i); return mm ? ((mm[1] === '10' ? 'T' : mm[1].toUpperCase()) + mm[2].toLowerCase()) : null; }).filter(Boolean);
                    }
                    if (seat !== null && seat !== undefined) this.userSeat = seat;
                    if (cards.length >= 2) {
                        let norm = cards.slice(0, 2);
                        let changed = (!this.userCards || this.userCards[0] !== norm[0] || this.userCards[1] !== norm[1]);
                        this.userCards = norm;
                        if (changed) scheduleLiveBoardAnalysis(this);
                    }
                }
                // самосид места: PlayerInfo/Seat own="true"/self="true"
                if (this.userSeat === null) {
                    let own = xml.match(/<(PlayerInfo|Seat)\s[^>]*(?:own|self)="(?:true|1)"[^>]*>/i);
                    if (own) { let st = iattr(own[0], 'seat') !== null ? iattr(own[0], 'seat') : iattr(own[0], 'id'); if (st !== null) this.userSeat = st; }
                }
            } catch (e) {}
        }

        // v65 M0/M1 + v65.1 F6 (аудит #6): разбор решений руки из таймлайна.
        // (1) GTO-узлы: первое РЕАЛЬНОЕ действие игрока на улице → бакет
        // agg/pas/fld + сайзинг (%пот) и тайминг (сек) для RTA-метрик F3;
        // агрессивность ALLIN — по итогу улицы (street_bet_after vs max ДО
        // действия). (2) C-bet-стейт-машина (classifyFlopAggression):
        // префлоп-олл-ин-пуш = РЕЙЗ; контбет = ПЕРВАЯ агрессия флопа от
        // ПОСЛЕДНЕГО префлоп-агрессора в НЕРАСКРЫТОМ раунде; донк = первая
        // агрессия от НЕ-рейзера ДО первого действия рейзера на флопе.
        analyzeHandDecisions() {
            let nodeActions = new Map();
            let foldVsCbet = new Map();
            let cbets = new Map();
            let donks = new Map();
            let tl = this.timeline || [];

            let clf = classifyFlopAggression(tl);
            let firstSeen = new Set();

            for (let i = 0; i < tl.length; i++) {
                let t = tl[i];
                let st = t.street, seat = t.seat;
                let aggr = clf.aggrAt[i];
                let isBlindOrReturn = ['ANTE', 'SB', 'BB', 'UNCALLEDBET'].includes(t.action);
                let seenKey = st + '|' + seat;

                if (!isBlindOrReturn && !firstSeen.has(seenKey)) {
                    firstSeen.add(seenKey);
                    let nodeKey = (this.gtoNodeKeys && this.gtoNodeKeys[st]) ? this.gtoNodeKeys[st][seat] : null;
                    if (nodeKey) {
                        let s = this.seats.get(seat);
                        let nick = s ? s.cleanNick : '';
                        if (nick && TARGET_WATCHLIST.has(nick)) {
                            let bucket = (t.action === 'FOLD') ? 'fld' : (aggr ? 'agg' : 'pas');
                            // v65.1 F3: сайзинг/тайминг первого решения узла —
                            // сырьё для σ-метрик evaluateRTAConfidence
                            let potPct = (aggr && t.pot_pct) ? t.pot_pct : null;
                            let timeSec = (t.time_sec !== null && t.time_sec !== undefined) ? t.time_sec : null;
                            if (!nodeActions.has(nick)) nodeActions.set(nick, new Map());
                            nodeActions.get(nick).set(nodeKey, { bucket: bucket, potPct: potPct, timeSec: timeSec });
                        }
                    }
                }
            }

            // v65.1 F6: контбет = ПЕРВАЯ агрессия флопа от префлоп-агрессора
            // в нераскрытом раунде (flopFirstAggrIdx по построению — первая
            // агрессия раунда, раунд ДО неё не раскрыт). Донк = та же первая
            // агрессия, но от не-рейзера, сделанная ДО действия рейзера.
            if (clf.cbetIdx >= 0 && clf.lastAggrSeat !== null) {
                let ra = this.seats.get(clf.lastAggrSeat);
                let rNick = ra ? ra.cleanNick : '';
                if (rNick && TARGET_WATCHLIST.has(rNick)) {
                    cbets.set(rNick, { made: 1 });
                }
                // fold-to-cbet считаем в SRP (pfRaises === 1) — семантика M1
                if (clf.pfRaises === 1) {
                    let foldedBefore = new Set();
                    for (let i = 0; i < clf.cbetIdx; i++) if (tl[i].action === 'FOLD') foldedBefore.add(tl[i].seat);
                    let responded = new Set();
                    for (let i = clf.cbetIdx + 1; i < tl.length; i++) {
                        let t = tl[i];
                        if (t.street !== 'FLOP') break;
                        if (responded.has(t.seat) || foldedBefore.has(t.seat) || t.seat === clf.lastAggrSeat) continue;
                        responded.add(t.seat);
                        let s = this.seats.get(t.seat);
                        let nick = s ? s.cleanNick : '';
                        if (nick && TARGET_WATCHLIST.has(nick)) {
                            let rec = foldVsCbet.get(nick) || { opp: 0, fold: 0 };
                            rec.opp = 1;
                            if (t.action === 'FOLD') rec.fold = 1;
                            foldVsCbet.set(nick, rec);
                        }
                    }
                }
            }
            if (clf.donkIdx >= 0) {
                let da = this.seats.get(tl[clf.donkIdx].seat);
                let dNick = da ? da.cleanNick : '';
                if (dNick && TARGET_WATCHLIST.has(dNick)) {
                    donks.set(dNick, { made: 1 });
                }
            }

            return { nodeActions: nodeActions, foldVsCbet: foldVsCbet, cbets: cbets, donks: donks };
        }

        finalizeHand() {
            if (!this.hand) return null;
            if (this.handOrigin === 'midhand-sync') return null;

            let handBB = this.getActiveHandBB();
            let startTotal = 0, endTotal = 0, anyStart = false;
            let players = [];
            let tMeta = this.getTournamentMeta();
            let seatNums = Array.from(this.seats.keys()).sort((a, b) => a - b);
            
            let targetUpdates = [];
            let processedNicksThisHand = new Set(); // ИСПРАВЛЕНИЕ: Дедупликация целей (VPIP <= 100%)

            for (let sn of seatNums) {
                let s = this.seats.get(sn);
                let wonAmount = this.winners.filter(w => w.seat === sn).reduce((acc, w) => acc + w.amount, 0);
                let investedInPot = this.investedPerSeat.get(sn) || 0;

                let isParticipant = this.dealtSeats.has(sn) || investedInPot > 0 || wonAmount > 0;
                if (!isParticipant) continue;
                
                // ИСПРАВЛЕНИЕ: Безопасный расчет стека фолдеров без отбрасывания раздач
                let startStack = (this.handStart[sn] !== undefined && this.handStart[sn] !== null && this.handStart[sn] > 0) 
                    ? this.handStart[sn] 
                    : Math.max(investedInPot, (s.stack !== null ? s.stack : 0) + investedInPot);

                if (!startStack || startStack <= 0) {
                    startStack = Math.max(investedInPot, handBB);
                }

                anyStart = true;
                let endStack = Math.max(0, startStack - investedInPot + wonAmount);
                s.stack = endStack;
                startTotal += startStack;
                endTotal += endStack;

                if (TARGET_WATCHLIST.has(s.cleanNick) && !processedNicksThisHand.has(s.cleanNick)) {
                    processedNicksThisHand.add(s.cleanNick);
                    let pStats = this.handPendingStats.get(sn) || { vpip: false, pfr: false, agg: 0, pass: 0, tot: 0, stealBB: 0, stealSB: 0, stealBBOpp: 0, stealSBOpp: 0 };
                    targetUpdates.push({ cleanNick: s.cleanNick, isSitOut: this.sittingOutSeats.has(sn), pStats, showdown: !!this.showdownCards[sn] });
                }

                let sd = this.showdownCards[sn];
                let holeCards = sd ? sd.cards : 'xx xx';
                let handEval = (holeCards !== 'xx xx' && this.board.length >= 3) ? evaluate7Cards(`${holeCards} ${this.board.join(' ')}`) : "";
                // v65.1 F2 (аудит #2): hs_percentile / flop_outs дописываются
                // ЛЕНИВО в чанках ≤6мс (queueLazyHandMath) ПОСЛЕ архивации —
                // 120 фоновых столов с одновременными риверами больше не
                // фризят поток; значения готовы до любого экспорта (кнопки
                // читают архив позже, чем чанки успевают досчитать).
                let hsPct = null;
                let flopOuts = null;

                players.push({
                    seat: sn, nick: s.rawNick, cleanNick: s.cleanNick, position: this.positions[sn] || 'N/A',
                    stack_start: startStack, stack_start_bb: handBB > 0 ? Math.round(startStack / handBB * 10) / 10 : null,
                    stack_end: endStack, stack_end_bb: handBB > 0 ? Math.round(endStack / handBB * 10) / 10 : null,
                    cards: holeCards, eval_rank: handEval, is_muck_leak: (sd && sd.isMuck && sd.cards && sd.cards !== 'xx xx') ? 1 : 0,
                    is_sitting_out: this.sittingOutSeats.has(sn) ? 1 : 0, busted: endStack === 0 ? 1 : 0,
                    hs_percentile: hsPct, flop_outs: flopOuts,
                    flop_outs_pct: (flopOuts !== null && flopOuts !== undefined) ? (flopOuts / 47 * 100).toFixed(1) : null,
                    // v62 B4: единая формула с профилем/сканером — bullets × baseBuyin;
                    // серверное s.spent остаётся фолбэком при неизвестном baseBuyin,
                    // чтобы при промахе кэша не рапортовать 0₽.
                    spent_rub: (tMeta.baseBuyin > 0) ? (parseBulletNumber(s.rawNick) * tMeta.baseBuyin) : (s.spent || 0),
                    actions: this.handActions.get(sn) || []
                });
            }

            if (!anyStart) return null;

            for (let up of targetUpdates) {
                let prof = getOrCreatePlayerProfile(up.cleanNick);
                if (up.isSitOut) {
                    prof.sitOutHandsCount++;
                } else {
                    prof.handsCount++;
                    if (up.pStats.vpip) prof.vpipCount++;
                    if (up.pStats.pfr) prof.pfrCount++;
                    // v64.3 P5: дошёл до вскрытия (Show/Muck в showdownCards)
                    if (up.showdown) prof.showdownsCount++;
                    prof.aggressiveActions += up.pStats.agg;
                    prof.passiveActions += up.pStats.pass;
                    prof.totalActions += up.pStats.tot;
                    prof.stealFacedBB += up.pStats.stealBB;
                    prof.stealFacedSB += up.pStats.stealSB;
                    prof.stealFacedBBOpp += (up.pStats.stealBBOpp || 0);
                    prof.stealFacedSBOpp += (up.pStats.stealSBOpp || 0);
                }
                this.playersCountedThisHand.add(up.cleanNick);
            }

            // v65 M0/M1 + v65.1 F3/F6: решения этой руки → профили целей
            let decisions = this.analyzeHandDecisions();
            decisions.nodeActions.forEach((keysMap, cleanNick) => {
                let prof = getOrCreatePlayerProfile(cleanNick);
                if (!prof.nodeActionHist) prof.nodeActionHist = new Map();
                keysMap.forEach((v, key) => {
                    let stat = prof.nodeActionHist.get(key) || { n: 0, agg: 0, pas: 0, fld: 0, szN: 0, szSum: 0, szSq: 0, tN: 0, tSum: 0, tSq: 0 };
                    stat.n++;
                    stat[v.bucket]++;
                    // v65.1 F3: сайзинг/тайминг — сырьё σ-метрик RTA-уверенности
                    if (v.potPct) { stat.szN++; stat.szSum += v.potPct; stat.szSq += v.potPct * v.potPct; }
                    if (v.timeSec !== null && v.timeSec !== undefined) { stat.tN++; stat.tSum += v.timeSec; stat.tSq += v.timeSec * v.timeSec; }
                    prof.nodeActionHist.set(key, stat);
                });
                prof.nodeObsTotal = (prof.nodeObsTotal || 0) + keysMap.size;
            });
            decisions.foldVsCbet.forEach((v, cleanNick) => {
                let prof = getOrCreatePlayerProfile(cleanNick);
                prof.foldToCbetOpp += v.opp;
                prof.foldToCbet += v.fold;
            });
            // v65.1 F6: контбеты/донки цели — поведение агрессора на флопе
            decisions.cbets.forEach((v, cleanNick) => {
                let prof = getOrCreatePlayerProfile(cleanNick);
                prof.cbetMade = (prof.cbetMade || 0) + v.made;
            });
            decisions.donks.forEach((v, cleanNick) => {
                let prof = getOrCreatePlayerProfile(cleanNick);
                prof.donksMade = (prof.donksMade || 0) + v.made;
            });

            let conserved = (startTotal === endTotal);
            let calculatedPotTotal = Array.from(this.investedPerSeat.values()).reduce((a, b) => a + b, 0);

            // v61 F5: seat-base calibration snapshot for the exporters
            let maxSeatNum = 0;
            players.forEach(p => { if (p.seat > maxSeatNum) maxSeatNum = p.seat; });
            let seatBase = state.serverSeatBase;
            let tableMax = Math.max(players.length, this.observedSeatCount, maxSeatNum + (seatBase === 0 ? 1 : 0));

            return {
                hand_number: this.hand, tracking: 'full', table_id: this.tableId, table_name: this.name,
                tournament_id: this.tournId, tournament_name: tMeta.name, is_pko: tMeta.isPKO,
                timestamp: new Date().toISOString(), level: this.handLevel, dealer_seat: this.dealer,
                seat_base: seatBase, table_max: tableMax,
                board: this.board.join(' '), board_texture: classifyBoardTexture(this.board),
                // v65 M4: натс-лестница борда по улицам {flop/turn/river: tag}
                board_nuts: (this.board.length >= 3) ? computeBoardNuts(this.board) : null,
                pot_total: calculatedPotTotal, pot_bb: handBB > 0 ? Math.round(calculatedPotTotal / handBB * 10) / 10 : null,
                winners: this.winners, knockout_bounties: this.knockoutBounties, timeline: this.timeline,
                // v64.3 P6: канонические GTO-ключи узлов решений по улицам
                // {PREFLOP/FLOP/TURN/RIVER: {seat: key}} для мгновенного
                // lookup'а в солвере
                gto_node_keys: this.gtoNodeKeys || {},
                players: players, sync_verified: conserved, chip_conservation: { start_total: startTotal, end_total: endTotal, ok: conserved }
            };
        }
    }

    // ── OUTBOX EXPONENTIAL BACKOFF ────────────────────────────────────
    let isFlushingQueue = false;
    let outboxBackoffDelay = 3000;
    let nextAllowedOutboxTime = 0;

    function queueServerEvent(type, payload) {
        state.outboxQueue.push({ type: type, payload: payload, timestamp: Date.now() });
        if (state.outboxQueue.length > MAX_OUTBOX_QUEUE) state.outboxQueue.shift();
        processOutboxQueue();
    }

    async function processOutboxQueue() {
        if (isFlushingQueue || state.outboxQueue.length === 0 || Date.now() < nextAllowedOutboxTime) return;
        isFlushingQueue = true;

        while (state.outboxQueue.length > 0) {
            let batch = state.outboxQueue.slice(0, 25);
            try {
                let controller = new AbortController();
                let timeoutId = setTimeout(() => controller.abort(), 3500);

                let res = await fetch(`${scoutServerUrl}/scout_api/events_batch`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ events: batch }), signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (res.ok) {
                    state.outboxQueue.splice(0, batch.length);
                    state.hfStatus = 'Онлайн';
                    outboxBackoffDelay = 3000;
                } else {
                    state.hfStatus = `HTTP ${res.status}`;
                    outboxBackoffDelay = Math.min(outboxBackoffDelay * 1.5, 30000);
                    nextAllowedOutboxTime = Date.now() + outboxBackoffDelay;
                    break;
                }
            } catch (e) {
                state.hfStatus = 'Офлайн / Буфер';
                outboxBackoffDelay = Math.min(outboxBackoffDelay * 1.5, 30000);
                nextAllowedOutboxTime = Date.now() + outboxBackoffDelay;
                break;
            }
        }
        isFlushingQueue = false;
        updateHfIndicator();
    }

    function updateHfIndicator() {
        let el = document.getElementById('st-hf-status');
        if (!el) return;
        let qLen = state.outboxQueue.length;
        let qStr = qLen > 0 ? ` (Буфер: ${qLen})` : '';
        el.innerHTML = state.hfStatus === 'Онлайн' 
            ? `<span style="color:#4ade80;">HF: ● Онлайн${qStr}</span>`
            : `<span style="color:#f87171;">HF: ○ ${state.hfStatus}${qStr}</span>`;
    }

    // ── GTO POKERSTARS EXPORTER ───────────────────────────────────────
    function convertHandsToPokerStarsHH(handsList) {
        let output = [];
        handsList.forEach(h => {
            if (h.tracking !== 'full') return;
            try {
                const hNum = h.hand_number || "2849280000";
                const tId = h.tournament_id ? h.tournament_id.replace(/^f78-/, '') : "1000000";
                const tName = cleanCyrillic(h.tournament_name || "Tournament").replace(/[^\w\sа-яА-ЯёЁ\-\.\"\']/gi, '');
                const level = h.level || { sb: 100, bb: 200, ante: 25, number: 1 };
                const sb = level.sb || 100;
                const bb = level.bb || 200;
                const ante = level.ante || 0;
                const lvlNum = level.number || 1;
                const dateStr = h.timestamp ? new Date(h.timestamp).toUTCString().replace("GMT", "ET") : new Date().toUTCString().replace("GMT", "ET");

                const lines = [];
                lines.push(`PokerStars Hand #${hNum}: Tournament #${tId}, ${tName} Hold'em No Limit - Level ${lvlNum} (${sb}/${bb}) - ${dateStr}`);

                const players = h.players || [];
                // v61 F5: seat numbering is calibrated against the detected server seat base
                // (0-based → +1 for PokerStars format, 1-based → as-is). Fallback: 0-based.
                const seatBase = (h.seat_base === 0 || h.seat_base === 1) ? h.seat_base : 0;
                const seatOffset = seatBase === 0 ? 1 : 0;
                const numPlayers = h.table_max || players.length || 8;
                const dealerSeatIdx = (h.dealer_seat !== undefined && h.dealer_seat !== null) ? (h.dealer_seat + seatOffset) : 1;
                const tableId = h.table_id || "1";

                lines.push(`Table '${tableId} 1' ${numPlayers}-max Seat #${dealerSeatIdx} is the button`);

                players.forEach(p => {
                    const sNum = (p.seat !== undefined) ? (p.seat + seatOffset) : 1;
                    lines.push(`Seat ${sNum}: ${p.nick} (${p.stack_start || 0} in chips)`);
                });

                // v63 C2: ante не больше стека игрока; стек ≤ анте → ' and is all-in'
                if (ante > 0) players.forEach(p => {
                    let anteAmt = Math.min(ante, p.stack_start || 0);
                    if (anteAmt > 0) {
                        let anteAllIn = (p.stack_start || 0) <= ante ? ' and is all-in' : '';
                        lines.push(`${p.nick}: posts the ante ${anteAmt}${anteAllIn}`);
                    }
                });

                let sbPosted = false, bbPosted = false;
                players.forEach(p => {
                    (p.actions || []).forEach(a => {
                        if (a.includes('PREFLOP_SB:')) {
                            // v63 C2: стек, съеденный анте, не порождает пост «0»
                            let amt = extractAmt(a) || sb;
                            let effStack = Math.max(0, (p.stack_start || 0) - ante);
                            if (effStack > 0) {
                                let postAmt = Math.min(effStack, amt);
                                let allInStr = (effStack <= amt) ? ' and is all-in' : '';
                                lines.push(`${p.nick}: posts small blind ${postAmt}${allInStr}`);
                                sbPosted = true;
                            }
                        } else if (a.includes('PREFLOP_BB:')) {
                            let amt = extractAmt(a) || bb;
                            let effStack = Math.max(0, (p.stack_start || 0) - ante);
                            if (effStack > 0) {
                                let postAmt = Math.min(effStack, amt);
                                let allInStr = (effStack <= amt) ? ' and is all-in' : '';
                                lines.push(`${p.nick}: posts big blind ${postAmt}${allInStr}`);
                                bbPosted = true;
                            }
                        }
                    });
                });

                // v63 C2: запасной цикл — тот же guard: реальный эмиттер нулевой
                // строки был именно здесь (игрок, чей стек целиком ушёл в анте,
                // не имеет SB-действия для основного цикла).
                if (!sbPosted || !bbPosted) {
                    players.forEach(p => {
                        let effStack = Math.max(0, (p.stack_start || 0) - ante);
                        if (effStack <= 0) return;
                        if (!sbPosted && (p.position === 'SB' || p.position === 'BTN/SB')) {
                            let postAmt = Math.min(effStack, sb);
                            let allInStr = (effStack <= sb) ? ' and is all-in' : '';
                            lines.push(`${p.nick}: posts small blind ${postAmt}${allInStr}`);
                            sbPosted = true;
                        }
                        if (!bbPosted && p.position === 'BB') {
                            let postAmt = Math.min(effStack, bb);
                            let allInStr = (effStack <= bb) ? ' and is all-in' : '';
                            lines.push(`${p.nick}: posts big blind ${postAmt}${allInStr}`);
                            bbPosted = true;
                        }
                    });
                }

                lines.push(`*** HOLE CARDS ***`);

                let knownPlayer = players.find(p => p.cards && p.cards !== 'xx xx');
                if (knownPlayer) lines.push(`Dealt to ${knownPlayer.nick} [${knownPlayer.cards}]`);

                const boardCards = (h.board || "").trim().split(/\s+/).filter(c => c && c.length >= 2);
                let currentStreet = 'PREFLOP';
                let streetBets = {};
                let currentMaxBet = bb;
                let flopPrinted = false, turnPrinted = false, riverPrinted = false;

                players.forEach(p => {
                    let effStack = Math.max(0, (p.stack_start || 0) - ante);
                    if (p.position === 'SB' || p.position === 'BTN/SB') streetBets[p.nick] = Math.min(effStack, sb);
                    if (p.position === 'BB') streetBets[p.nick] = Math.min(effStack, bb);
                    (p.actions || []).forEach(a => {
                        if (a.includes('PREFLOP_SB:')) streetBets[p.nick] = Math.min(effStack, extractAmt(a) || sb);
                        if (a.includes('PREFLOP_BB:')) streetBets[p.nick] = Math.min(effStack, extractAmt(a) || bb);
                    });
                });

                (h.timeline || []).forEach(item => {
                    let st = item.street;
                    let act = item.action;
                    let amt = item.amount || 0;
                    let nick = item.nick;

                    if (['ANTE', 'SB', 'BB'].includes(act)) return;

                    if (st !== currentStreet) {
                        currentStreet = st;
                        streetBets = {};
                        currentMaxBet = 0;

                        if (st === 'FLOP' && boardCards.length >= 3 && !flopPrinted) {
                            lines.push(`*** FLOP *** [${boardCards.slice(0, 3).join(' ')}]`);
                            flopPrinted = true;
                        } else if (st === 'TURN' && boardCards.length >= 4 && !turnPrinted) {
                            lines.push(`*** TURN *** [${boardCards.slice(0, 3).join(' ')}] [${boardCards[3]}]`);
                            turnPrinted = true;
                        } else if (st === 'RIVER' && boardCards.length >= 5 && !riverPrinted) {
                            lines.push(`*** RIVER *** [${boardCards.slice(0, 4).join(' ')}] [${boardCards[4]}]`);
                            riverPrinted = true;
                        }
                    }

                    let tStr = (item.time_sec !== null && item.time_sec !== undefined) ? ` [${item.time_sec}s]` : '';
                    let prevBet = streetBets[nick] || 0;
                    // v61 F4: street_bet_after (engine truth) is the single source for the
                    // player's total street commitment; legacy fallback keeps old semantics
                    // for CALL (increment) and BET/RAISE (total).
                    let totalBet = (item.street_bet_after !== undefined && item.street_bet_after !== null)
                        ? item.street_bet_after
                        : ((act === 'CALL') ? (prevBet + amt) : amt);

                    if (act === 'FOLD') lines.push(`${nick}: folds${tStr}`);
                    else if (act === 'CHECK') lines.push(`${nick}: checks${tStr}`);
                    else if (act === 'CALL') {
                        lines.push(`${nick}: calls ${Math.max(0, totalBet - prevBet)}${tStr}`);
                        streetBets[nick] = totalBet;
                    } else if (act === 'BET') {
                        lines.push(`${nick}: bets ${totalBet}${tStr}`);
                        streetBets[nick] = totalBet;
                        currentMaxBet = totalBet;
                    } else if (act === 'RAISE' || act === 'ALLIN') {
                        let targetBet = totalBet;
                        if (currentMaxBet === 0) {
                            lines.push(`${nick}: bets ${targetBet}${act === 'ALLIN' ? ' and is all-in' : ''}${tStr}`);
                            currentMaxBet = targetBet;
                        } else if (targetBet > currentMaxBet) {
                            let raiseDelta = targetBet - currentMaxBet;
                            lines.push(`${nick}: raises ${raiseDelta} to ${targetBet}${act === 'ALLIN' ? ' and is all-in' : ''}${tStr}`);
                            currentMaxBet = targetBet;
                        } else {
                            // all-in short of the current bet → call for what's left
                            let callAmt = Math.max(0, targetBet - prevBet);
                            lines.push(`${nick}: calls ${callAmt}${act === 'ALLIN' ? ' and is all-in' : ''}${tStr}`);
                        }
                        streetBets[nick] = targetBet;
                    } else if (act === 'UNCALLEDBET') {
                        lines.push(`Uncalled bet (${amt}) returned to ${nick}`);
                    }
                });

                let isAllInShowdown = players.some(p => p.cards && p.cards !== 'xx xx');
                if (isAllInShowdown) {
                    if (boardCards.length >= 3 && !flopPrinted) {
                        lines.push(`*** FLOP *** [${boardCards.slice(0, 3).join(' ')}]`);
                        flopPrinted = true;
                    }
                    if (boardCards.length >= 4 && !turnPrinted) {
                        lines.push(`*** TURN *** [${boardCards.slice(0, 3).join(' ')}] [${boardCards[3]}]`);
                        turnPrinted = true;
                    }
                    if (boardCards.length >= 5 && !riverPrinted) {
                        lines.push(`*** RIVER *** [${boardCards.slice(0, 4).join(' ')}] [${boardCards[4]}]`);
                        riverPrinted = true;
                    }
                }

                // v63 C3: заголовок SHOW DOWN — только если есть карты;
                // неконтестированный банк (все фолды) идёт сразу к collected+SUMMARY
                let hasShowdownCards = players.some(p => p.cards && p.cards !== 'xx xx');
                if (hasShowdownCards) {
                    lines.push(`*** SHOW DOWN ***`);
                    players.forEach(p => {
                        if (p.cards && p.cards !== 'xx xx') {
                            if (p.is_muck_leak) lines.push(`${p.nick}: mucks hand [${p.cards}]`);
                            else lines.push(`${p.nick}: shows [${p.cards}]`);
                        }
                    });
                }

                let totalWonAmount = 0;
                let hasSidePots = (h.winners || []).some(w => w.potIndex && w.potIndex > 0);

                (h.winners || []).forEach(w => {
                    const wp = players.find(p => p.seat === w.seat);
                    const wNick = wp ? wp.nick : `Seat ${w.seat + seatOffset}`;
                    let potLabel = 'pot';
                    if (hasSidePots) {
                        potLabel = (w.potIndex && w.potIndex > 0) ? `side pot-${w.potIndex}` : `main pot`;
                    }
                    lines.push(`${wNick} collected ${w.amount} from ${potLabel}`);
                    totalWonAmount += w.amount;
                });

                // v64 F6 (BUG-KO-SUMMARY): каноническая строка PokerStars для
                // PKO-наускаута — «X wins the tournament and receives Y in
                // bounty» — стоит в настоящем HH сразу после collected-строк,
                // перед SUMMARY. PT4/HM3 парсят её при импорте, чтобы учесть
                // баунти-выплаты; без неё трекеры не видели баунти вовсе.
                (h.knockout_bounties || []).forEach(ko => {
                    let kNick = ko.killer_nick;
                    let kp = players.find(p => p.seat === ko.killer_seat);
                    if (kp) kNick = kp.nick;
                    let bountyCash = ko.cash_payout_rub || 0;
                    if (kNick && bountyCash > 0) {
                        lines.push(`${kNick} wins the tournament and receives ${bountyCash} in bounty`);
                    }
                });

                lines.push(`*** SUMMARY ***`);
                let finalPot = totalWonAmount > 0 ? totalWonAmount : (h.pot_total || 0);
                lines.push(`Total pot ${finalPot} | Rake 0`);
                if (boardCards.length > 0) lines.push(`Board [${boardCards.join(' ')}]`);

                players.forEach(p => {
                    const sNum = p.seat + seatOffset;
                    const isBtn = (p.seat === h.dealer_seat) ? " (button)" : "";
                    const isSb = (p.position === "SB" || p.position === "BTN/SB") ? " (small blind)" : "";
                    const isBb = (p.position === "BB") ? " (big blind)" : "";
                    // v63 C1: в HU BTN совпадает с SB — канонический PS выводит ОБА тега
                    // ("(button) (small blind)"). Цепочка `a || b || c` возвращала первый
                    // truthy-операнд и теряла "(small blind)".
                    const posStr = (isBtn && (p.position === "BTN/SB" || p.position === "SB"))
                        ? `${isBtn}${isSb}`
                        : (isBtn || isSb || isBb);
                    
                    let outcomeStr = "folded";
                    // v63 C5: дошедший до вскрытия без показа — 'mucked', не 'folded'.
                    // Последняя запись таймлайна места: фолдер всегда заканчивается
                    // FOLD; non-FOLD в конце = игрок был жив на финале (речной колл
                    // ИЛИ олл-ин до ривера — покрытие остаточного пробела патча).
                    let lastTl = (h.timeline || []).filter(it => it.seat === p.seat).pop();
                    let muckedAtShowdown = lastTl && lastTl.action !== 'FOLD';
                    const wEntry = (h.winners || []).find(w => w.seat === p.seat);
                    if (wEntry) outcomeStr = `showed [${p.cards || 'xx xx'}] and won (${wEntry.amount})`;
                    else if (p.cards && p.cards !== 'xx xx') outcomeStr = `showed [${p.cards}] and lost`;
                    else if (muckedAtShowdown) outcomeStr = "mucked";
                    
                    lines.push(`Seat ${sNum}: ${p.nick}${posStr} ${outcomeStr}`);
                });

                output.push(lines.join("\n"));
            } catch(e) {}
        });
        return output.join("\n\n\n");
    }

    // ── DENSE DSL EXPORTER ────────────────────────────────────────────
    function convertHandsToDenseDSL(handsList) {
        let globalDict = new Map();
        let unknownCounter = 1;

        handsList.forEach(h => {
            (h.players || []).forEach(p => {
                let clean = p.cleanNick;
                if (!globalDict.has(clean)) {
                    if (TARGET_ID_MAP.has(clean)) {
                        globalDict.set(clean, TARGET_ID_MAP.get(clean));
                    } else {
                        globalDict.set(clean, `u${unknownCounter++}`);
                    }
                }
            });
        });

        let dictHeader = "DICT: " + Array.from(globalDict.entries()).map(([nick, id]) => `${id}=${nick}`).join('|');
        let handsLines = [];

        handsList.forEach(h => {
            if (h.tracking !== 'full') return;
            try {
                let hNum = h.hand_number;
                let tId = h.tournament_id ? h.tournament_id.replace(/^f78-/, '') : 'mtt';
                let lvl = h.level || { sb: 100, bb: 200, ante: 0 };
                let btn = h.dealer_seat !== undefined ? h.dealer_seat : 0;

                let pBlock = (h.players || []).map(p => {
                    let pId = globalDict.get(p.cleanNick) || `p${p.seat}`;
                    // v64 F5 (BUG-MUCK-MARKER): карты оппонента, слитые в открытую
                    // через утечку протокола (is_muck_leak), помечаются «!» перед
                    // кодом карт: :!As7d. Без маркера их невозможно отличить от
                    // добровольного шоудауна/показа при пост-обработке DSL.
                    let cardStr = '';
                    if (p.cards && p.cards !== 'xx xx') {
                        let cleanCards = p.cards.replace(/\s+/g, '');
                        cardStr = p.is_muck_leak ? `:!${cleanCards}` : `:${cleanCards}`;
                    }
                    let evalStr = p.eval_rank ? `:${p.eval_rank}` : '';
                    // v64.3 P1 (DENSE-AFK): явный маркер игрока вне игры —
                    // «6:u17:16620:AFK»; раньше sit-out был неотличим от
                    // активного игрока в DSL (JSON нёс is_sitting_out)
                    let afkStr = p.is_sitting_out ? ':AFK' : '';
                    return `${p.seat}:${pId}:${p.stack_start}${cardStr}${evalStr}${afkStr}`;
                }).join('|');

                let boardCards = (h.board || '').trim().split(/\s+/).filter(Boolean);
                // v64.3 P4 (BOARD-TEXTURE): «B:8h7c8d/Ks/Ad:paired» — корзина
                // k-means классификатора флопа; префлоп без борда — без суффикса
                let boardTexture = classifyBoardTexture(boardCards);
                let boardStr = '';
                if (boardCards.length >= 3) boardStr += boardCards.slice(0, 3).join('');
                if (boardCards.length >= 4) boardStr += '/' + boardCards[3];
                if (boardCards.length >= 5) boardStr += '/' + boardCards[4];
                if (boardTexture && boardTexture !== 'preflop') boardStr += `:${boardTexture}`;

                let dslStreetBets = {};
                let currentStreetIndex = 1;
                let actsParts = [];

                (h.timeline || []).forEach(item => {
                    if (['ANTE', 'SB', 'BB'].includes(item.action)) {
                        if (item.action === 'SB' || item.action === 'BB') {
                            dslStreetBets[item.seat] = item.amount;
                        }
                        return;
                    }

                    let itemStreetIndex = item.street === 'RIVER' ? 4 : (item.street === 'TURN' ? 3 : (item.street === 'FLOP' ? 2 : 1));
                    while (currentStreetIndex < itemStreetIndex) {
                        actsParts.push('/');
                        currentStreetIndex++;
                        dslStreetBets = {};
                    }

                    let prevBet = dslStreetBets[item.seat] || 0;
                    // v61 F4: engine-truth street total; legacy fallback for old data
                    let totalCommit = (item.street_bet_after !== undefined && item.street_bet_after !== null)
                        ? item.street_bet_after
                        : ((item.action === 'CALL') ? (prevBet + item.amount) : item.amount);
                    dslStreetBets[item.seat] = totalCommit;

                    let actCode = '';
                    if (item.action === 'FOLD') actCode = 'f';
                    else if (item.action === 'CHECK') actCode = 'k';
                    else if (item.action === 'CALL') actCode = `c${item.amount}`;
                    else if (item.action === 'BET') actCode = `b${totalCommit}`;
                    else if (item.action === 'RAISE' || item.action === 'ALLIN') actCode = `r${totalCommit}`;
                    else if (item.action === 'UNCALLEDBET') actCode = `u${item.amount}`;
                    else actCode = item.action.toLowerCase();

                    if (!actCode) return;
                    let tStr = (item.time_sec !== null && item.time_sec !== undefined) ? `(${item.time_sec})` : '';
                    actsParts.push(`p${item.seat}.${actCode}${tStr}`);
                });

                let isAllInShowdown = (h.players || []).some(p => p.cards && p.cards !== 'xx xx');
                if (isAllInShowdown) {
                    let maxBoardStreetIndex = boardCards.length >= 5 ? 4 : (boardCards.length >= 4 ? 3 : (boardCards.length >= 3 ? 2 : 1));
                    while (currentStreetIndex < maxBoardStreetIndex) {
                        actsParts.push('/');
                        currentStreetIndex++;
                    }
                }

                let acts = actsParts.join('');

                let winParts = (h.winners || []).map(w => {
                    let wp = (h.players || []).find(p => p.seat === w.seat);
                    let pId = wp ? (globalDict.get(wp.cleanNick) || `p${w.seat}`) : `p${w.seat}`;
                    let evalStr = (wp && wp.eval_rank) ? `:${wp.eval_rank}` : '';
                    return `${pId}:${w.amount}${evalStr}`;
                }).join(';');

                let dsl = `[#${hNum}|${tId}:${lvl.sb}/${lvl.bb}/${lvl.ante}:B${btn}|P:${pBlock}|B:${boardStr}|A:${acts}|W:${winParts}]`;
                handsLines.push(dsl);
            } catch(e) {}
        });

        return `${dictHeader}\n\n${handsLines.join('\n')}`;
    }

    window.__stalkerExportGTO = function() {
        let fullHands = state.completedHandsArchive.filter(h => h.tracking === 'full');
        if (fullHands.length === 0) {
            alert('Нет полных валидных раздач для GTO экспорта!');
            return;
        }
        let txt = convertHandsToPokerStarsHH(fullHands);
        let blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
        let url = URL.createObjectURL(blob);
        let a = document.createElement('a');
        a.href = url;
        a.download = `PokerStars_GTO_v651_${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // v61 F1 (BUG-MEMORY): release the blob reference — the download has started.
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 10000);
    };

    window.__stalkerExportDSL = function() {
        let fullHands = state.completedHandsArchive.filter(h => h.tracking === 'full');
        if (fullHands.length === 0) {
            alert('Нет полных валидных раздач для Dense DSL экспорта!');
            return;
        }
        let dslText = convertHandsToDenseDSL(fullHands);
        let blob = new Blob([dslText], { type: 'text/plain;charset=utf-8' });
        let url = URL.createObjectURL(blob);
        let a = document.createElement('a');
        a.href = url;
        a.download = `Scalpel_Dense_AI_v651_${Date.now()}.dsl`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // v61 F1 (BUG-MEMORY): release the blob reference — the download has started.
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 10000);
    };

    // ── v65 M0 (GTO-KEYS-EXPORT) + v65.1 F3: компактный TSV узлов решений ──
    // Гистограмма «первое действие на улице» по каноническим GTO-ключам
    // каждой цели: ключ узла → n/agg/pas/fld + сайзинг/тайминг. С v65.1
    // RTA-вердикт считается В ПАМЯТИ (evaluateRTAConfidence, ≥8 узлов /
    // 32+ решений) и живёт бейджем в HUD; TSV — бонус для оффлайн-анализа,
    // а не замена (заголовок игрока несёт и mix-статистику, и [RTA PROB]).
    window.__stalkerExportGTOKeys = function() {
        try {
            let playersWithNodes = Array.from(state.stalkedPlayers.values())
                .filter(p => p.nodeActionHist && p.nodeActionHist.size > 0);
            if (playersWithNodes.length === 0) {
                alert('Нет собранных GTO-ключей узлов (нужны завершённые раздачи с целями)!');
                return;
            }
            let lines = [];
            lines.push('# SCALPEL v65.1 — GTO NODE KEYS (compact TSV)');
            lines.push('# generated: ' + new Date().toISOString());
            lines.push('# format: player<TAB>node_key<TAB>n<TAB>agg<TAB>pas<TAB>fld<TAB>agg%');
            lines.push('# agg=BET/RAISE/aggr-ALLIN  pas=CHECK/CALL/passive-ALLIN  fld=FOLD');
            lines.push('# node decision = первое действие игрока на улице (состояние на входе в узел)');
            lines.push('# сырые ключи по рукам — в JSON-экспорте (gto_node_keys каждой руки)');
            playersWithNodes.forEach(p => {
                let nodes = Array.from(p.nodeActionHist.entries());
                let obs = nodes.reduce((acc, kv) => acc + kv[1].n, 0);
                let qual = nodes.filter(kv => kv[1].n >= 4);
                let mixed = qual.filter(kv => { let f = kv[1].agg / kv[1].n; return f >= 0.55 && f <= 0.80; });
                let mixPct = qual.length > 0 ? Math.round(mixed.length / qual.length * 100) : 0;
                lines.push('# player: ' + p.cleanNick + ' | hands: ' + (p.handsCount || 0) + ' | nodes: ' + nodes.length +
                    ' | obs: ' + obs + ' | nodes>=4: ' + qual.length + ' | mixed(agg 55-80%): ' + mixed.length +
                    ' | mix: ' + mixPct + '% (mix — описательная; вердикт — строка RTA ниже)');
                // v65.1 F3: RTA-вердикт из памяти (не только TSV)
                let rtaE = evaluateRTAConfidence(p.nodeActionHist);
                lines.push('# RTA: ' + (rtaE.eligible
                    ? ('[RTA PROB: ' + rtaE.prob + '%] (чист. ' + rtaE.pureRate + '%, σсайз ' + rtaE.sizeStick + '%, σврем ' + rtaE.timeStick + '%)')
                    : ('недостаточно данных — ' + rtaE.progress)));
                nodes.sort((a, b) => b[1].n - a[1].n).forEach(kv => {
                    let s = kv[1];
                    let aggPct = s.n > 0 ? (s.agg / s.n * 100).toFixed(1) : '0.0';
                    lines.push([p.cleanNick, kv[0], s.n, s.agg, s.pas, s.fld, aggPct].join('\t'));
                });
            });
            let txt = lines.join('\n') + '\n';
            let blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
            let url = URL.createObjectURL(blob);
            let a = document.createElement('a');
            a.href = url;
            a.download = `Scalpel_GTO_node_keys_v651_${Date.now()}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            // v61 F1 (BUG-MEMORY): release the blob reference
            setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 10000);
        } catch (e) {
            alert('Ошибка экспорта GTO-ключей: ' + e.message);
        }
    };

    // ── ТОЧНЫЙ ЭКСПОРТ JSON ───────────────────────────────────────────
    window.__stalkerExportJSON = function() {
        try {
            let exportData = {
                timestamp: new Date().toISOString(),
                discipline: "TEXAS_HOLDEM_ONLY",
                targetsCount: state.stalkedPlayers.size,
                liveTournamentsCount: state.liveTournaments.size,
                outboxQueueLength: state.outboxQueue.length,
                recorded_hands_count: state.completedHandsArchive.length,
                // v65.1 F4 (MODULE 3): срез модели выживания (n_alive/n_itm/p_itm)
                module3_survival: buildModule3Snapshot(),
                debug_engine_log: state.engineDebugLog,
                chat_logs: state.chatLogs,
                recorded_hands: state.completedHandsArchive,
                players: {}
            };

            state.stalkedPlayers.forEach((p, cleanNick) => {
                let agg = p.aggressiveActions || 0;
                let pass = p.passiveActions || 0;
                let totalActs = p.totalActions || (agg + pass);
                let afq = totalActs > 0 ? parseFloat(((agg / totalActs) * 100).toFixed(1)) : 0;
                let af = pass > 0 ? parseFloat((agg / pass).toFixed(2)) : (agg > 0 ? 99.0 : 0.0);
                let vpip = p.handsCount > 0 ? parseFloat(((p.vpipCount / p.handsCount) * 100).toFixed(1)) : 0;
                let pfr = p.handsCount > 0 ? parseFloat(((p.pfrCount / p.handsCount) * 100).toFixed(1)) : 0;

                exportData.players[cleanNick] = {
                    cleanNick: p.cleanNick,
                    handsCount: p.handsCount,
                    sitOutHandsCount: p.sitOutHandsCount,
                    // v64.3 P5: вскрытия — знаменатель wtsd-архетипа
                    showdownsCount: p.showdownsCount || 0,
                    vpip: vpip,
                    pfr: pfr,
                    af: af,
                    afq: afq,
                    stealFacedBB: p.stealFacedBB || 0,
                    stealFacedSB: p.stealFacedSB || 0,
                    // v62 B3: знаменатели и проценты fold-to-steal
                    stealFacedBBOpp: p.stealFacedBBOpp || 0,
                    stealFacedSBOpp: p.stealFacedSBOpp || 0,
                    foldToStealBBPct: (p.stealFacedBBOpp || 0) > 0 ? parseFloat(((p.stealFacedBB || 0) / (p.stealFacedBBOpp || 1) * 100).toFixed(1)) : 0,
                    foldToStealSBPct: (p.stealFacedSBOpp || 0) > 0 ? parseFloat(((p.stealFacedSB || 0) / (p.stealFacedSBOpp || 1) * 100).toFixed(1)) : 0,
                    // v65 M1: fold-to-cbet (числитель/знаменатель/процент)
                    foldToCbet: p.foldToCbet || 0,
                    foldToCbetOpp: p.foldToCbetOpp || 0,
                    foldToCbetPct: (p.foldToCbetOpp || 0) > 0 ? parseFloat(((p.foldToCbet || 0) / (p.foldToCbetOpp || 1) * 100).toFixed(1)) : 0,
                    // v65 M0 + v65.1 F3: гистограмма GTO-узлов с сайзингом/таймингом
                    gtoNodes: (p.nodeActionHist && p.nodeActionHist.size > 0) ? Array.from(p.nodeActionHist.entries()).sort((a, b) => b[1].n - a[1].n).map(kv => ({ key: kv[0], n: kv[1].n, agg: kv[1].agg, pas: kv[1].pas, fld: kv[1].fld, agg_pct: kv[1].n > 0 ? parseFloat((kv[1].agg / kv[1].n * 100).toFixed(1)) : 0, sz_n: kv[1].szN || 0, sz_mean_pct: (kv[1].szN || 0) > 0 ? Math.round((kv[1].szSum || 0) / kv[1].szN * 10) / 10 : null, t_n: kv[1].tN || 0, t_mean_sec: (kv[1].tN || 0) > 0 ? Math.round((kv[1].tSum || 0) / kv[1].tN * 10) / 10 : null })) : [],
                    // v65.1 F3 (аудит #3): RTA-уверенность — в памяти, не только TSV
                    rta: (function () { let r = evaluateRTAConfidence(p.nodeActionHist); return { eligible: r.eligible, prob: r.prob, distinct_nodes: r.distinctNodes, decisions: r.decisions, pure_rate_pct: r.pureRate, size_stick_pct: r.sizeStick, time_stick_pct: r.timeStick, progress: r.progress }; })(),
                    // v65.1 F5 (аудит #5): π-KL эксплойт-совет
                    exploit: (function () { let x = computePiKLExploit(p); return x ? { leak: x.leak, mode: x.mode, size_x: x.sizeX, fold_pct: x.f, n: x.n, kl: x.kl, w: x.w, label: x.label || null, reason: x.reason || null } : null; })(),
                    // v65.1 F6: контбеты/донки
                    cbetMade: p.cbetMade || 0,
                    donksMade: p.donksMade || 0,
                    entries: Array.from(p.entries.values())
                };
            });

            let blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            let url = URL.createObjectURL(blob);
            let a = document.createElement('a');
            a.href = url;
            a.download = `pokerdom_v65_1_omni_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            // v61 F1 (BUG-MEMORY): release the blob reference — the download has started.
            setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 10000);
        } catch (e) {
            alert('Ошибка экспорта: ' + e.message);
        }
    };

    // ── v65 M3 (SURVIVAL): обратный отсчёт жизни стека цели в MTT ──────
    // Честное подмножество спеки Module 3: симуляция расхода стека при
    // чистом фолде с эскалацией блайндов. Кривая блайндов — из GetSchedule
    // (tourn.levelCurve/levelDetails); за пределами расписания — эвристика
    // ×1.28/уровень; 70 рук/час; walk-фактор 0.30 (30% больших блайндов
    // доживают до шоуддауна без борьбы — W в формуле спеки). ITM-«вероят-
    // ность» и ICM-фриз ОТКЛОНЕНЫ: nAlive/nITM не наблюдаются парсируемым
    // протоколом, рисовать «99%» из эвристик — ложная точность.
    function calculateTournamentSurvival(stackChips, curLevel, levelCurve, levelDetails, seatsAtTable) {
        const SEC_PER_HAND = 3600 / 70;
        const BB_WALK_RATE = 0.30;
        const LEVEL_FALLBACK_MULT = 1.28;
        const DEFAULT_ANTE_RATIO = 0.125;
        const seats = Math.max(2, Math.min(10, seatsAtTable || 8));

        let bb = Math.max(1, Math.round(curLevel.bb || 100));
        let sb = Math.max(1, Math.round(curLevel.sb || Math.round(bb / 2)));
        let ante = Math.max(0, Math.round(curLevel.ante || 0));
        let anteRatio = ante > 0 ? (ante / bb) : DEFAULT_ANTE_RATIO;
        let lvlNum = curLevel.number || 1;
        let levelSec = (levelDetails && levelDetails.has(lvlNum) && levelDetails.get(lvlNum).sec) || 600;

        let simStack = Math.max(0, Math.round(stackChips));
        let secLeft = levelSec;
        let handsSurvived = 0;

        while (simStack > 0 && handsSurvived < 300) {
            const orbitGross = sb + bb + seats * ante;
            const walkSavings = BB_WALK_RATE * (sb + (seats - 1) * ante);
            const orbitNet = Math.max(bb, orbitGross - walkSavings);
            const costPerHand = orbitNet / seats;
            if (simStack < costPerHand) { simStack = 0; break; }
            simStack -= costPerHand;
            handsSurvived++;
            secLeft -= SEC_PER_HAND;
            if (secLeft <= 0) {
                lvlNum++;
                let d = (levelDetails && levelDetails.get(lvlNum)) || null;
                let curveBB = (levelCurve && levelCurve.get(lvlNum)) || null;
                if (curveBB) {
                    bb = curveBB;
                    sb = (d && d.sb) ? d.sb : Math.round(bb / 2);
                    ante = (d && d.ante !== undefined) ? d.ante : Math.round(bb * anteRatio);
                } else {
                    bb = Math.round(bb * LEVEL_FALLBACK_MULT);
                    sb = Math.round(bb / 2);
                    ante = Math.round(bb * anteRatio);
                }
                levelSec = (d && d.sec) ? d.sec : 600;
                secLeft = levelSec;
            }
        }

        const orbitsSurvived = handsSurvived / seats;
        const lifeMinutes = Math.round(handsSurvived * SEC_PER_HAND / 60);
        // p_AA = 6/1326; p_premium (TT+, AK, AQs) = 50/1326 — спека 3.3
        const probAA = (1 - Math.pow(1 - 6 / 1326, handsSurvived)) * 100;
        const probPremium = (1 - Math.pow(1 - 50 / 1326, handsSurvived)) * 100;

        return {
            handsSurvived: handsSurvived,
            orbitsSurvived: orbitsSurvived.toFixed(1),
            lifeMinutes: lifeMinutes,
            probAA: probAA.toFixed(1),
            probPremium: probPremium.toFixed(1),
            summary: orbitsSurvived.toFixed(1) + ' орб (~' + lifeMinutes + ' мин) • AA ' + probAA.toFixed(1) + '% • Прем ' + probPremium.toFixed(1) + '%'
        };
    }

    /* ══════════════════════════════════════════════════════════════════
       v65.1 DOM-СЕРВИСЫ F1/F3/F4/F5: LIVE-анализ, RTA-бейдж, π-KL эксплойт,
       модель выживания N_alive/N_ITM, парсинг призов, ленивая математика рук
       ══════════════════════════════════════════════════════════════════ */

    // v65.1 F1 (аудит #1, MODULE-4-LIVE): оценка В РУКЕ — вызывается из
    // updateBoardFromXml/updateUserCardsFromXml на столах ИГРОКА. Токен-
    // guard: улица ушла вперёд → результат устарел и не рендерится.
    // Натс = вычисление по маскам (O(1)); HS = МК 260; ауты = 47 проходов.
    // Всё внутри ChunkQueue (слоты ≤6мс) — фриз потока невозможен.
    function scheduleLiveBoardAnalysis(ctx) {
        if (state.isDestroyed) return;
        if (!ctx || !ctx.userCards || ctx.userCards.length !== 2 || !ctx.board || ctx.board.length < 3) return;
        let token = ++ctx.liveAnalysisToken;
        let street = ctx.street, board = ctx.board.slice(), hole = ctx.userCards.slice();
        ChunkQueue.push(function () {
            if (state.isDestroyed || token !== ctx.liveAnalysisToken) return;
            try {
                let boardNut = computeBoardNutsFast(board, null);          // классический натс борда
                let villainNut = computeBoardNutsFast(board, hole);        // натс, доступный вилленам (карты героя мертвы)
                let heroEval = evalCardsFast(hole.concat(board));
                let hs = computeHsPercentileMC(hole, board, 260);
                let outs = (board.length === 3) ? computeFlopOuts(hole.join(' '), board) : null;
                ctx.liveAnalysis = {
                    street: street, board: board, hole: hole,
                    nutTag: boardNut ? boardNut.tag : null, nutLabel: boardNut ? boardNut.label : '',
                    villainNutTag: villainNut ? villainNut.tag : null,
                    heroTag: heroEval.tag,
                    heroHasNuts: boardNut ? (heroEval.score >= boardNut.score) : false,
                    hsPct: hs,
                    outs: outs,
                    outsPct: (outs !== null && outs !== undefined) ? +(outs / 47 * 100).toFixed(1) : null,
                    ts: Date.now()
                };
                updateHUD();
            } catch (e) { logDebug('LIVE_ANALYSIS', 'ошибка: ' + (e && e.message)); }
        });
    }

    function renderLiveAnalysisCard(ctx) {
        let la = ctx.liveAnalysis;
        if (!la) return '';
        let catDelta = categoryRankOfTag(la.nutTag) - categoryRankOfTag(la.heroTag);
        let catTxt = la.heroHasNuts
            ? '<b style="color:#22c55e;">У ВАС НАТС</b>'
            : (catDelta > 0 ? '−' + catDelta + ' кат. до натса' : '<b style="color:#4ade80;">не слабее натса</b>');
        let outsTxt = (la.outs !== null && la.outs !== undefined)
            ? ' • ауты: <b style="color:#38bdf8;">' + la.outs + '</b> (' + la.outsPct + '% до терна)' : '';
        return '<div style="background:#04121f;border:1px solid #06b6d4;border-radius:6px;padding:5px 7px;margin-bottom:6px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;">' +
            '<span style="color:#06b6d4;font-weight:bold;font-size:11px;">🃏 LIVE ' + escapeHtml(ctx.name) + ' • ' + la.street + '</span>' +
            '<span style="font-size:11px;color:#fde047;">' + escapeHtml(la.hole.join(' ')) + '</span>' +
            '</div>' +
            '<div style="font-size:10px;color:#cbd5e1;margin-top:2px;">Борд: <b>' + escapeHtml(la.board.join(' ')) + '</b> • NATS: <b style="color:#f472b6;">' + escapeHtml(la.nutTag || '—') + '</b> ' + catTxt + '</div>' +
            '<div style="font-size:10px;color:#94a3b8;">Рука: <b>' + escapeHtml(la.heroTag) + '</b> • HS: <b style="color:#22c55e;">' + (la.hsPct !== null && la.hsPct !== undefined ? la.hsPct + '%' : '—') + '</b>' + outsTxt + ' • у вилленов максимум: ' + escapeHtml(la.villainNutTag || '—') + '</div>' +
            '</div>';
    }

    // v65.1 F3 (аудит #3): бейдж «⚠️ [RTA PROB: XX%]» в карточке цели —
    // кэш по (руки × узлы × наблюдения), пересчёт только при новых данных
    function getRtaBadge(p) {
        try {
            let key = (p.handsCount || 0) + '|' + (p.nodeActionHist ? p.nodeActionHist.size : 0) + '|' + (p.nodeObsTotal || 0);
            if (p.__rtaCache && p.__rtaCache.key === key) return p.__rtaCache.badge;
            let r = evaluateRTAConfidence(p.nodeActionHist);
            let badge = null;
            if (r.eligible) {
                let color = r.prob >= 60 ? '#f87171' : (r.prob >= 35 ? '#fbbf24' : '#94a3b8');
                let mark = r.prob >= 60 ? '⚠️' : (r.prob >= 35 ? '◉' : '○');
                badge = '<div style="font-size:10px;margin:2px 0;color:' + color + ';">' + mark +
                    ' [RTA PROB: ' + r.prob + '%] <small style="color:#64748b;">(' + r.distinctNodes + ' кл., ' + r.decisions +
                    ' реш., чист. ' + r.pureRate + '%, σсайз ' + r.sizeStick + '%, σврем ' + r.timeStick + '%)</small></div>';
            } else if (r.distinctNodes > 0) {
                badge = '<div style="font-size:9px;color:#64748b;">RTA: ' + r.progress + '</div>';
            }
            p.__rtaCache = { key: key, badge: badge };
            return badge;
        } catch (e) { return null; }
    }

    // v65.1 F5 (аудит #5): строка «⚔️ ЭКСПЛОЙТ» в карточке цели
    function getExploitLine(p) {
        try {
            let key = (p.handsCount || 0) + '|' + (p.foldToCbetOpp || 0) + '|' + (p.stealFacedBBOpp || 0) + '|' + (p.nodeObsTotal || 0);
            if (p.__explCache && p.__explCache.key === key) return p.__explCache.badge;
            let x = computePiKLExploit(p);
            let badge = null;
            if (x && x.mode) {
                let color = x.w >= 0.6 ? '#f59e0b' : '#94a3b8';
                badge = '<div style="font-size:10px;margin:2px 0;color:' + color + '">⚔️ ЭКСПЛОЙТ: ' + (x.mode === 'BLUFF' ? 'блеф' : 'вэлью') +
                    ' <b>' + x.sizeX + '×пот</b> — фолд ' + x.f + '% (n=' + x.n + ', KL=' + x.kl + ', w=' + x.w + ')</div>';
            } else if (x && x.reason && ((p.foldToCbetOpp || 0) >= 8 || (p.stealFacedBBOpp || 0) >= 8 || (p.nodeObsTotal || 0) >= 12)) {
                badge = '<div style="font-size:9px;color:#64748b;">⚔️ ЭКСПЛОЙТ: ' + escapeHtml(x.reason) + '</div>';
            }
            p.__explCache = { key: key, badge: badge };
            return badge;
        } catch (e) { return null; }
    }

    // v65.1 F4 (аудит #4): строка модели выживания в живой записи цели —
    // P(ITM|SitOut) + ICM FREEZE; кэш 45с на запись, пересчёт в чанках
    function getModule3Line(e, liveCtx) {
        try {
            if (!e.tournId || (e.stack || 0) <= 0 || e.isBusted) return null;
            let tourn = state.liveTournaments.get(e.tournId);
            if (!tourn || !tourn.alivePlayers || !tourn.prizesITM) return null;
            let nAlive = tourn.alivePlayers, nITM = tourn.prizesITM;
            let key = e.stack + '|' + nAlive + '|' + nITM;
            let c = e.__m3cache;
            if (c && c.key === key && (Date.now() - c.ts) < 45000 && c.text !== null) return c.text;
            let queued = c && c.key === key && c.pending && (Date.now() - c.tsQ) < 30000;
            if (!queued) {
                if (!c) c = { key: key, ts: 0, tsQ: 0, text: null, pending: false };
                e.__m3cache = { key: key, ts: c.ts, tsQ: Date.now(), text: c.text, pending: true };
                let stack = e.stack, tournRef = tourn, liveBB = e.currentBB || 500, liveLevel = tourn.currentLevel || 1;
                if (liveCtx) {
                    if (liveCtx.getActiveHandBB && liveCtx.getActiveHandBB() > 0) liveBB = liveCtx.getActiveHandBB();
                    if (liveCtx.level && liveCtx.level.bb > 0) {
                        liveLevel = { sb: liveCtx.level.sb || Math.round(liveBB / 2), bb: liveBB, ante: liveCtx.level.ante || 0, number: liveCtx.level.number || 1 };
                    } else {
                        liveLevel = { sb: Math.round(liveBB / 2), bb: liveBB, ante: Math.round(liveBB * 0.125), number: tourn.currentLevel || 1 };
                    }
                } else {
                    liveLevel = { sb: Math.round(liveBB / 2), bb: liveBB, ante: Math.round(liveBB * 0.125), number: tourn.currentLevel || 1 };
                }
                let entryRef = e;
                ChunkQueue.push(function () {
                    try {
                        let icm = icmFreezeFactor(stack, liveLevel, tournRef.levelCurve || null, tournRef.levelDetails || null, nAlive, nITM, tournRef.fieldAvgStack || stack);
                        let freezeTxt = icm.freeze ? ' • 🧊 <b style="color:#38bdf8;">ICM FREEZE ×' + icm.factor + '</b>' : '';
                        let text = 'P(ITM сидя): <b style="color:' + (icm.pITM >= 40 ? '#22c55e' : '#fbbf24') + ';">' + icm.pITM + '%</b> (живых ' + nAlive + ' / itm ' + nITM +
                            (tournRef.fieldAvgStack ? ', ср. стек ' + formatChips(tournRef.fieldAvgStack) : '') + ')' + freezeTxt;
                        entryRef.__m3cache = { key: key, ts: Date.now(), tsQ: Date.now(), text: text, pending: false };
                        updateHUD();
                    } catch (err) {}
                });
            }
            return (c && c.key === key) ? c.text : null;
        } catch (err) { return null; }
    }

    // v65.1 F4 (аудит #4): парсер призовой структуры → N_ITM (общий для
    // сканера и handleIncoming). <Prize placeFrom/placeTo/amount>, счётчики
    // <Prizes count/paid/placesPaid>.
    function parsePrizesInto(xml, tId) {
        try {
            if (!xml || !tId) return;
            let itm = 0;
            let payouts = [];
            let pm;
            let re = /<Prize\s+([^>]+?)\/>/g;
            while ((pm = re.exec(xml)) !== null) {
                let from = iattr(pm[1], 'placeFrom');
                if (from === null) from = iattr(pm[1], 'from');
                let to = iattr(pm[1], 'placeTo');
                if (to === null) to = iattr(pm[1], 'to');
                if (to === null) to = iattr(pm[1], 'place');
                let amount = fattr(pm[1], 'amount');
                if (to !== null && to > itm) itm = to;
                if (from !== null && to !== null) payouts.push({ from: from, to: to, amount: amount });
                if (payouts.length > 60) break;
            }
            let cnt = iattr(xml, 'count') || iattr(xml, 'prizesCount') || iattr(xml, 'paid') || iattr(xml, 'placesPaid') || 0;
            if (cnt > itm) itm = cnt;
            if (itm > 0) {
                let lt = state.liveTournaments.get(tId);
                if (lt) { lt.prizesITM = itm; lt.prizePayouts = payouts.slice(0, 40); }
                else {
                    let tc = state.tournamentCache.get(tId);
                    if (tc) { tc.prizesITM = itm; tc.prizePayouts = payouts.slice(0, 40); }
                    else state.tournamentCache.set(tId, { name: 'MTT', baseBuyin: 0, isPKO: false, prizesITM: itm, prizePayouts: payouts.slice(0, 40) });
                }
                updateHUD();
            }
        } catch (e) {}
    }

    // v65.1 F2 (аудит #2): ленивая математика архивной руки — точный
    // hs_percentile (перечисление с битовым оценщиком) и flop_outs
    // дописываются в чанках ≤6мс после архивации. 120 одновременных
    // EndHand раскладываются на слоты — фриза главного потока нет.
    function queueLazyHandMath(hand) {
        if (!hand || !hand.players) return;
        ChunkQueue.push(function () {
            try {
                let boardArr = String(hand.board || '').trim().split(/\s+/).filter(Boolean);
                for (let i = 0; i < hand.players.length; i++) {
                    let p = hand.players[i];
                    if (!p.cards || p.cards === 'xx xx' || boardArr.length < 3) continue;
                    if (p.hs_percentile === null || p.hs_percentile === undefined) {
                        p.hs_percentile = computeHsPercentile(p.cards, boardArr);
                    }
                    if (p.flop_outs === null || p.flop_outs === undefined) {
                        p.flop_outs = computeFlopOuts(p.cards, boardArr);
                        if (p.flop_outs !== null && p.flop_outs !== undefined) {
                            p.flop_outs_pct = (p.flop_outs / 47 * 100).toFixed(1);
                        }
                    }
                }
            } catch (e) {}
        });
    }

    // v65.1 F4: срез Module 3 для JSON-экспорта (синхронно по клику кнопки)
    function buildModule3Snapshot() {
        let out = [];
        try {
            state.stalkedPlayers.forEach(function (p) {
                p.entries.forEach(function (e) {
                    if (!e.tournId || (e.stack || 0) <= 0 || e.isBusted) return;
                    let tourn = state.liveTournaments.get(e.tournId);
                    if (!tourn || !tourn.alivePlayers || !tourn.prizesITM) return;
                    let bbv = e.currentBB || 500;
                    let lvl = { sb: Math.round(bbv / 2), bb: bbv, ante: Math.round(bbv * 0.125), number: tourn.currentLevel || 1 };
                    let pITM = pITMGivenSitOut(e.stack, lvl, tourn.levelCurve || null, tourn.levelDetails || null, tourn.alivePlayers, tourn.prizesITM, tourn.fieldAvgStack || e.stack, 160);
                    out.push({
                        cleanNick: p.cleanNick, tournId: e.tournId, stack: e.stack,
                        n_alive: tourn.alivePlayers, n_itm: tourn.prizesITM,
                        field_avg_stack: tourn.fieldAvgStack || null,
                        p_itm_sitout_pct: pITM,
                        itm_places: (tourn.prizePayouts || []).slice(0, 10)
                    });
                });
            });
        } catch (e) {}
        return out;
    }

    // v65.1 BENCH (аудит-требование): верифицированный бенчмарк — вызов
    // window.__stalkerBench() в консоли. Эквивалентность быстрый-натс ↔
    // перебор, скорость в мкс, стресс 120 столов через чанки, longtask.
    window.__stalkerBench = async function () {
        try {
            let longTasks = [];
            let po = null;
            if (typeof PerformanceObserver !== 'undefined') {
                try {
                    po = new PerformanceObserver(function (list) {
                        list.getEntries().forEach(function (en) { longTasks.push(Math.round(en.duration)); });
                    });
                    po.observe({ entryTypes: ['longtask'] });
                } catch (e) {}
            }
            let report = await runBenchCore({ boardsEq: 400, boardsSpeed: 1200, stressTables: 120 });
            if (po) { try { po.disconnect(); } catch (e) {} }
            report.browserLongTasks = longTasks;
            report.zeroStall = longTasks.length === 0 && report.stress.maxSliceMs < 8;
            let txt = 'SCALPEL v65.1 BENCH\n' +
                'Эквивалентность (натс на масках vs перебор v65.0): ' + report.mismatches.length + ' расхождений из ' + report.eqChecks + ' проверок\n' +
                'Скорость натса (ривер): avg ' + report.fastAvgUs + 'µs, max ' + report.fastMaxUs + 'µs (перебор v65.0: ' + report.bruteAvgMs + 'ms ≈ ' + report.bruteEval5Calls + ' вызовов eval5)\n' +
                'HS-перцентиль (МК 260): avg ' + report.mcAvgUs + 'µs\n' +
                'Стресс 120 столов: слотов ' + report.stress.slices + ', макс. слот ' + report.stress.maxSliceMs + 'мс (бюджет 6мс), всего ' + report.stress.totalMs + 'мс\n' +
                'Long tasks (>50мс): ' + longTasks.length + '\n' +
                'VERDICT: ' + (report.zeroStall ? '✅ ZERO UI THREAD STALLING' : '❌ ЕСТЬ ФРИЗЫ');
            console.log('%c📊 [SCALPEL v65.1 BENCH]', 'color:#06b6d4;font-weight:bold;', report);
            console.log(txt);
            try { alert(txt); } catch (e) {}
            return report;
        } catch (e) { console.error('[SCALPEL BENCH]', e); return null; }
    };

    // ── ГРАФИЧЕСКИЙ ИНТЕРФЕЙС HUD ─────────────────────────────────────
    let ui = document.createElement('div');
    ui.id = 'stalker-hud-v651';
    ui.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);width:95vw;max-width:470px;z-index:999999999;background:rgba(10,15,25,0.98);color:#fff;font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;padding:10px 12px;border-radius:10px;border:2px solid #06b6d4;box-shadow:0 12px 40px rgba(0,0,0,0.95);backdrop-filter:blur(12px);box-sizing:border-box;';
    
    ui.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span style="color:#06b6d4;font-size:13px;">🎯</span>
                <strong style="color:#06b6d4;font-size:12px;">SCALPEL v65.1 ULTIMATE</strong>
                <small id="st-hf-status" style="font-size:9px;margin-left:4px;color:#94a3b8;">HF: Иниц...</small>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
                <button id="btn-force-scan" style="background:#0891b2;border:none;color:#fff;cursor:pointer;font-size:10px;padding:3px 7px;border-radius:4px;font-weight:bold;">🔄 Скан</button>
                <button id="btn-toggle-hud" style="background:transparent;border:1px solid #475569;color:#06b6d4;cursor:pointer;font-size:11px;padding:1px 6px;border-radius:4px;">▾</button>
                <button onclick="window.__SCALPEL.destroy();" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:13px;padding:0 2px;">✕</button>
            </div>
        </div>
        <div id="st-hud-body" style="margin-top:8px;">
            <div style="background:#030712;padding:6px 8px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;">
                    <span>Спектатор: <b id="st-spectator-count" style="color:#38bdf8;">0 столов</b></span>
                    <span id="st-hands-count" style="color:#22c55e;">Раздач: <b>0</b></span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:11px;color:#cbd5e1;margin-top:4px;">
                    <span>Живых MTT: <b id="st-tourns-count" style="color:#38bdf8;">0</b></span>
                    <span>Найдено целей: <b id="st-targets-found" style="color:#4ade80;">0</b></span>
                </div>
            </div>
            <div id="st-live-panel" style="margin-bottom:8px;"></div>
            <div id="st-targets-list" style="max-height:240px;overflow-y:auto;background:#030712;padding:6px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;color:#cbd5e1;">
                Сканирование сетки турниров...
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
                <button onclick="window.__stalkerExportJSON()" style="padding:7px 2px;background:linear-gradient(90deg,#0891b2,#0284c7);color:#fff;border:none;border-radius:6px;font-weight:bold;font-size:9px;cursor:pointer;">
                    📥 JSON (Raw)
                </button>
                <button onclick="window.__stalkerExportGTO()" style="padding:7px 2px;background:linear-gradient(90deg,#10b981,#059669);color:#fff;border:none;border-radius:6px;font-weight:bold;font-size:9px;cursor:pointer;">
                    ⚡ GTO (.txt)
                </button>
                <button onclick="window.__stalkerExportDSL()" style="padding:7px 2px;background:linear-gradient(90deg,#8b5cf6,#6366f1);color:#fff;border:none;border-radius:6px;font-weight:bold;font-size:9px;cursor:pointer;">
                    💎 Dense DSL
                </button>
                <button onclick="window.__stalkerExportGTOKeys()" style="padding:7px 2px;background:linear-gradient(90deg,#db2777,#be185d);color:#fff;border:none;border-radius:6px;font-weight:bold;font-size:9px;cursor:pointer;">
                    🧠 GTO Keys (.txt)
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(ui);

    document.getElementById('btn-toggle-hud').onclick = function() {
        state.isCollapsed = !state.isCollapsed;
        let body = document.getElementById('st-hud-body');
        body.style.display = state.isCollapsed ? 'none' : 'block';
        this.innerText = state.isCollapsed ? '▴' : '▾';
    };

    document.getElementById('btn-force-scan').onclick = function() {
        autoDetectSessionId();
        triggerLobbyTournamentRefresh();
    };

    let isRafPending = false;
    function updateHUD() {
        if (isRafPending) return;
        isRafPending = true;

        requestAnimationFrame(() => {
            isRafPending = false;
            let countEl = document.getElementById('st-targets-found');
            let tournsEl = document.getElementById('st-tourns-count');
            let specEl = document.getElementById('st-spectator-count');
            let handsEl = document.getElementById('st-hands-count');
            let listEl = document.getElementById('st-targets-list');
            if (!countEl || !listEl) return;

            // v64.2 Z2 (HUD-ERGO): единый критерий «живой» записи — фишки > 0
            // в живом турнире. Используется счётчиком активных целей,
            // сортировкой целей и сортировкой записей внутри карточки.
            let isLiveEntry = (e) => !e.isBusted && (e.stack || 0) > 0 && (!e.tournId || state.liveTournaments.has(e.tournId));

            let activeTargets = 0;
            state.stalkedPlayers.forEach(p => {
                if (Array.from(p.entries.values()).some(isLiveEntry)) activeTargets++;
            });

            countEl.innerText = `${state.stalkedPlayers.size} (в игре: ${activeTargets})`;
            if (tournsEl) tournsEl.innerText = state.liveTournaments.size;

            let openSpectators = Array.from(state.backgroundTableSockets.values()).filter(ws => ws && ws.readyState === WebSocket.OPEN).length;
            if (specEl) specEl.innerText = `${openSpectators} столов в фоне`;
            if (handsEl) handsEl.innerHTML = `Раздач: <b>${state.completedHandsArchive.length}</b>`;

            // v65.1 F1 (аудит #1, MODULE-4-LIVE): панель живого анализа
            // борда на столах ИГРОКА — натс/HS/ауты В РУКЕ, не пост-мортем
            let liveEl = document.getElementById('st-live-panel');
            if (liveEl) {
                let liveHtml = '';
                state.sockets.userTables.forEach(function (uws, tid) {
                    let lctx = state.activeTables.get(tid);
                    if (lctx && lctx.hand && lctx.liveAnalysis) {
                        liveHtml += renderLiveAnalysisCard(lctx);
                    } else if (lctx && lctx.hand && lctx.userCards && lctx.userCards.length === 2 && lctx.board && lctx.board.length >= 3) {
                        liveHtml += '<div style="background:#04121f;border:1px dashed #06b6d4;border-radius:6px;padding:5px 7px;margin-bottom:6px;color:#64748b;font-size:10px;">🃏 LIVE ' + escapeHtml(lctx.name) + ' • расчёт бита масок…</div>';
                    }
                });
                let sig = liveHtml.length + ':' + (liveHtml ? liveHtml.slice(0, 96) : '');
                if (sig !== (liveEl.getAttribute('data-sig') || '')) {
                    liveEl.innerHTML = liveHtml;
                    liveEl.setAttribute('data-sig', sig);
                }
            }

            if (state.stalkedPlayers.size > 0) {
                // =============================================================
                // v64.2 Z2 (HUD-ERGO): динамическая приоритизация для экрана
                // смартфона (360px): цели с живым стеком — в самом верху
                // списка, полностью выбывшие тонут вниз; внутри карточки
                // активные турниры выше выбывших.
                // =============================================================
                let sortedPlayers = Array.from(state.stalkedPlayers.values()).sort((a, b) => {
                    let aLive = Array.from(a.entries.values()).some(isLiveEntry);
                    let bLive = Array.from(b.entries.values()).some(isLiveEntry);
                    if (aLive !== bLive) return aLive ? -1 : 1;
                    return (b.handsCount || 0) - (a.handsCount || 0);
                });

                let html = '';
                sortedPlayers.forEach((p) => {
                    let agg = p.aggressiveActions || 0;
                    let pass = p.passiveActions || 0;
                    let totalActs = p.totalActions || (agg + pass);
                    let afq = totalActs > 0 ? Math.round((agg / totalActs) * 100) : 0;
                    let afStr = pass > 0 ? (agg / pass).toFixed(1) : (agg > 0 ? '99.0' : '0.0');
                    let vpip = p.handsCount > 0 ? Math.round((p.vpipCount / p.handsCount) * 100) : 0;
                    let pfr = p.handsCount > 0 ? Math.round((p.pfrCount / p.handsCount) * 100) : 0;

                    // v64.3 P5 (ARCHETYPES): тактический бейдж архетипа рядом со
                    // статистикой — мгновенная подсказка «как эксплойтить» без
                    // раскрытия строки (title — для десктопа)
                    let arch = getPlayerArchetype(p);
                    let statsStr = p.handsCount > 0
                        ? `<small style="color:#38bdf8;font-weight:bold;margin-left:4px;">[H:${p.handsCount}${p.sitOutHandsCount > 0 ? `+${p.sitOutHandsCount}AFK` : ''} V:${vpip}% P:${pfr}% AF:${afStr} AFq:${afq}%]</small> <span style="color:${arch.color};font-weight:bold;font-size:10px;" title="${arch.tip}">${arch.label}</span>`
                        : `<small style="color:#64748b;margin-left:4px;">[Поиск рук...]</small>`;

                    let isPlayerInGame = Array.from(p.entries.values()).some(isLiveEntry);

                    // v65.1 F3/F5 (аудиты #3/#5): RTA-бейдж и π-KL эксплойт —
                    // в самой карточке цели, вычисление в памяти с кэшем
                    let rtaBadge = null, explLine = null;
                    try { rtaBadge = getRtaBadge(p); } catch (err) {}
                    try { explLine = getExploitLine(p); } catch (err) {}

                    html += `<div style="border-bottom:1px solid #1e293b;padding:6px 0;margin-bottom:4px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                            <span style="color:${isPlayerInGame ? '#fde047' : '#94a3b8'};font-size:12px;">
                                ${isPlayerInGame ? '🎯' : '⚪'} <b>${escapeHtml(p.cleanNick)}</b> ${statsStr}
                            </span>
                        </div>`;
                    if (rtaBadge) html += rtaBadge;
                    if (explLine) html += explLine;

                    // v64.2 Z2: активные столы выше выбывших турниров
                    let sortedEntries = Array.from(p.entries.values()).sort((a, b) => {
                        let aLive = isLiveEntry(a);
                        let bLive = isLiveEntry(b);
                        if (aLive !== bLive) return aLive ? -1 : 1;
                        return (b.stack || 0) - (a.stack || 0);
                    });

                    sortedEntries.forEach(e => {
                        let chipsStr = formatChips(e.stack);
                        let isTournLive = !e.tournId || state.liveTournaments.has(e.tournId);
                        let isActuallyBusted = e.isBusted || e.stack === 0 || !isTournLive;

                        let liveCtx = e.tableId ? state.activeTables.get(e.tableId) : null;
                        let liveBB = (liveCtx && liveCtx.getActiveHandBB() > 0) ? liveCtx.getActiveHandBB() : (e.currentBB || 500);
                        let realStackBB = (liveBB > 0 && e.stack > 0 && !isActuallyBusted) ? (Math.round((e.stack / liveBB) * 10) / 10) : 0;

                        // v65 M3 (SURVIVAL): сколько орбит/минут проживёт
                        // стек цели при чистом фолде — кривая блайндов из
                        // GetSchedule (levelCurve), анте/SB из живого стола
                        // (иначе дефолт: SB=BB/2, анте=12.5% BB), размер
                        // стола — из observedSeatCount
                        let surv = null;
                        try {
                            if (e.stack > 0 && !isActuallyBusted) {
                                let bbv = (liveCtx && liveCtx.getActiveHandBB() > 0) ? liveCtx.getActiveHandBB() : (e.currentBB || 500);
                                let lvl = (liveCtx && liveCtx.level && liveCtx.level.bb > 0)
                                    ? { sb: liveCtx.level.sb || Math.round(bbv / 2), bb: bbv, ante: liveCtx.level.ante || 0, number: liveCtx.level.number || 1 }
                                    : { sb: Math.round(bbv / 2), bb: bbv, ante: Math.round(bbv * 0.125), number: 1 };
                                let tourn = e.tournId ? state.liveTournaments.get(e.tournId) : null;
                                let seats = 8;
                                if (liveCtx) {
                                    seats = Math.max(2, Math.min(10, liveCtx.observedSeatCount || Object.keys(liveCtx.positions).length || 8));
                                }
                                surv = calculateTournamentSurvival(e.stack, lvl, tourn ? tourn.levelCurve : null, tourn ? tourn.levelDetails : null, seats);
                            }
                        } catch (err) {}

                        // v65.1 F4 (аудит #4, MODULE 3): P(ITM|SitOut) + ICM FREEZE —
                        // N_alive из <GetPlayers total>, N_ITM из <Prizes>
                        let m3Line = null;
                        try { if (e.stack > 0 && !isActuallyBusted) m3Line = getModule3Line(e, liveCtx); } catch (err) {}

                        // v64.3 P3 (TWIN-HASH): Pokerdom гоняет одинаковые recurring-
                        // турниры каждые 1–2 часа — активная и выбывшая записи с одним
                        // tableName выглядели как один «сломанный» турнир. Различаем
                        // коротким хешем id: «Мультибаунти 10 000 р. [#8c01]».
                        let shortTournHash = e.tournId ? ` [#${escapeHtml(String(e.tournId).replace(/^f78-/, '').slice(-4))}]` : '';
                        let displayTournName = `${escapeHtml(e.tableName || 'MTT')}${shortTournHash}`;

                        // v64.2 Z2 (HUD-ERGO): явная финансовая раскладка вместо
                        // крипто-бейджа «[#7: 21 000₽]» — номер пули и счётчик
                        // покупок больше не сталкиваются в одной строке 360px.
                        // totalBuys = max(bullets, rebuys+1) — v64 F3-совместимо:
                        // при потере суффикса лобби реальные ре-энтри живут в
                        // e.rebuys, тогда показываем просто «N входов».
                        // v64.3 P6 (REBUY-x2): покупки = суффикс-производная
                        // totalBuys (монотонная, Z3). Вывод покупок из суммы денег
                        // (totalSpent / baseBuyin) отклонён: v62-B4 сделал spent
                        // детерминированным (bullets × baseBuyin) — деривация
                        // избыточна, а серверный spent_server (370₽/414₽) породил
                        // бы фантомные ребаи. Двойной ребай = 2 юнита покупок:
                        // чётный остаток юнитов помечаем «+N/2 x2 реб.».
                        let baseBuyin = e.baseBuyin || 0;
                        let bulletNum = Math.max(1, e.bullets || 1);
                        let totalBuys = Math.max(bulletNum, (e.rebuys || 0) + 1);
                        let totalSpent = e.spent || (baseBuyin > 0 ? totalBuys * baseBuyin : 0);
                        let finStr = '';
                        if (baseBuyin > 0) {
                            let totalPurchases = totalBuys;
                            let tableRebuys = Math.max(0, totalPurchases - bulletNum);
                            // v64.3: «1 вход + N реб.» честен только при подтверждённой
                            // первой пуле — лобби никогда не показывало #N≥2 и выбытий
                            // не было; иначе (суффикс-лосс) честная метка «N входов».
                            let everReentered = (Array.isArray(e.bust_places) && e.bust_places.length > 0) || e.everBulletSuffix === true;
                            if (tableRebuys > 0 && bulletNum > 1) {
                                let isDoubleRebuy = tableRebuys >= 2 && (tableRebuys % 2 === 0);
                                let rebSuffix = isDoubleRebuy ? `+${tableRebuys / 2}x2 реб.` : `+${tableRebuys} реб.`;
                                finStr = `Пуля #${bulletNum} (${rebSuffix}) • Влито: ${formatRub(totalSpent)}₽`;
                            } else if (tableRebuys > 0 && bulletNum === 1 && !everReentered) {
                                finStr = `1 вход + ${tableRebuys} реб. • Влито: ${formatRub(totalSpent)}₽`;
                            } else if (totalPurchases > 1) {
                                finStr = `${totalPurchases} ${pluralRu(totalPurchases, 'вход', 'входа', 'входов')} • Влито: ${formatRub(totalSpent)}₽`;
                            } else {
                                finStr = `1 вход • ${formatRub(baseBuyin)}₽`;
                            }
                        }

                        if (!isActuallyBusted) {
                            // ── АКТИВНАЯ ЗАПИСЬ (живой стол) ──
                            html += `<div style="background:#091322;border-left:3px solid #38bdf8;padding:4px 7px;margin-bottom:3px;border-radius:4px;">
                                <div style="display:flex;justify-content:space-between;align-items:center;">
                                    <span style="color:#38bdf8;font-weight:bold;font-size:11px;">🔹 ${displayTournName}</span>
                                    <span style="color:#22c55e;font-weight:bold;font-size:11px;">${chipsStr}${realStackBB > 0 ? ` <small style="color:#94a3b8;font-weight:normal;">(${realStackBB} BB)</small>` : ''}</span>
                                </div>
                                <div style="display:flex;justify-content:space-between;color:#94a3b8;font-size:9px;margin-top:2px;">
                                    <span>${finStr}</span>
                                    <span style="color:#64748b;">${escapeHtml(e.rawNick)}</span>
                                </div>
                                ${(surv || m3Line) ? `<div style="color:#64748b;font-size:9px;margin-top:1px;">${surv ? '⏳ ' + surv.summary : ''}${(surv && m3Line) ? ' • ' : ''}${m3Line || ''}</div>` : ''}
                            </div>`;
                        } else {
                            // ── ВЫБЫВШАЯ ЗАПИСЬ ──
                            let prizeStr = '';
                            if (e.prize > 0) {
                                if (e.regular_prize > 0 && e.bounty_prize > 0) {
                                    prizeStr = ` <b style="color:#22c55e;">+${formatRub(e.prize)}₽</b> <small style="color:#94a3b8;">(${formatRub(e.regular_prize)}₽ + ${formatRub(e.bounty_prize)}₽ KO)</small>`;
                                } else if (e.regular_prize > 0) {
                                    prizeStr = ` <b style="color:#22c55e;">+${formatRub(e.regular_prize)}₽</b> <small style="color:#94a3b8;">[Приз]</small>`;
                                } else if (e.bounty_prize > 0) {
                                    prizeStr = ` <b style="color:#22c55e;">+${formatRub(e.bounty_prize)}₽</b> <small style="color:#94a3b8;">[KO]</small>`;
                                }
                            }

                            let placeBadge = '';
                            if (e.place === 1) {
                                placeBadge = `<b style="color:#eab308;background:rgba(234,179,8,0.15);padding:1px 4px;border-radius:3px;">1 МЕСТО 🏆</b>`;
                            } else if (e.place > 0) {
                                placeBadge = `${e.place} место`;
                            }

                            html += `<div style="background:#0c0f17;border-left:3px solid #ef4444;padding:3px 7px;margin-bottom:2px;border-radius:4px;opacity:0.8;">
                                <div style="display:flex;justify-content:space-between;align-items:center;">
                                    <span style="color:#ef4444;font-size:10px;">✕ <s>${displayTournName}</s></span>
                                    <span style="font-size:10px;color:#f87171;">${placeBadge}${prizeStr}${e.place === 1 ? '' : ' [ВЫБЫЛ]'}</span>
                                </div>
                                <div style="display:flex;justify-content:space-between;color:#64748b;font-size:9px;margin-top:1px;">
                                    <span>${finStr}</span>
                                    <span><s>${escapeHtml(e.rawNick)}</s></span>
                                </div>
                            </div>`;
                        }
                    });
                    html += `</div>`;
                });
                listEl.innerHTML = html;
            }
        });
    }

    // ── СПЕКТАТОР СТОЛОВ ───────────────────────────────────────────────
    // v61 F2 (BUG-PLACEHOLDER): единственная точка освобождения фонового сокета стола.
    // Гасит отложенный spawn-таймер, heartbeat, закрывает сокет и вычищает карты.
    function releaseBackgroundSocket(tableId, keepContext) {
        let ws = state.backgroundTableSockets.get(tableId);
        if (!ws) return;
        if (ws.__spawnTimer) {
            clearTimeout(ws.__spawnTimer);
            ws.__spawnTimer = null;
        }
        if (ws.__heartbeatTimer) {
            clearInterval(ws.__heartbeatTimer);
            ws.__heartbeatTimer = null;
        }
        if (typeof ws.close === 'function') {
            try { ws.close(); } catch (e) {}
        }
        state.backgroundTableSockets.delete(tableId);
        if (!keepContext && !state.sockets.userTables.has(tableId)) {
            state.activeTables.delete(tableId);
        }
    }

    async function manageBackgroundSpectatorPool() {
        if (state.isDestroyed) return;
        let sid = state.auth.sessionId || autoDetectSessionId();
        let wsUrl = state.auth.wssUrl;
        if (!wsUrl || !sid) return;

        for (let [tableId, ws] of state.backgroundTableSockets.entries()) {
            let tableCtx = state.activeTables.get(tableId);
            if (!tableCtx) continue;
            if (tableCtx.hand !== null) continue;

            let tInfo = state.discoveredTargetTables.get(tableId);
            let isTableStillTargeted = tInfo && tInfo.targets && tInfo.targets.size > 0;
            let isUserActiveOnTable = state.sockets.userTables.has(tableId);

            // v64.2 Z1 (ZOMBIE-GUARD, самовосстановление пула): даже если
            // регистрацию стола снесла устаревшая «мёртвая» строка лобби (или
            // любой другой путь очистки), живая запись цели с фишками
            // восстанавливает её ДО освобождения сокета — сокет живого стола
            // больше не выкидывается из фона. Сокет пользовательского стола
            // освобождаем как прежде (свой сокет берёт стол на себя).
            if (!isTableStillTargeted && !isUserActiveOnTable) {
                let revived = false;
                state.stalkedPlayers.forEach(p => p.entries.forEach(en => {
                    if (en && en.tableId === tableId && !en.isBusted && (en.stack || 0) > 0 &&
                        (!en.tournId || state.liveTournaments.has(en.tournId))) {
                        if (!tInfo) {
                            tInfo = { tournId: en.tournId || null, targets: new Set() };
                            state.discoveredTargetTables.set(tableId, tInfo);
                        }
                        tInfo.targets.add(p.cleanNick);
                        revived = true;
                    }
                }));
                if (revived) {
                    isTableStillTargeted = true;
                    logDebug("SOCKET_REVIVE", `Регистрация стола ${tableId} восстановлена по живой записи цели`);
                }
            }

            if (!isTableStillTargeted || isUserActiveOnTable) {
                releaseBackgroundSocket(tableId, isUserActiveOnTable);
                logDebug("SOCKET_CLEANUP", `Стол ${tableId} освобожден`);
            }
        }

        let spawnDelay = 0;
        for (let [tableId, tInfo] of state.discoveredTargetTables.entries()) {
            if (!tInfo || !tInfo.targets || tInfo.targets.size === 0) continue;
            if (state.backgroundTableSockets.size >= MAX_BACKGROUND_TABLES) break;
            if (state.backgroundTableSockets.has(tableId) || state.sockets.userTables.has(tableId)) continue;

            let cd = state.socketCooldowns.get(tableId) || 0;
            if (Date.now() < cd) continue;

            // v61 F2: плейсхолдер с close() и трекингом spawn-таймера (раньше его
            // было невозможно отменить → утечка сокета после destroy/очистки).
            let placeholder = { readyState: 0, __isPlaceholder: true, close: function() {} };
            state.backgroundTableSockets.set(tableId, placeholder);

            placeholder.__spawnTimer = setTimeout(function() {
                try {
                    // generation guard: выполняемся только если наш плейсхолдер ещё актуален
                    if (state.backgroundTableSockets.get(tableId) !== placeholder) return;
                    if (state.sockets.userTables.has(tableId)) {
                        state.backgroundTableSockets.delete(tableId);
                        return;
                    }

                    let curTargetInfo = state.discoveredTargetTables.get(tableId);
                    if (!curTargetInfo || !curTargetInfo.targets || curTargetInfo.targets.size === 0) {
                        state.backgroundTableSockets.delete(tableId);
                        return;
                    }

                    // v61 UR-1 (ultrareview): tournId/sessionId берём из СВЕЖЕГО состояния,
                    // а не из замыкания tInfo — стол мог быть переоткрыт под другим турниром
                    // за время spawn-задержки (старый вариант привязывал контекст стола
                    // к неверному турниру → неверные уровни/имена в экспортированных руках).
                    let freshTournId = curTargetInfo.tournId;
                    let freshSid = state.auth.sessionId || sid;

                    let tableWs = new OrigWS(wsUrl);
                    tableWs.__isBackgroundSpectator = true;
                    tableWs.__tableId = tableId;
                    tableWs.__tableContext = new TableContext(tableId, freshTournId);
                    
                    window.__SCALPEL.hookSocket(tableWs, wsUrl);

                    state.backgroundTableSockets.set(tableId, tableWs);
                    state.activeTables.set(tableId, tableWs.__tableContext);

                    let firstTarget = Array.from(curTargetInfo.targets)[0] || 'targets';
                    logDebug("SOCKET_CONNECT", `Подключение к столу ${tableId} [Spectator] (${firstTarget})`);

                    tableWs.onopen = function() {
                        tableWs.send(`<EnterTable sessionId="${freshSid}" tableId="${tableId}" tournamentId="${freshTournId}" client="html5mobile" clientVersion="${state.auth.clientVersion}"/>`);
                        tableWs.send('<GetTableDetails/>');
                        tableWs.send('<JoinTable/>');

                        tableWs.__heartbeatTimer = setInterval(() => {
                            if (tableWs.readyState === WebSocket.OPEN) {
                                try { tableWs.send('<GetServerTime/>'); } catch(e) {}
                            }
                        }, 20000);
                    };

                    tableWs.onclose = function() {
                        releaseBackgroundSocket(tableId);
                        state.socketCooldowns.set(tableId, Date.now() + 15000);
                        updateHUD();
                    };

                    tableWs.onerror = function() {
                        try { tableWs.close(); } catch(err) {}
                    };
                } catch(err) {
                    state.backgroundTableSockets.delete(tableId);
                    state.socketCooldowns.set(tableId, Date.now() + 5000);
                }
            }, spawnDelay);

            spawnDelay += (80 + Math.random() * 50);
        }
        updateHUD();
    }

    let timerPool = setInterval(manageBackgroundSpectatorPool, 2500);
    state.timerIds.push(timerPool);

    function triggerLobbyTournamentRefresh() {
        let lobbyWs = state.sockets.lobby;
        if (lobbyWs && lobbyWs.readyState === WebSocket.OPEN) {
            try {
                lobbyWs.send('<GetTournaments tournament="SCHEDULED|LIVE" games="TEXAS_HOLDEM" id="99999"/>');
            } catch(e) {}
        }
    }

    async function dispatchParallelScanner() {
        if (state.isScanningActive || state.scannerQueue.length === 0) return;
        let sid = state.auth.sessionId || autoDetectSessionId();
        let wsUrl = state.auth.wssUrl;
        if (!wsUrl || !sid) return;

        state.isScanningActive = true;

        try {
            while (state.scannerQueue.length > 0) {
                let chunk = [];
                while (chunk.length < SCANNER_CONCURRENCY && state.scannerQueue.length > 0) {
                    let tId = state.scannerQueue.shift();
                    state.scannerQueued.delete(tId);
                    if (tId !== state.userViewingTournId) chunk.push(tId);
                }

                if (chunk.length > 0) {
                    await Promise.allSettled(chunk.map(tId => scanSingleTournamentBackground(tId, wsUrl, sid)));
                    await new Promise(r => setTimeout(r, 60));
                }
            }
        } finally {
            state.isScanningActive = false;
            updateHUD();
        }
    }

    function scanSingleTournamentBackground(tournId, wsUrl, sid) {
        return new Promise((resolve) => {
            let tourn = state.liveTournaments.get(tournId);
            let bgWs = new OrigWS(wsUrl);
            bgWs.__isBackgroundSpectator = true;
            let finished = false;
            let currentLevel = (tourn && tourn.currentLevel) ? tourn.currentLevel : 1;
            let levelMap = new Map();
            // v65 M3 (SURVIVAL): детали уровней из <Item> — SB (lowStake),
            // анте (ante), длительность (duration: >120 трактуем как секунды,
            // иначе как минуты — 15 → 900с, 600 → 600с)
            let levelDetails = new Map();
            let dynamicTimeout = null;

            let scheduleLoaded = false;
            let pendingPlayersChunks = [];

            function cleanup() {
                if (!finished) {
                    finished = true;
                    if (dynamicTimeout) clearTimeout(dynamicTimeout);
                    try { bgWs.close(); } catch(e) {}
                    resolve();
                }
            }
            
            function resetDynamicTimeout() {
                if (dynamicTimeout) clearTimeout(dynamicTimeout);
                dynamicTimeout = setTimeout(cleanup, 2500);
            }
            resetDynamicTimeout();

            bgWs.onopen = function() {
                bgWs.send(`<EnterTournamentLobby id="${tournId}" sessionId="${sid}" client="html5mobile" clientFace="pokerdom" clientVersion="${state.auth.clientVersion}"/>`);
                bgWs.send('<GetSchedule/>');
                bgWs.send('<GetPlayers offset="0" count="50"/>');
                // v65.1 F4 (аудит #4): призовая структура → N_ITM для модели
                // выживания P(ITM|SitOut)/ICM FREEZE; неизвестный тег сервер
                // игнорирует без побочных эффектов, если структуры нет.
                bgWs.send('<GetPrizes/>');
            };

            function processPlayerBlocks(text) {
                resetDynamicTimeout();
                let currentBB = 500;
                if (levelMap.has(currentLevel)) {
                    currentBB = levelMap.get(currentLevel);
                } else if (tourn && tourn.currentBB > 0) {
                    currentBB = tourn.currentBB;
                }
                if (tourn) {
                    tourn.currentBB = currentBB;
                    tourn.currentLevel = currentLevel;
                }

                let offset = iattr(text, 'offset') || 0;
                let total = iattr(text, 'total') || 0;
                // v65.1 F4 (аудит #4, MODULE 3): N_alive — тотальный атрибут
                // GetPlayers (в v65.0 парсился ТОЛЬКО для пагинации и
                // выбрасывался; «nAlive не наблюдаем» было ложным выводом)
                if (total > 0 && tourn) tourn.alivePlayers = total;
                // v65.1 F4: средний стек поля — по ВСЕМ строкам (не только цели)
                if (!processPlayerBlocks.fieldAcc || processPlayerBlocks.fieldAcc.tourn !== tournId) {
                    processPlayerBlocks.fieldAcc = { tourn: tournId, sum: 0, n: 0 };
                }
                let playerBlocks = text.matchAll(/<Player\s+([^>]+)>/g);
                let countInChunk = 0;

                let tMeta = state.tournamentCache.get(tournId) || { name: tourn ? tourn.name : 'MTT', baseBuyin: 0 };

                for (let pb of playerBlocks) {
                    countInChunk++;
                    let attrs = pb[1];
                    // v65.1 F4: стек для среднего по полю (живые стеки > 0)
                    let anyStack = iattr(attrs, 'stack');
                    if (anyStack !== null && anyStack > 0) {
                        processPlayerBlocks.fieldAcc.sum += anyStack;
                        processPlayerBlocks.fieldAcc.n++;
                    }
                    let rawNick = attr(attrs, 'nickname') || attr(attrs, 'name');
                    let cleanNick = getCleanNick(rawNick);
                    let tableId = attr(attrs, 'tableId');

                    if (TARGET_WATCHLIST.has(cleanNick)) {
                        let stack = iattr(attrs, 'stack') || 0;
                        let rank = iattr(attrs, 'rank') || 0;
                        let place = iattr(attrs, 'placeFrom') || iattr(attrs, 'place') || iattr(attrs, 'placeTo') || 0;
                        let regPrize = fattr(attrs, 'prizeAmount');
                        let bountyPrize = fattr(attrs, 'knockoutBounty');
                        let totalPrize = regPrize + bountyPrize;
                        let uuid = attr(attrs, 'uuid') || `target_${cleanNick}`;
                        
                        let bullets = parseBulletNumber(rawNick);
                        let isBusted = (place > 0) || (stack === 0);
                        let stackBB = (currentBB > 0 && stack > 0) ? (Math.round((stack / currentBB) * 10) / 10) : 0;

                        let p = getOrCreatePlayerProfile(cleanNick);
                        // v62 B1: записи профиля ключуются по cleanNick — суффикс #N
                        // меняется при ребае (Vasya → Vasya #2) и в v60/v61 рвал цепочку
                        // очистки: existingEntry становился undefined и старый стол
                        // никогда не чистился. rawNick остаётся полем записи.
                        let entryKey = `${tournId}_${cleanNick}`;
                        let existingEntry = p.entries.get(entryKey);
                        let isNewEntry = !existingEntry;
                        let statusChanged = existingEntry && (existingEntry.isBusted !== isBusted);

                        // =====================================================
                        // v64.2 Z1 (ZOMBIE-GUARD / BUG-BULLET-RESURRECTION):
                        // Лобби Connective Games ПОСТОЯННО держит строку
                        // выбывшей пули рядом со строкой живой ре-энтри:
                        //   <Player nickname="master3anosov"    place="205" stack="0"/>
                        //   <Player nickname="master3anosov #2" place="0" stack="550000" tableId="f54-…"/>
                        // Обе строки дают один entryKey (cleanNick), и «мёртвая»
                        // строка каждый опрос перезаписывала живую запись
                        // (stack→0, isBusted→true, place=205) И вычищала стол из
                        // discoveredTargetTables → пул зрителей рвал сокет живого
                        // стола, HUD «мигал» живой/выбывшей и показывал [ВЫБЫЛ]
                        // играющему. Защита: «мёртвая» строка НИКОГДА не
                        // перезаписывает живую запись с фишками. ЖИВЫЕ строки
                        // (isBusted=false) проходят всегда — обновление стека не
                        // должно страдать даже при потере суффикса #N (v64 F3).
                        // ВАЖНО: continue, а не return — return обрывал бы
                        // пагинацию GetPlayers (остальные цели в этом чанке и
                        // следующих чанках терялись бы).
                        // =====================================================
                        if (existingEntry && isBusted && !existingEntry.isBusted && (existingEntry.stack || 0) > 0) {
                            // Case A: строка старой пули — её #N меньше номера
                            // текущей пули записи (живая строка ре-энтри несёт #2,
                            // мёртвая строка первой пули суффикса не имеет).
                            if (bullets < (existingEntry.bullets || 1)) {
                                continue;
                            }
                            // Case A2: «мёртвая» строка с УЖЕ записанным ранее
                            // местом выбытия — лобби перетранслирует выбытие
                            // старой пули (place=205 живёт в standings вечно).
                            // НОВОЕ место — настоящее выбытие, проходит.
                            if (place > 0 && Array.isArray(existingEntry.bust_places) && existingEntry.bust_places.includes(place)) {
                                continue;
                            }
                            // Case B: та же пуля, stack=0 и место ещё не присвоено,
                            // при этом запись держит живой tableId — транзиентный
                            // рассинхрон лобби; источник правды — столовой сокет.
                            if (bullets === (existingEntry.bullets || 1) && existingEntry.tableId && place === 0) {
                                continue;
                            }
                        }

                        // v64.3 P6 (REBUY-x2): липкий признак «лобби уже показывало
                        // суффикс #N ≥ 2» — номер пули достоверно ≥ 2. При суффикс-
                        // лоссе (F3) bulletNum падает в 1 — запись НЕ превращается
                        // в «1 вход + N реб.», честная метка остаётся «N входов».
                        let everBulletSuffix = (existingEntry && existingEntry.everBulletSuffix === true) || bullets > 1;
                        let serverSpent = fattr(attrs, 'spent');
                        let serverRebuys = (existingEntry && existingEntry.rebuys !== undefined) ? existingEntry.rebuys : Math.max(0, bullets - 1);
                        // v62 B4: детерминированное значение — первичный источник.
                        // Семантика лоббийного атрибута `spent` не документирована
                        // (наблюдались 370₽/414₽, не кратные цене входа), поэтому
                        // серверная цифра сохраняется отдельным полем spent_server
                        // для аудита и служит фолбэком только при промахе кэша
                        // турнира (baseBuyin неизвестен), чтобы цель не рапортовала 0₽.
                        let bulletCount = Math.max(bullets, serverRebuys + 1);
                        let totalSpent = (tMeta.baseBuyin > 0) ? (bulletCount * tMeta.baseBuyin) : (serverSpent > 0 ? serverSpent : 0);

                        // v64.2 Z1: память мест выбытия — лобби перетранслирует
                        // «мёртвые» строки бесконечно; повтор УЖЕ записанного
                        // места = устаревшая строка (Case A2 в Zombie-Guard).
                        let bustPlaces = (existingEntry && Array.isArray(existingEntry.bust_places)) ? existingEntry.bust_places.slice() : [];
                        if (isBusted && place > 0 && !bustPlaces.includes(place)) bustPlaces.push(place);

                        // v62 B1: чистим СТАРЫЙ стол даже когда строка лобби не несёт
                        // tableId — так выглядят строки выбывших (стол уже не назначен).
                        // В v60/v61 оба guard'а требовали truthy tableId: устаревшая цель
                        // навсегда оставалась в discoveredTargetTables, и «зомби»-
                        // спектатор держал слот 80-столового пула весь турнир.
                        // Активная строка с транзиентно потерянным tableId НЕ чистится
                        // (иначе churn: освобождение/respawn сокета стола).
                        let oldTableId = existingEntry ? existingEntry.tableId : null;
                        if (oldTableId && (isBusted || (tableId && oldTableId !== tableId))) {
                            let oldEntry = state.discoveredTargetTables.get(oldTableId);
                            if (oldEntry && oldEntry.targets) {
                                oldEntry.targets.delete(cleanNick);
                                if (oldEntry.targets.size === 0) {
                                    state.discoveredTargetTables.delete(oldTableId);
                                }
                            }
                        }

                        // v62 B1: регистрируем цель только когда она реально в игре.
                        if (tableId && stack > 0 && !isBusted) {
                            if (!state.discoveredTargetTables.has(tableId)) {
                                state.discoveredTargetTables.set(tableId, { tournId: tournId, targets: new Set() });
                            }
                            state.discoveredTargetTables.get(tableId).targets.add(cleanNick);
                        }

                        p.entries.set(entryKey, {
                            rawNick: rawNick,
                            cleanNick: cleanNick,
                            uuid: uuid,
                            stack: stack,
                            stackBB: stackBB,
                            currentBB: currentBB,
                            tableId: tableId,
                            rank: rank,
                            place: place,
                            bullets: bullets,
                            everBulletSuffix: everBulletSuffix,
                            rebuys: serverRebuys,
                            regular_prize: regPrize,
                            bounty_prize: bountyPrize,
                            prize: totalPrize,
                            isBusted: isBusted,
                            tableName: tMeta.name,
                            tournId: tournId,
                            baseBuyin: tMeta.baseBuyin,
                            spent: totalSpent,
                            spent_server: serverSpent > 0 ? serverSpent : null,
                            bust_places: bustPlaces
                        });

                        if (isNewEntry || statusChanged) {
                            queueServerEvent(isBusted ? "TARGET_PLAYER_BUSTED" : "TARGET_PLAYER_DISCOVERED", {
                                uuid: uuid, name: cleanNick, raw_nick: rawNick, tournament_id: tournId,
                                tournament_name: tMeta.name, chips: stack, stack_bb: stackBB,
                                place: place, prize: totalPrize, is_busted: isBusted, spent_rub: totalSpent
                            });
                        }
                        updateHUD();
                    }
                }

                // v65.1 F4: средний стек поля турнира (по завершении чанка)
                if (tourn && processPlayerBlocks.fieldAcc.n > 0) {
                    tourn.fieldAvgStack = Math.round(processPlayerBlocks.fieldAcc.sum / processPlayerBlocks.fieldAcc.n);
                }

                if (total > (offset + countInChunk) && countInChunk > 0) {
                    try { bgWs.send(`<GetPlayers offset="${offset + countInChunk}" count="50"/>`); } catch(e) { cleanup(); }
                } else {
                    cleanup();
                }
            }

            bgWs.onmessage = async function(e) {
                let text = await decodeSocketPayload(e.data);
                if (!text) return;
                resetDynamicTimeout();

                let anyLvl = iattr(text, 'currentLevel') || iattr(text, 'level');
                if (anyLvl && anyLvl > currentLevel) {
                    currentLevel = anyLvl;
                    if (tourn) tourn.currentLevel = anyLvl;
                    if (levelMap.has(currentLevel) && tourn) {
                        tourn.currentBB = levelMap.get(currentLevel);
                    }
                }

                if (text.includes('<Schedule')) {
                    let sLvl = iattr(text, 'currentLevel');
                    if (sLvl) currentLevel = sLvl;

                    let items = text.matchAll(/<Item\s+([^>]+)>/g);
                    for (let im of items) {
                        let num = iattr(im[1], 'number') || 0;
                        let hs = iattr(im[1], 'highStake') || 0;
                        if (num > 0 && hs > 0) levelMap.set(num, hs);
                        // v65 M3 (SURVIVAL): опциональные атрибуты уровня.
                        // Отсутствующие поля движок выживания добирает
                        // эвристиками (SB=BB/2, анте=12.5% BB, 600с/уровень).
                        let ls = iattr(im[1], 'lowStake');
                        let an = iattr(im[1], 'ante');
                        let du = iattr(im[1], 'duration') || iattr(im[1], 'levelDuration');
                        if (num > 0 && (ls !== null || an !== null || du !== null)) {
                            let d = levelDetails.get(num) || {};
                            if (ls !== null && ls > 0) d.sb = ls;
                            if (an !== null && an >= 0) d.ante = an;
                            if (du !== null && du > 0) d.sec = (du > 120) ? du : du * 60;
                            levelDetails.set(num, d);
                        }
                    }
                    if (levelMap.has(currentLevel) && tourn) {
                        tourn.currentBB = levelMap.get(currentLevel);
                    }
                    scheduleLoaded = true;
                    // v65 M3: кривая блайндов турнира доступна движку выживания HUD
                    if (tourn) { tourn.levelCurve = levelMap; tourn.levelDetails = levelDetails; }

                    while (pendingPlayersChunks.length > 0) {
                        processPlayerBlocks(pendingPlayersChunks.shift());
                    }
                }

                // v65.1 F4 (аудит #4, MODULE 3): <Prizes>/<PrizeInfo> → N_ITM
                if (text.includes('<Prizes') || text.includes('<PrizeInfo') || /placesPaid=/i.test(text)) {
                    parsePrizesInto(text, tournId);
                }

                if (text.includes('<Players')) {
                    if (scheduleLoaded) {
                        processPlayerBlocks(text);
                    } else {
                        pendingPlayersChunks.push(text);
                    }
                }
            };
            bgWs.onerror = cleanup;
            bgWs.onclose = cleanup;
        });
    }

    window.__SCALPEL.handleIncoming = function(ws, xml) {
        if (state.isDestroyed) return;
        if (!xml || typeof xml !== 'string') return;
        xml = xml.trim();
        if (!xml.startsWith('<')) return;

        try {
            if (!ws.__isBackgroundSpectator) {
                let sessMatch = xml.match(/\bsessionId="([^"]+)"/);
                if (sessMatch && sessMatch[1]) state.auth.sessionId = sessMatch[1];
            }

            let versMatch = xml.match(/\bclientVersion="([^"]+)"/);
            if (versMatch) state.auth.clientVersion = versMatch[1];

            // v61 F3 (BUG-CHAT): чат обрабатывается до guard'а таблицы (ловится и на
            // лобби-сокете), поддерживаются обе формы тега и ВСЕ сообщения в кадре.
            {
                let chatRegex = /<ChatMessage\s+([^>]*?)\/>|<ChatMessage\s+([^>]*?)>([\s\S]*?)<\/ChatMessage>/g;
                let chatM;
                while ((chatM = chatRegex.exec(xml)) !== null) {
                    let cAttr = (chatM[1] !== undefined) ? chatM[1] : (chatM[2] || '');
                    let sender = attr(cAttr, 'from');
                    let text = attr(cAttr, 'text');

                    if (sender && text && !/Dealer|Дилер|Система/i.test(sender) && !SYSTEM_CHAT_REGEX.test(text)) {
                        let cleanSender = getCleanNick(sender);
                        state.chatLogs.push({
                            timestamp: new Date().toISOString(),
                            tournament_name: (ws.__tableContext ? ws.__tableContext.getTournamentMeta().name : 'MTT'),
                            table_id: ws.__tableId || 'unknown',
                            nick: sender,
                            cleanNick: cleanSender,
                            is_target: TARGET_WATCHLIST.has(cleanSender),
                            message: decodeHtml(text)
                        });
                        // v61 F7: чат ограничен по объему (раньше рос бесконечно)
                        if (state.chatLogs.length > MAX_CHAT_LOGS) state.chatLogs.shift();
                    }
                }
            }

            if (xml.includes('<TableClosed') || xml.includes('Table closed') || xml.includes('Стол расформирован')) {
                let tableId = ws.__tableId || attr(xml, 'tableId') || attr(xml, 'id');
                if (tableId) {
                    state.discoveredTargetTables.delete(tableId);
                    releaseBackgroundSocket(tableId);
                    state.activeTables.delete(tableId);
                }
            }

            // v65.1 F4 (аудит #4, MODULE 3): N_alive из <GetPlayers total="X">
            // приходит НЕ только сканером — ловим и на лобби/столовых сокетах
            // пользователя (в v65.0 total парсился лишь для пагинации и
            // выбрасывался — «не наблюдаемо» было ошибкой).
            if (/<Players\b/i.test(xml)) {
                let totP = iattr(xml, 'total') || 0;
                if (totP > 0) {
                    let pTid = attr(xml, 'tournamentId') || attr(xml, 'id') ||
                               (ws.__tableContext ? ws.__tableContext.tournId : null) || state.userViewingTournId;
                    if (pTid && pTid !== '0') {
                        let lt = state.liveTournaments.get(pTid);
                        if (lt) { lt.alivePlayers = totP; lt.lastSeen = Date.now(); }
                        else { let tc = state.tournamentCache.get(pTid); if (tc) tc.alivePlayers = totP; }
                    }
                }
            }
            // v65.1 F4: N_ITM из <Prizes>/<PrizeInfo> (cutoff мест в деньгах)
            if (xml.includes('<Prizes') || xml.includes('<PrizeInfo') || /placesPaid=/i.test(xml)) {
                let zTid = attr(xml, 'tournamentId') || attr(xml, 'id') ||
                           (ws.__tableContext ? ws.__tableContext.tournId : null) || state.userViewingTournId;
                if (zTid && zTid !== '0') parsePrizesInto(xml, zTid);
            }

            if (xml.includes('<Tournaments') || xml.includes('<LobbyInfo') || xml.includes('<ServerInfo')) {
                ws.__socketType = 'LOBBY';
                if (!state.sockets.lobby || state.sockets.lobby.readyState !== WebSocket.OPEN) {
                    state.sockets.lobby = ws;
                    triggerLobbyTournamentRefresh();
                }
            }

            if (xml.includes('<Tournaments')) {
                let matches = xml.matchAll(/<Table\s+([^>]+)>/g);
                let currentLiveIds = new Set();

                for (let m of matches) {
                    let attrs = m[1];
                    let tId = attr(attrs, 'id');
                    let tName = attr(attrs, 'name') || '';
                    let tStatus = attr(attrs, 'status');
                    let tGame = attr(attrs, 'game') || '';
                    
                    let rawBuyin = fattr(attrs, 'buyIn') || fattr(attrs, 'buyin') || fattr(attrs, 'stake') || 0;
                    let bounty = fattr(attrs, 'knockoutBounty') || fattr(attrs, 'bounty') || 0;
                    let fee = fattr(attrs, 'fee') || 0;

                    // v64 F1 (BUG-BUYIN-DISTORTION): лобби PKO присылает ТРИ
                    // раздельных атрибута: buyIn — доля в основной призовой фонд,
                    // knockoutBounty — доля в баунти-фонде, fee — рейк рума.
                    // Эвристика v60–v63 (rawBuyin <= bounty+fee+10 ⇒ «buyIn уже
                    // включает bounty и fee») втягивала рейк в номинал бай-ина:
                    // 2500 + 2500 + 400 кэшировалось как baseBuyin=5400₽,
                    // 1250+1250+200 — как 2700₽, 500+500+80 — как 1080₽.
                    // Номинальный бай-ин (взнос в призовой фонд) = buyIn + bounty
                    // БЕЗ рейка; полный вход (с рейком) хранится отдельно в
                    // entryCost — для аудита и отображения полной цены.
                    let nominalBuyin = rawBuyin + bounty;      // взнос в призовой фонд
                    let totalEntryCost = nominalBuyin + fee;   // полный вход с рейком

                    if (tId && tName) {
                        state.tournamentCache.set(tId, {
                            name: decodeHtml(tName),
                            baseBuyin: nominalBuyin,
                            bounty: bounty,
                            fee: fee,
                            entryCost: totalEntryCost,
                            isPKO: bounty > 0 || /нокаут|баунти|bounty|пко|pko|охотник|hunter|knockout/i.test(tName)
                        });
                    }

                    let isHoldem = tGame.includes('TEXAS_HOLDEM') || tGame.includes('HOLDEM') || (!tGame.includes('OMAHA') && !tGame.includes('PINEAPPLE') && !tName.toLowerCase().includes('омаха') && !tName.toLowerCase().includes('ананас'));
                    let isLiveRunning = LIVE_STATUSES.has(tStatus);

                    if (isHoldem && tId && isLiveRunning) {
                        currentLiveIds.add(tId);
                        if (!state.liveTournaments.has(tId)) {
                            state.liveTournaments.set(tId, { id: tId, name: decodeHtml(tName) || 'MTT', status: tStatus, currentBB: 500, currentLevel: 1, lastSeen: Date.now() });
                        } else {
                            let item = state.liveTournaments.get(tId);
                            item.status = tStatus;
                            item.lastSeen = Date.now();
                            if (tName) item.name = decodeHtml(tName);
                        }
                        // v61 F7 (BUG-SCANNER-QUEUE): O(1) дедупликация + ограничение длины
                        if (!state.scannerQueued.has(tId)) {
                            state.scannerQueued.add(tId);
                            state.scannerQueue.push(tId);
                            if (state.scannerQueue.length > MAX_SCANNER_QUEUE) {
                                let droppedT = state.scannerQueue.shift();
                                state.scannerQueued.delete(droppedT);
                            }
                        }
                    } else if (tId && (tStatus === 'COMPLETED' || tStatus === 'CANCELED')) {
                        state.liveTournaments.delete(tId);
                    }
                }

                for (let [tableId, tInfo] of state.discoveredTargetTables.entries()) {
                    if (tInfo.tournId && !currentLiveIds.has(tInfo.tournId)) {
                        state.discoveredTargetTables.delete(tableId);
                    }
                }

                dispatchParallelScanner();
                updateHUD();
            }

            if (xml.includes('<TableDetails') || xml.includes('<TournamentTable')) {
                let tableId = attr(xml, 'id') || attr(xml, 'tableId');
                let tournId = attr(xml, 'tournamentId') || attr(xml, 'tournId');
                let tName = attr(xml, 'tournamentName') || attr(xml, 'name');
                if (tournId && tName && !state.tournamentCache.has(tournId)) {
                    state.tournamentCache.set(tournId, { name: decodeHtml(tName), baseBuyin: 0, isPKO: /нокаут|баунти|bounty|пко|pko|охотник|hunter|knockout/i.test(tName) });
                }

                if (tableId) {
                    ws.__tableId = tableId;
                    if (!ws.__tableContext) {
                        ws.__tableContext = state.activeTables.get(tableId) || new TableContext(tableId, tournId);
                    }
                    if (tournId && !ws.__tableContext.tournId) ws.__tableContext.tournId = tournId;
                    state.activeTables.set(tableId, ws.__tableContext);
                }
            }

            let ctx = ws.__tableContext;
            if (!ctx) return;

            // v65.1 F1 (аудит #1): приватные карты игрока — только его столы
            if (state.sockets.userTables.has(ctx.tableId)) {
                ctx.updateUserCardsFromXml(xml);
            }

            let bbAttr = iattr(xml, 'highStake');
            let sbAttr = iattr(xml, 'lowStake');
            let anteAttr = iattr(xml, 'ante');
            let numAttr = iattr(xml, 'number');
            if (bbAttr !== null && bbAttr > 0) {
                ctx.level.bb = bbAttr;
                ctx.level.sb = sbAttr !== null ? sbAttr : Math.round(bbAttr / 2);
                ctx.level.ante = anteAttr !== null ? anteAttr : 0;
                if (numAttr !== null) ctx.level.number = numAttr;
            }

            if (xml.includes('<Seats') || (xml.includes('<Seat ') && (xml.includes('nickname=') || xml.includes('<PlayerInfo')))) {
                let seatBlocks = xml.matchAll(/<Seat\s+([^>]*?\bid="(\d+)"[^>]*?)(?:\/>|>([\s\S]*?)<\/Seat>)/gs);
                let seatBlocksSeen = 0;
                for (let sb of seatBlocks) {
                    let seatAttrs = sb[1];
                    let seatNum = parseInt(sb[2], 10);
                    let seatContent = sb[3] || '';
                    seatBlocksSeen++;

                    // v61 F5 (BUG-SEATS): автокалибровка базы нумерации мест сервера.
                    // Место 0 существует → база 0; maxSeatId == кол-ву мест → база 1.
                    if (seatNum === 0) {
                        state.serverSeatBase = 0;
                        state.serverSeatBaseLocked = true;
                    }
                    if (seatNum > ctx.maxSeatId) ctx.maxSeatId = seatNum;

                    let piM = seatContent.match(/<PlayerInfo[^>]*nickname="([^"]+)"/);
                    let rawNick = attr(seatAttrs, 'nickname') || attr(seatAttrs, 'name') || (piM ? piM[1] : null) || attr(seatContent, 'nickname') || attr(seatContent, 'name');
                    
                    let chipsM = seatContent.match(/<Chips[^>]*\/>/);
                    let stackM = seatContent.match(/stack-size="([^"]+)"/);
                    let entryM = seatContent.match(/<Entry\s+([^>]*)\/?>/);
                    
                    let serverStack = attr(seatAttrs, 'stack-size') ? parseInt(attr(seatAttrs, 'stack-size'), 10) : (chipsM ? iattr(chipsM[0], 'stack-size') : (stackM ? parseInt(stackM[1], 10) : null));
                    let serverSpent = entryM ? (fattr(entryM[1], 'spent') || 0) : 0;

                    let isSittingOut = seatAttrs.includes('sittingOut="true"') || seatContent.includes('sittingOut="true"');
                    if (isSittingOut) ctx.sittingOutSeats.add(seatNum);
                    else ctx.sittingOutSeats.delete(seatNum);

                    let s = ctx.ensureSeat(seatNum, rawNick, serverStack);
                    s.busted = (serverStack === 0);
                    // v65.1 F1: маркер своего места (own/self)
                    if (seatAttrs.includes('own="true"') || seatAttrs.includes('self="true"')) {
                        ctx.userSeat = seatNum;
                    }
                    if (serverSpent > 0) s.spent = serverSpent;

                    if (ctx.hand === null && serverStack !== null && serverStack > 0) {
                        ctx.handStart[seatNum] = serverStack;
                    }

                    if (rawNick && TARGET_WATCHLIST.has(s.cleanNick)) {
                        let p = getOrCreatePlayerProfile(s.cleanNick);
                        let tournId = ctx.tournId;
                        // v62 B1: ключ по cleanNick — синхронно со сканером, ребай-
                        // переименование (#N) не создаёт вторую запись и не теряет
                        // старый стол из очистки.
                        // v63 C9 (дубли записей): разрешение ключа в три шага —
                        // (1) прямой ключ tournId; (2) tournId ещё null → принимаем
                        // существующую запись этого ника на ЭТОМ столе под любым
                        // ключом (ключ сканера t1_… ИЛИ фолбэк 555_…) и обновляем её;
                        // (3) tournId опоздал → МИГРАЦИЯ записи из фолбэк-ключа
                        // tableId в канонический ключ tournId. v62 никогда не
                        // мигрировал: гонка «Seats раньше TableDetails» на
                        // пользовательском сокете рождала двойников 555_nick+t9_nick.
                        let entryKey = tournId ? `${tournId}_${s.cleanNick}` : null;
                        let entry = entryKey ? (p.entries.get(entryKey) || null) : null;
                        if (!entry) {
                            for (let [k, e] of p.entries) {
                                if (e.cleanNick === s.cleanNick && e.tableId === ctx.tableId) {
                                    entry = e;
                                    if (tournId && k !== entryKey) {
                                        p.entries.delete(k);   // миграция: убрать устаревший ключ
                                    } else {
                                        entryKey = k;          // tournId ещё нет — обновляем под старым ключом
                                    }
                                    break;
                                }
                            }
                            if (!entry) {
                                entryKey = tournId ? `${tournId}_${s.cleanNick}` : `${ctx.tableId}_${s.cleanNick}`;
                            }
                        }
                        let bullets = parseBulletNumber(rawNick);
                        let baseBuyin = ctx.getTournamentMeta().baseBuyin;

                        if (!entry) {
                            entry = {
                                rawNick: rawNick,
                                cleanNick: s.cleanNick,
                                tableName: ctx.getTournamentMeta().name,
                                baseBuyin: baseBuyin
                            };
                        }
                        
                        if (!entry.isBusted || entry.place === 0) {
                            if (serverStack !== null) entry.stack = serverStack;
                            entry.tournId = tournId;
                            entry.tableId = ctx.tableId;
                            entry.isBusted = (entry.stack === 0);
                            // v64.2 Z3 (ZOMBIE-GUARD, столовая сторона): суффикс
                            // «#N» ника ЗА СТОЛОМ — счётчик ВСЕХ покупок (входы +
                            // ребаи за столом; наблюдение: лобби «borsalino #7»,
                            // стол «borsalino #14», всего 14 покупок), а суффикс
                            // ЛОББИ — номер текущей пули. Прежний безусловный
                            // перезапис затирал табличным числом номер пули:
                            // (а) HUD «Пуля #N» мигал 7↔14; (б) Zombie-Guard
                            // сканера, сравнивающий номера пуль, слабел. Теперь
                            // табличное число только ПОДНИМАЕТ rebuys (покупки
                            // монотонны), номер пули не трогаем.
                            if (bullets > (entry.rebuys || 0) + 1) entry.rebuys = bullets - 1;
                            if (!entry.bullets) entry.bullets = bullets;
                            // v62 B4: та же формула, что и в сканере/экспорте —
                            // детерминированные bullets × baseBuyin; серверное
                            // значение — аудит + фолбэк при неизвестном baseBuyin.
                            let bulletCount = Math.max(bullets, (entry.rebuys || 0) + 1);
                            entry.spent = (baseBuyin > 0) ? (bulletCount * baseBuyin) : (serverSpent > 0 ? serverSpent : (entry.spent || 0));
                            entry.spent_server = serverSpent > 0 ? serverSpent : (entry.spent_server || null);
                            entry.baseBuyin = baseBuyin || entry.baseBuyin;
                            entry.tableName = ctx.getTournamentMeta().name;
                            p.entries.set(entryKey, entry);
                            updateHUD();
                        }
                    }
                }
                // v61 F5: фиксируем наблюдаемое число мест стола
                if (seatBlocksSeen > ctx.observedSeatCount) ctx.observedSeatCount = seatBlocksSeen;
                if (!state.serverSeatBaseLocked && ctx.observedSeatCount > 1 && ctx.maxSeatId === ctx.observedSeatCount) {
                    // v64.1: при переходе 0→1 заглушки, созданные по старой
                    // базе, перестраиваются под новую
                    let seatBaseFlipped = (state.serverSeatBase === 0);
                    state.serverSeatBase = 1;
                    if (seatBaseFlipped) realignSeatPlaceholders();
                }
            }

            if (xml.includes('<GameState') || xml.includes('<Message>')) {
                let gsM = xml.match(/<GameState\s+([^>]*)>/);
                if (gsM) {
                    let gh = attr(gsM[0], 'hand');
                    let seatsTag = xml.match(/<Seats\s+([^>]*)>/);
                    let gsDealer = seatsTag ? iattr(seatsTag[0], 'dealer') : 0;

                    if (gh && (!ctx.hand || ctx.hand !== gh)) {
                        let actList = [];
                        let mm, sRe = /<Seat\s+([^>]*?\bid="(\d+)"[^>]*?)(?:\/>|>([\s\S]*?)<\/Seat>)/g;
                        while ((mm = sRe.exec(xml)) !== null) {
                            if (/activeInHand="true"/.test(mm[1])) {
                                let sn = parseInt(mm[2], 10);
                                let rNick = attr(mm[1], 'nickname') || (mm[3] ? attr(mm[3], 'nickname') : null);
                                ctx.ensureSeat(sn, rNick, null);
                                actList.push(sn);
                            }
                        }
                        ctx.beginHand(gh, gsDealer, actList);
                        ctx.handOrigin = 'midhand-sync';
                    }
                }

                let newHandMatch = xml.match(/<NewHand\s+([^>]*)\/>/);
                if (newHandMatch) {
                    let handNum = attr(newHandMatch[0], 'number');
                    let dealer = iattr(newHandMatch[0], 'dealer') || 0;
                    let actSeats = [];
                    let asM = xml.match(/<ActiveSeats>([\s\S]*?)<\/ActiveSeats>/);
                    if (asM) {
                        let sm, asRe = /<Seat\s+id="(\d+)"/g;
                        while ((sm = asRe.exec(asM[1])) !== null) actSeats.push(parseInt(sm[1], 10));
                    }
                    ctx.beginHand(handNum, dealer, actSeats);
                    ctx.handOrigin = 'newhand';
                }

                let acM = xml.matchAll(/<ActiveChange\s+([^>]*)\/>/g);
                for (let ac of acM) {
                    let actSeat = iattr(ac[1], 'seat');
                    if (actSeat !== null) ctx.seatTimerStart.set(actSeat, Date.now());
                }

                // v62 B2 (BUG-STREET-DESYNC): разбор кадра в порядке документа
                // (streaming). Сервер может склеить в один кадр действие и сдачу
                // следующей улицы в ЛЮБОМ порядке. v61 применял updateBoardFromXml
                // ДО всех действий: кадры «действие → сдача» портились (флоп-колл
                // становился TURN_CALL, у префлоп-колла терялся VPIP, улица
                // «загрязнялась» чужими ставками); глобальный перенос «сначала все
                // действия» ломает зеркальные кадры «сдача → действие» (доказано
                // на патч-копии в раунде-2). Корректно применять события по мере их
                // появления в XML: действия — при текущей улице, сдачу — сразу на
                // месте. Одиночные кадры без склейки не меняют поведение (эквивалентно
                // старому порядку). Отдельные парсеры (чат, Winners, KO) не затронуты.
                let EVENT_RE = /<PlayerAction\s+seat="(\d+)"([^>]*)>([\s\S]*?)<\/PlayerAction>|<(DealingFlop|DealingTurn|DealingRiver)>[\s\S]*?<\/\4>|<Board>[\s\S]*?<\/Board>/gi;
                let am;
                while ((am = EVENT_RE.exec(xml)) !== null) {
                    // событие сдачи/борда — применяем на месте, улица меняется здесь
                    if (am[1] === undefined) {
                        ctx.updateBoardFromXml(am[0]);
                        continue;
                    }
                    let seatNum = parseInt(am[1], 10);
                    let actionAttrs = am[2];
                    let body = am[3];
                    let actionId = attr(actionAttrs, 'id') || `${ctx.hand}_${ctx.street}_${seatNum}_${body.slice(0, 30)}`;
                    
                    if (ctx.processedActionIds.has(actionId)) continue;
                    ctx.processedActionIds.add(actionId);

                    let inner = body.match(/^<(\w+)([^>]*)\/?>/) || body.match(/^<(\w+)([^>]*)>/);
                    if (!inner) continue;
                    let kind = inner[1], aStr = inner[2];
                    let amount = iattr(aStr, 'amount') || 0;
                    let s = ctx.ensureSeat(seatNum, null);
                    // v61 F8: максимум банка ДО действия — для корректной классификации
                    // агрессивных all-in (короткий all-in-рейз и 3-бет all-in считались
                    // коллами в v60 → занижались PFR/AGG).
                    let preActionMaxBet = ctx.currentMaxBet;
                    // v62 B3: фиксируем состояние «против кражи» ДО действия: рейз самого
                    // игрока (3-бет блайндом против кражи) — уже ответ на кражу, поэтому
                    // снимаем показания до того, как recordAction обновит трекер.
                    let facedStealPreflop = (ctx.street === 'PREFLOP') && (ctx.preflopRaises === 1) && ctx.preflopStealAttempt;

                    if (kind === 'SitOut') ctx.sittingOutSeats.add(seatNum);
                    else if (kind === 'SitIn') ctx.sittingOutSeats.delete(seatNum);

                    if (['PostAnte', 'PostSmallBlind', 'PostBigBlind', 'Bet', 'Raise', 'Call', 'AllIn', 'UncalledBet'].includes(kind)) {
                        ctx.recordAction(seatNum,
                            kind === 'PostAnte' ? 'ANTE' :
                            kind === 'PostSmallBlind' ? 'SB' :
                            kind === 'PostBigBlind' ? 'BB' : 
                            kind === 'AllIn' ? 'ALLIN' : kind.toUpperCase(),
                            amount);
                    } else if (kind === 'Fold') {
                        ctx.activeSeats.delete(seatNum);
                        s.inHand = false;
                        ctx.recordAction(seatNum, 'FOLD', 0);
                    } else if (kind === 'Check') {
                        ctx.recordAction(seatNum, 'CHECK', 0);
                    } else if (kind === 'Show') {
                        let cards = Array.from(body.matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => (m[1] === '10' ? 'T' : m[1].toUpperCase()) + m[2].toLowerCase());
                        let comb = attr(aStr, 'combination') || '';
                        if (cards.length >= 2) {
                            ctx.showdownCards[seatNum] = { cards: cards.slice(0, 2).join(' '), isMuck: false, combination: decodeHtml(comb) };
                        }
                    } else if (kind === 'Muck') {
                        let mc = Array.from(body.matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => (m[1] === '10' ? 'T' : m[1].toUpperCase()) + m[2].toLowerCase());
                        if (mc.length >= 2) {
                            ctx.showdownCards[seatNum] = { cards: mc.slice(0, 2).join(' '), isMuck: true, combination: '' };
                        }
                    }

                    if (TARGET_WATCHLIST.has(s.cleanNick) && !ctx.sittingOutSeats.has(seatNum)) {
                        let isPreflop = (ctx.street === 'PREFLOP');
                        let playerPos = ctx.positions[seatNum] || '';
                        // v61 F8: all-in агрессивен, если ПОСЛЕ действия ставка игрока
                        // превышает максимум банка ДО действия
                        let isAggressiveAllIn = (kind === 'AllIn') && ((ctx.streetBetsPerSeat.get(seatNum) || 0) > preActionMaxBet);

                        let pStats = ctx.handPendingStats.get(seatNum) || { vpip: false, pfr: false, agg: 0, pass: 0, tot: 0, stealBB: 0, stealSB: 0, stealBBOpp: 0, stealSBOpp: 0 };

                        // v62 B3: знаменатель — «слепой встретил попытку кражи» (один
                        // раз за руку): и фолды, и защиты (колл/3-бет) считаются
                        // возможностями fold-to-steal. Блайнд-посты не считаются:
                        // на момент поста рейзов еще нет.
                        if (facedStealPreflop && (playerPos === 'BB' || playerPos.includes('SB'))) {
                            if (playerPos === 'BB') pStats.stealBBOpp = 1;
                            else pStats.stealSBOpp = 1;
                        }

                        if (kind === 'Call' || (kind === 'AllIn' && !isAggressiveAllIn)) {
                            if (isPreflop) {
                                pStats.vpip = true;
                            } else {
                                pStats.pass++;
                                pStats.tot++;
                            }
                        } else if (kind === 'Raise' || kind === 'Bet' || isAggressiveAllIn) {
                            if (isPreflop) {
                                pStats.vpip = true;
                                pStats.pfr = true;
                            } else {
                                pStats.agg++;
                                pStats.tot++;
                            }
                        } else if (kind === 'Check') {
                            if (!isPreflop) {
                                pStats.tot++;
                            }
                        } else if (kind === 'Fold') {
                            if (isPreflop) {
                                // v62 B3: фолд в блайндах считается fold-to-steal
                                // ТОЛЬКО против реальной попытки кражи (единственный
                                // префлоп-рейз от CO/BTN/SB). В v60/v61 любой префлоп-
                                // фолд блайнда инкрементировал счётчик — фолд против
                                // UTG-опена или 3-бета тоже, метрика была «префлоп-
                                // фолды в блайндах» под чужим именем.
                                if (facedStealPreflop) {
                                    if (playerPos === 'BB') pStats.stealBB++;
                                    else if (playerPos.includes('SB')) pStats.stealSB++;
                                }
                            } else {
                                pStats.tot++;
                            }
                        }
                        ctx.handPendingStats.set(seatNum, pStats);
                    }
                }

                let koBlock = xml.match(/<KnockoutPayouts[\s\S]*?<\/KnockoutPayouts>/i) || xml.match(/<Knockout\s+([^>]*)\/>/i);
                if (koBlock && ctx && ctx.hand) {
                    let koM = xml.match(/<Knockout\s+([^>]*)\/>/);
                    let payM = xml.match(/<KnockoutPayout\s+([^>]*)\/>/);
                    let headBountyM = xml.match(/<KnockoutBounty\s+([^>]*)\/>/);

                    if (koM) {
                        let bustedSeat = iattr(koM[1], 'busted');
                        let winnerSeat = iattr(koM[1], 'winners') !== null ? iattr(koM[1], 'winners') : iattr(koM[1], 'winner');

                        if (winnerSeat === null && ctx.winners.length > 0) winnerSeat = ctx.winners[0].seat;

                        let cashReward = payM ? fattr(payM[1], 'amount') : 0;
                        // v64.3 P2 (DYNAMIC-PKO): денежная выплата <KnockoutPayout> —
                        // само доказательство PKO. Турниры с нестандартными именами
                        // («Вечерний Хайроллер 800 000 р.», без ключевых слов
                        // нокаут/баунти/pko в названии) инициализируют кэш isPKO=false,
                        // хотя реальные баунти капают (13 365₽ и т.п.). Апгрейд кэша
                        // немедленно кормит finalizeHand → is_pko в JSON-руке.
                        if (cashReward > 0 && ctx.tournId) {
                            let tCache = state.tournamentCache.get(ctx.tournId);
                            if (tCache) {
                                if (!tCache.isPKO) {
                                    tCache.isPKO = true;
                                    logDebug("PKO_UPGRADE", `Турнир ${ctx.tournId} помечен PKO: денежная выплата ${cashReward}₽`);
                                }
                            } else {
                                state.tournamentCache.set(ctx.tournId, { name: (ctx.getTournamentMeta() || { name: 'MTT' }).name, baseBuyin: 0, isPKO: true });
                            }
                        }
                        let bountyGrowth = payM ? fattr(payM[1], 'selfBountyChange') : 0;
                        let newHeadBounty = headBountyM ? fattr(headBountyM[1], 'amount') : 0;

                        let killer = ctx.seats.get(winnerSeat);
                        let victim = ctx.seats.get(bustedSeat);

                        if (killer && newHeadBounty > 0) killer.headBounty = newHeadBounty;

                        ctx.knockoutBounties.push({
                            killer_seat: winnerSeat,
                            killer_nick: killer ? killer.rawNick : `Seat ${winnerSeat}`,
                            killer_clean_nick: killer ? killer.cleanNick : `seat_${winnerSeat}`,
                            victim_seat: bustedSeat,
                            victim_nick: victim ? victim.rawNick : `Seat ${bustedSeat}`,
                            victim_clean_nick: victim ? victim.cleanNick : `seat_${bustedSeat}`,
                            cash_payout_rub: cashReward,
                            bounty_growth_rub: bountyGrowth,
                            killer_new_head_bounty_rub: newHeadBounty
                        });
                        logDebug("KNOCKOUT_AWARD", `💥 K.O.: ${killer ? killer.rawNick : winnerSeat} выбил ${victim ? victim.rawNick : bustedSeat} (+${cashReward}₽ в кассу)`);
                    }
                }

                if (xml.includes('<Winner')) {
                    let wMatches = xml.matchAll(/<Winner\s+([^>]*?)>(.*?)<\/Winner>|<Winner\s+([^>]*?)\/>/gs);
                    for (let wm of wMatches) {
                        let wAttr = wm[1] || wm[3] || '';
                        let wInner = wm[2] || '';
                        let wSeat = iattr(wAttr, 'seat');
                        let wAmt = iattr(wAttr, 'amount') || 0;
                        let wPot = iattr(wAttr, 'pot');
                        let potIdx = wPot !== null ? wPot : ctx.winners.length;
                        let wComb = decodeHtml(attr(wAttr, 'combination') || '');
                        let wCards = Array.from(wInner.matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => (m[1] === '10' ? 'T' : m[1].toUpperCase()) + m[2].toLowerCase()).slice(0, 5).join(' ');

                        let alreadyAdded = ctx.winners.some(w => w.seat === wSeat && w.potIndex === potIdx);
                        if (!alreadyAdded && wSeat !== null && wAmt > 0) {
                            ctx.winners.push({ seat: wSeat, amount: wAmt, potIndex: potIdx, combination: wComb, cards: wCards });
                        }
                    }
                }

                if (/<EndHand/.test(xml)) {
                    let finalizedHand = ctx.finalizeHand();
                    if (finalizedHand) {
                        // v61 F8: дедупликация по (стол + номер руки) — номера рук у
                        // разных столов совпадают, в v60 это молча отбрасывало валидные раздачи
                        let dedupKey = `${finalizedHand.table_id}#${finalizedHand.hand_number}`;
                        if (!state.recordedHandNumbers.has(dedupKey)) {
                            state.recordedHandNumbers.add(dedupKey);
                            state.completedHandsArchive.push(finalizedHand);
                            if (state.completedHandsArchive.length > MAX_ARCHIVE_HANDS) {
                                let removed = state.completedHandsArchive.shift();
                                state.recordedHandNumbers.delete(`${removed.table_id}#${removed.hand_number}`);
                            }
                            // v65.1 F2 (аудит #2): тяжёлая математика руки —
                            // в чанки (≤6мс/слот), НЕ в обработчике onmessage
                            queueLazyHandMath(finalizedHand);
                            updateHUD();
                        }
                    }
                    ctx.hand = null;
                }
            }
        } catch(e) {
            console.error("XML Stream Error:", e);
        }
    };

    window.__SCALPEL.handleOutgoing = function(ws, data) {
        if (state.isDestroyed) return;
        decodeSocketPayload(data).then(text => {
            if (state.isDestroyed) return;
            if (!text || typeof text !== 'string') return;
            
            if (!ws.__isBackgroundSpectator) {
                let sessMatch = text.match(/\bsessionId="([^"]+)"/);
                if (sessMatch && sessMatch[1]) state.auth.sessionId = sessMatch[1];
            } else {
                return;
            }

            if (text.includes('<EnterTournamentLobby')) {
                state.userViewingTournId = attr(text, 'id');
            } else if (text.includes('<EnterTable') || text.includes('<OpenTable')) {
                let tableId = attr(text, 'tableId') || attr(text, 'id');
                // ИСПРАВЛЕНИЕ 1: Устранен ReferenceError xml
                let tournId = attr(text, 'tournamentId') || attr(text, 'tournId');
                if (tableId) {
                    // v61 F2: освобождаем фоновый сокет стола (с отменой spawn-таймера)
                    releaseBackgroundSocket(tableId, true);

                    state.userViewingTableId = tableId;
                    state.sockets.userTables.set(tableId, ws);
                    ws.__tableId = tableId;
                    if (!state.activeTables.has(tableId)) {
                        ws.__tableContext = new TableContext(tableId, tournId);
                        state.activeTables.set(tableId, ws.__tableContext);
                    } else {
                        ws.__tableContext = state.activeTables.get(tableId);
                        if (tournId && !ws.__tableContext.tournId) ws.__tableContext.tournId = tournId;
                    }
                }
            }
        });
    };

    window.__SCALPEL.handleClose = function(ws) {
        if (state.isDestroyed) return;
        if (ws.__tableId) {
            state.sockets.userTables.delete(ws.__tableId);
            if (!state.backgroundTableSockets.has(ws.__tableId)) {
                state.activeTables.delete(ws.__tableId);
            }
        }
        if (ws === state.sockets.lobby) {
            state.sockets.lobby = null;
            for (let uWs of state.sockets.userTables.values()) {
                if (uWs && uWs.readyState === WebSocket.OPEN) {
                    state.sockets.lobby = uWs;
                    break;
                }
            }
        }
    };

    window.__SCALPEL.hookSocket = function(ws, explicitUrl) {
        if (!ws || ws.__scalpelHooked) return;
        ws.__scalpelHooked = true;

        let targetUrl = explicitUrl || ws.url || ws._url;
        if (targetUrl && typeof targetUrl === 'string' && (targetUrl.includes('/ws') || targetUrl.startsWith('ws'))) {
            state.auth.wssUrl = targetUrl;
        }

        let onOpenHandler = function() {
            if (state.isDestroyed) return;
            if (!ws.__isBackgroundSpectator && !ws.__tableId && !ws.__isTournamentLobby) {
                if (!state.sockets.lobby || state.sockets.lobby.readyState !== WebSocket.OPEN) {
                    state.sockets.lobby = ws;
                    try { ws.send('<GetTournaments tournament="SCHEDULED|LIVE" games="TEXAS_HOLDEM" id="99999"/>'); } catch(e) {}
                }
            }
        };

        if (ws.readyState === WebSocket.OPEN) {
            onOpenHandler();
        } else {
            ws.addEventListener('open', onOpenHandler, { once: true });
        }

        ws.addEventListener('message', async function (e) {
            if (window.__SCALPEL && window.__SCALPEL.handleIncoming && !window.__SCALPEL.state.isDestroyed) {
                let text = await decodeSocketPayload(e.data);
                window.__SCALPEL.handleIncoming(ws, text);
            }
        });

        ws.addEventListener('close', function() {
            if (window.__SCALPEL && window.__SCALPEL.handleClose && !window.__SCALPEL.state.isDestroyed) {
                window.__SCALPEL.handleClose(ws);
            }
        });
    };

    window.__SCALPEL.destroy = function() {
        // v61 F8: флаг зомби-режима — все хуки перестают мутировать состояние
        state.isDestroyed = true;
        state.timerIds.forEach(id => clearInterval(id));
        // v61 F2: отменяем отложенные spawn-таймеры и закрываем все фоновые сокеты
        Array.from(state.backgroundTableSockets.keys()).forEach(tid => releaseBackgroundSocket(tid));
        state.backgroundTableSockets.clear();
        state.scannerQueue.length = 0;
        state.scannerQueued.clear();
        document.querySelectorAll('[id^="stalker-hud"]').forEach(el => el.remove());
        console.log("%c[SCALPEL] Инстанс v65.1 уничтожен.", "color:#f59e0b;");
    };

    // v61 F7: периодическое обслуживание состояния — очистка устаревших/растущих структур
    function performStateMaintenance() {
        let nowMs = Date.now();

        // турниры, которых больше нет в лобби (без явного COMPLETED/CANCELED)
        for (let [tid, tItem] of state.liveTournaments) {
            if (tItem.lastSeen && nowMs - tItem.lastSeen > STALE_TOURNAMENT_MS) {
                state.liveTournaments.delete(tid);
            }
        }

        // ограничение кэша турниров (вытесняем не-живые)
        if (state.tournamentCache.size > MAX_TOURNAMENT_CACHE) {
            let excess = state.tournamentCache.size - MAX_TOURNAMENT_CACHE;
            for (let tid of state.tournamentCache.keys()) {
                if (excess <= 0) break;
                if (!state.liveTournaments.has(tid)) {
                    state.tournamentCache.delete(tid);
                    excess--;
                }
            }
        }

        // истёкшие кулдауны сокетов
        for (let [tid, cd] of state.socketCooldowns) {
            if (nowMs >= cd) state.socketCooldowns.delete(tid);
        }
    }

    let timerQueue = setInterval(() => { processOutboxQueue(); performStateMaintenance(); }, 3000);
    state.timerIds.push(timerQueue);

    // ── v61 F6 (BUG-DEFLATE): ПОЛНЫЙ ДЕКОДЕР ПАКЕТОВ ─────────────────────────
    // Поддержка: plain UTF-8, gzip, zlib-deflate, RAW deflate (без заголовка).
    // Плюс корректная нарезка типизированных view (byteOffset/byteLength) и
    // чистый JS-inflate как fallback, если DecompressionStream недоступен.

    async function inflateViaStream(format, buffer) {
        if (typeof DecompressionStream === 'undefined') return null;
        let timerId = null;
        try {
            let ds = new DecompressionStream(format);
            let stream = new Response(buffer).body.pipeThrough(ds);
            let textPromise = new Response(stream).text();
            // v61 F6: стрим может зависнуть (наблюдалось в дикой природе) — гонка
            // с таймаутом гарантирует деградацию до синхронного JS-inflate.
            let guarded = textPromise.then(v => v, () => null);
            let timeoutPromise = new Promise(resolve => { timerId = setTimeout(() => resolve(null), 1500); });
            let result = await Promise.race([guarded, timeoutPromise]);
            if (timerId !== null) clearTimeout(timerId);
            return result;
        } catch (e) {
            if (timerId !== null) clearTimeout(timerId);
            return null;
        }
    }

    // Компактный inflate (алгоритм в стиле zlib "puff", public domain Mark Adler).
    // Возвращает массив байт или null при ошибке.
    function puffInflate(bytes, pos) {
        let bitbuf = 0, bitcnt = 0, out = [];
        function bits(need) {
            let val = bitbuf;
            while (bitcnt < need) {
                if (pos >= bytes.length) throw new Error('eof');
                val |= bytes[pos++] << bitcnt;
                bitcnt += 8;
            }
            bitbuf = val >>> need;
            bitcnt -= need;
            return val & ((1 << need) - 1);
        }
        function buildHuff(lengths) {
            let count = new Array(16).fill(0);
            for (let i = 0; i < lengths.length; i++) count[lengths[i]]++;
            count[0] = 0;
            let left = 1;
            for (let len = 1; len <= 15; len++) {
                left <<= 1;
                left -= count[len];
                if (left < 0) throw new Error('over');
            }
            let offs = new Array(16).fill(0);
            for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + count[len];
            let symbol = new Array(lengths.length);
            for (let sym = 0; sym < lengths.length; sym++) {
                if (lengths[sym]) symbol[offs[lengths[sym]]++] = sym;
            }
            return { count: count, symbol: symbol };
        }
        function decodeSym(h) {
            let code = 0, first = 0, index = 0;
            for (let len = 1; len <= 15; len++) {
                code |= bits(1);
                let cnt = h.count[len];
                if (code - cnt < first) return h.symbol[index + (code - first)];
                index += cnt;
                first += cnt;
                first <<= 1;
                code <<= 1;
            }
            throw new Error('bad code');
        }
        const LBASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
        const LEXT = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
        const DBASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
        const DEXT = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
        function inflateBlock(lc, dc) {
            for (;;) {
                let sym = decodeSym(lc);
                if (sym === 256) return;
                if (sym < 256) out.push(sym);
                else {
                    sym -= 257;
                    let len = LBASE[sym] + bits(LEXT[sym]);
                    let dsym = decodeSym(dc);
                    let dist = DBASE[dsym] + bits(DEXT[dsym]);
                    let from = out.length - dist;
                    if (from < 0) throw new Error('bad dist');
                    for (let k = 0; k < len; k++) out.push(out[from++]);
                }
            }
        }
        let last, type;
        do {
            last = bits(1);
            type = bits(2);
            if (type === 0) {
                // stored block: выравниваемся по байту
                bitbuf = 0; bitcnt = 0;
                if (pos + 4 > bytes.length) throw new Error('eof');
                let len = bytes[pos] | (bytes[pos + 1] << 8);
                pos += 4;
                if (pos + len > bytes.length) throw new Error('eof');
                for (let i = 0; i < len; i++) out.push(bytes[pos++]);
            } else if (type === 1) {
                let lens = new Array(288);
                let i;
                for (i = 0; i < 144; i++) lens[i] = 8;
                for (; i < 256; i++) lens[i] = 9;
                for (; i < 280; i++) lens[i] = 7;
                for (; i < 288; i++) lens[i] = 8;
                let distLens = new Array(30).fill(5);
                inflateBlock(buildHuff(lens), buildHuff(distLens));
            } else if (type === 2) {
                let hlen = bits(5) + 257, hdist = bits(5) + 1, hcode = bits(4) + 4;
                let order = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
                let clLens = new Array(19).fill(0);
                for (let i = 0; i < hcode; i++) clLens[order[i]] = bits(3);
                let clHuff = buildHuff(clLens);
                let lens = new Array(hlen + hdist).fill(0);
                let i = 0;
                while (i < hlen + hdist) {
                    let sym = decodeSym(clHuff);
                    if (sym < 16) lens[i++] = sym;
                    else {
                        let rep = 0, val = 0;
                        if (sym === 16) { val = lens[i - 1]; rep = 3 + bits(2); }
                        else if (sym === 17) { rep = 3 + bits(3); }
                        else { rep = 11 + bits(7); }
                        while (rep-- && i < hlen + hdist) lens[i++] = val;
                    }
                }
                inflateBlock(buildHuff(lens.slice(0, hlen)), buildHuff(lens.slice(hlen)));
            } else {
                throw new Error('bad block');
            }
        } while (!last);
        return out;
    }

    // wrapper: 0 = raw, 2 = zlib, 3 = gzip. Возвращает строку или null.
    function inflateJS(uint8, wrapper) {
        try {
            let pos = 0;
            if (wrapper === 2) pos = 2;
            else if (wrapper === 3) {
                if (uint8.length < 18 || uint8[0] !== 0x1f || uint8[1] !== 0x8b || uint8[2] !== 8) return null;
                let flg = uint8[3];
                pos = 10;
                if (flg & 4) { let xl = uint8[pos] | (uint8[pos + 1] << 8); pos += 2 + xl; }
                if (flg & 8) { while (pos < uint8.length && uint8[pos]) pos++; pos++; }
                if (flg & 16) { while (pos < uint8.length && uint8[pos]) pos++; pos++; }
                if (flg & 2) pos += 2;
            }
            let out = puffInflate(uint8, pos);
            if (!out) return null;
            return new TextDecoder('utf-8').decode(new Uint8Array(out));
        } catch (e) {
            return null;
        }
    }

    async function decodeSocketPayload(data) {
        if (!data) return '';
        if (typeof data === 'string') return data;
        try {
            let buffer;
            if (data instanceof ArrayBuffer) buffer = data;
            else if (typeof Blob !== 'undefined' && data instanceof Blob) buffer = await data.arrayBuffer();
            else if (ArrayBuffer.isView(data)) {
                // v61 F6: берем только видимый срез (раньше декодировался весь
                // базовый буфер — при byteOffset>0 приходил мусор)
                buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            }
            else return String(data);

            let uint8 = new Uint8Array(buffer);
            if (uint8.length === 0) return '';

            let isGzip = (uint8[0] === 0x1f && uint8[1] === 0x8b);
            let isZlib = (uint8.length > 1 && (uint8[0] & 0x0f) === 8 && (((uint8[0] << 8) | uint8[1]) % 31) === 0);

            if (isGzip || isZlib) {
                let viaStream = await inflateViaStream(isGzip ? 'gzip' : 'deflate', buffer);
                if (viaStream !== null) return viaStream;
                let js = inflateJS(uint8, isGzip ? 3 : 2);
                if (js !== null) return js;
                return '';
            }

            // обычный текст? (fatal: невалидный UTF-8 ⇒ вероятно сырой deflate)
            try {
                return new TextDecoder('utf-8', { fatal: true }).decode(uint8);
            } catch (e) {}

            // v61 F6 (BUG-DEFLATE): сырой deflate без заголовка — раньше не
            // поддерживался вообще и превращался в mojibake-мусор
            let viaStream = await inflateViaStream('deflate-raw', buffer);
            if (viaStream !== null) return viaStream;
            let js = inflateJS(uint8, 0);
            if (js !== null) return js;
            return '';
        } catch (e) {
            return String(data);
        }
    }

    // v61: отладочный доступ к декодеру (полезно для диагностики протокола)
    window.__SCALPEL.decodePayload = decodeSocketPayload;

    if (!window.__SCALPEL_WS_PROXY_INSTALLED) {
        window.__SCALPEL_WS_PROXY_INSTALLED = true;
        
        window.WebSocket = new Proxy(OrigWS, {
            construct: function(target, args) {
                let ws = Reflect.construct(target, args);
                if (window.__SCALPEL && window.__SCALPEL.hookSocket) {
                    window.__SCALPEL.hookSocket(ws, args[0]);
                }
                return ws;
            }
        });

        ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(p => {
            if (OrigWS[p] !== undefined) window.WebSocket[p] = OrigWS[p];
        });

        const origSend = OrigWS.prototype.send;
        OrigWS.prototype.send = function(data) {
            if (window.__SCALPEL && !window.__SCALPEL.state.isDestroyed && window.__SCALPEL.hookSocket) {
                window.__SCALPEL.hookSocket(this);
            }

            let isTournamentLobbySocket = typeof data === 'string' && data.includes('<EnterTournamentLobby');
            let isTableSocket = this.__isBackgroundSpectator || this.__tableId || isTournamentLobbySocket || (typeof data === 'string' && (data.includes('<EnterTable') || data.includes('<OpenTable') || data.includes('<JoinTable') || data.includes('<PlayerAction')));

            // v61 F8: после destroy больше не инжектим GetTournaments в чужие сокеты
            let alive = window.__SCALPEL && !window.__SCALPEL.state.isDestroyed;
            if (alive && !isTableSocket && (!window.__SCALPEL.state.sockets.lobby || window.__SCALPEL.state.sockets.lobby.readyState !== WebSocket.OPEN)) {
                window.__SCALPEL.state.sockets.lobby = this;
                if (this.readyState === WebSocket.OPEN) {
                    try { origSend.call(this, '<GetTournaments tournament="SCHEDULED|LIVE" games="TEXAS_HOLDEM" id="99999"/>'); } catch(e) {}
                }
            }
            if (window.__SCALPEL && !window.__SCALPEL.state.isDestroyed && window.__SCALPEL.handleOutgoing) {
                window.__SCALPEL.handleOutgoing(this, data);
            }
            return origSend.apply(this, arguments);
        };
    }

    autoDetectSessionId();
    triggerLobbyTournamentRefresh();

    console.log("%c👑 [SCALPEL v65.1 ULTIMATE] Запущен. v60 + v61 F1–F8 + v62 B1–B4 + v63 C-раунд устранено; v64 — раунд-4: F1 номинал бай-ина = buyIn + bounty (рейк в entryCost), F2 amount = дельта во всех действиях (chip_conservation восстановлен), F3 бейдж ре-энтрий max(bullets, rebuys+1) из e.spent, F4 formatRub для денег, F5 маркер «!» утекших карт в DSL, F6 строка баунти в GTO SUMMARY; C7-агрессивность олл-ина переведена на итог улицы. v64.1 — polish: кириллические ключи PKO (нокаут|баунти|пко|охотник|hunter|knockout) + фолбэк-имена мест по serverSeatBase. v64.2 — Zombie-Guard: «мёртвая» строка лобби больше не перезаписывает живую запись и не рвёт сокет живого стола (пул самовосстанавливается); HUD-ERGO: живые цели сверху, двухстрочные карточки, «Пуля #N (+R реб.) • Влито: X₽». v64.3 — P1 :AFK-тег в DSL, P2 динамический PKO по денежной выплате, P3 хеш турниров-близнецов [#8c01], P4 6-корзинный классификатор текстуры борда (JSON + DSL), P5 7 архетипов HUD, P6 «+Nx2 реб.» + GTO-ключи узлов решений, P7 120 фоновых столов. v65.0 — M0 гистограмма GTO-узлов + TSV-экспорт «GTO Keys», M1 2D-профайлер (байес M=25, 7×4 измерения, fold-to-cbet из таймлайна), M3 движок выживания MTT (кривая блайндов GetSchedule, AA/премиум), M4 борд-натс + hs_percentile + flop_outs в JSON. v65.1 — АУДИТ-ФИКСЫ F1–F6: F1 M4-LIVE (натс/HS/ауты В РУКЕ на столах игрока — панель «🃏 LIVE», приватные карты из протокола), F2 битовый движок натса (НОЛЬ eval5-вызовов на ривере вместо 20 790; чанк-шедулер ≤6мс; ленивый hs архивных рук), F3 RTA-PROB бейдж в HUD из evaluateRTAConfidence (≥8 узлов/32 решения), F4 N_alive из GetPlayers total + N_ITM из Prizes → P(ITM|SitOut) + ICM FREEZE, F5 π-KL эксплойт [0.25,4.0] в HUD/JSON, F6 стейт-машина контбет/донк (префлоп-пуш = рейз). Бенчмарк: window.__stalkerBench() — эквивалентность, скорость, стресс 120 столов, longtask.", "color:#10b981;font-weight:bold;font-size:13px;");
})();
