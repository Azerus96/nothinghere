javascript:(function(){
    if (window.__ofcGodEngineV40) {
        alert('🍍 OFC God Engine v4.0 (Ghost Miner & Collapsible HUD) уже активен!');
        return;
    }
    window.__ofcGodEngineV40 = true;

    /* ══════════════════════════════════════════════════════════════════
       OFC PINEAPPLE GOD ENGINE v4.0 — TOURNAMENT GHOST SCANNER
       ══════════════════════════════════════════════════════════════════ */

    const OFC_DB = {
        activeSockets: new Map(),
        tables: new Map(),
        hands: [],
        handIds: new Set(),
        tournamentId: null,
        sessionId: null,
        deviceToken: null,
        wsUrl: null,
        autoScanEnabled: true,
        ghostSockets: new Map()
    };

    function attr(xml, name) {
        if (!xml) return null;
        let m = xml.match(new RegExp(`(?:\\b|\\s)${name}="([^"]*)"`, 'i'));
        return m ? m[1] : null;
    }

    function iattr(xml, name, def = null) {
        let v = attr(xml, name);
        if (v === null || v === undefined) return def;
        let n = parseInt(v, 10);
        return isNaN(n) ? def : n;
    }

    function parseCards(xmlStr) {
        if (!xmlStr) return [];
        let res = [];
        let re = /<Card[^>]*>([^<]+)<\/Card>/gi;
        let m;
        while ((m = re.exec(xmlStr)) !== null) {
            res.push(m[1].trim());
        }
        return res;
    }

    class TableSession {
        constructor(tableId) {
            this.tableId = tableId;
            this.tableName = 'Table';
            this.tournamentName = 'OFC Pineapple';
            this.tournamentId = null;
            this.gameType = 'OFC_PINEAPPLE_OH';
            this.fantasyMode = 'UNLIMITED_PROGRESSIVE';
            this.pointScoreChips = 100;
            this.heroSeat = null;
            this.seats = new Map();
            this.hand = null;
            this.isOFC = true;
            this.isOpen = true;
            this.lastActiveTime = Date.now();
        }

        updatePlayer(seat, nick, uuid = null) {
            if (nick && !nick.startsWith('Seat ')) {
                this.seats.set(seat, { seat, nickname: nick, uuid });
                if (this.hand && this.hand.players[seat]) {
                    this.hand.players[seat].nickname = nick;
                    if (uuid) this.hand.players[seat].uuid = uuid;
                }
            }
        }

        startHand(handId, dealer, gameNum = 1, gamesCount = 1) {
            if (!this.isOFC || !this.isOpen) return;
            let isFantasy = (gameNum > 1);
            this.hand = {
                hand_id: String(handId),
                timestamp: new Date().toISOString(),
                tournament: {
                    tournament_id: this.tournamentId,
                    tournament_name: this.tournamentName,
                    table_id: this.tableId,
                    table_name: this.tableName,
                    game_type: this.gameType,
                    fantasy_mode: this.fantasyMode,
                    has_jokers: this.gameType.includes('JOKER'),
                    point_score_chips: this.pointScoreChips
                },
                context: {
                    dealer_seat: dealer,
                    hero_seat: this.heroSeat,
                    is_fantasy_round: isFantasy,
                    game_round: gameNum,
                    total_rounds: gamesCount,
                    active_seats: Array.from(this.seats.keys())
                },
                players: {},
                showdowns: [],
                winners: []
            };

            this.seats.forEach((p, s) => {
                this.hand.players[s] = {
                    seat: s,
                    nickname: p.nickname || `Seat ${s}`,
                    uuid: p.uuid,
                    is_hero: (s === this.heroSeat),
                    is_fantasy: false,
                    fantasy_cards_count: 0,
                    streets: [],
                    discards: [],
                    final_board: { front: [], middle: [], back: [] },
                    combinations: { front: '', middle: '', back: '' },
                    royalties: { front: 0, middle: 0, back: 0, total: 0 },
                    is_foul: false,
                    foul_reason: null,
                    score_points: 0,
                    chips_delta: 0,
                    qualified_for_next_fantasy: false
                };
            });
        }

        getPlayer(seat) {
            if (!this.hand) return null;
            if (!this.hand.players[seat]) {
                let p = this.seats.get(seat) || { nickname: `Seat ${seat}`, uuid: null };
                this.hand.players[seat] = {
                    seat: seat,
                    nickname: p.nickname,
                    uuid: p.uuid,
                    is_hero: (seat === this.heroSeat),
                    is_fantasy: false,
                    fantasy_cards_count: 0,
                    streets: [],
                    discards: [],
                    final_board: { front: [], middle: [], back: [] },
                    combinations: { front: '', middle: '', back: '' },
                    royalties: { front: 0, middle: 0, back: 0, total: 0 },
                    is_foul: false,
                    foul_reason: null,
                    score_points: 0,
                    chips_delta: 0,
                    qualified_for_next_fantasy: false
                };
            }
            return this.hand.players[seat];
        }

        finalize() {
            if (!this.hand || !this.hand.hand_id || !this.isOFC) {
                this.hand = null;
                return;
            }
            let h = this.hand;

            let hasValidData = h.showdowns.length > 0 || Object.values(h.players).some(p => 
                p.final_board.front.length > 0 || p.final_board.middle.length > 0 || p.final_board.back.length > 0 || p.is_foul
            );

            if (!hasValidData) {
                this.hand = null;
                return;
            }

            let firstValid = h.showdowns.find(s => s.points > 0 && s.chips_delta > 0);
            if (firstValid) {
                let actualKush = Math.round(firstValid.chips_delta / firstValid.points);
                if (actualKush > 0) h.tournament.point_score_chips = actualKush;
            }

            h.players = Object.values(h.players);

            if (!OFC_DB.handIds.has(h.hand_id)) {
                OFC_DB.handIds.add(h.hand_id);
                OFC_DB.hands.push(h);
                updateUI();
                console.log(`%c🍍 [OFC Miner v4.0] Раздача #${h.hand_id} сохранена (${h.tournament.table_name})!`, 'color:#10b981;font-weight:bold;');
            }
            this.hand = null;
        }
    }

    function getOrCreateTable(tId) {
        if (!OFC_DB.tables.has(tId)) {
            OFC_DB.tables.set(tId, new TableSession(tId));
        }
        let t = OFC_DB.tables.get(tId);
        t.isOpen = true;
        t.lastActiveTime = Date.now();
        return t;
    }

    function getSessionForSocket(ws, xml) {
        if (ws.__ofcSession) {
            ws.__ofcSession.lastActiveTime = Date.now();
            return ws.__ofcSession;
        }
        let tId = attr(xml, 'id') || attr(xml, 'tableId');
        if (tId && tId.startsWith('f54-')) {
            ws.__ofcSession = getOrCreateTable(tId);
            return ws.__ofcSession;
        }
        return null;
    }

    function parseMessage(xml, ws) {
        if (!xml || typeof xml !== 'string' || !xml.startsWith('<')) return;

        /* Перехват реквизитов авторизации для фонового майнера */
        if (xml.includes('sessionId=')) OFC_DB.sessionId = attr(xml, 'sessionId') || OFC_DB.sessionId;
        if (xml.includes('deviceToken=')) OFC_DB.deviceToken = attr(xml, 'deviceToken') || OFC_DB.deviceToken;
        if (xml.includes('tournamentId=')) OFC_DB.tournamentId = attr(xml, 'tournamentId') || OFC_DB.tournamentId;

        /* Обнаружение закрытия стола */
        if (xml.includes('<CloseTable') || xml.includes('<LeaveTable')) {
            let tId = attr(xml, 'id') || attr(xml, 'tableId');
            if (ws.__ofcSession) ws.__ofcSession.isOpen = false;
            if (tId && OFC_DB.tables.has(tId)) OFC_DB.tables.get(tId).isOpen = false;
            updateUI();
        }

        /* 1. Детали стола */
        if (xml.includes('<TableDetails') || xml.includes('<TournamentTable')) {
            let tId = attr(xml, 'id') || attr(xml, 'tableId');
            if (tId && tId.startsWith('f54-')) {
                let table = getOrCreateTable(tId);
                ws.__ofcSession = table;
                let gType = attr(xml, 'game') || '';
                table.isOFC = gType.includes('OFC') || gType.includes('PINEAPPLE');
                if (!table.isOFC) return;

                table.tournamentName = attr(xml, 'tournamentName') || attr(xml, 'name') || table.tournamentName;
                table.tournamentId = attr(xml, 'tournamentId') || table.tournamentId;
                table.tableName = attr(xml, 'name') || table.tableName;
                table.gameType = gType || table.gameType;
                table.fantasyMode = attr(xml, 'fantasy') || table.fantasyMode;
                table.pointScoreChips = iattr(xml, 'pointScore', table.pointScoreChips);

                let seatMatches = xml.matchAll(/<Seat\s+[^>]*?\bid="(\d+)"[^>]*?>[\s\S]*?<PlayerInfo\s+[^>]*?\bnickname="([^"]+)"(?:[^>]*?\buuid="([^"]+)")?/gi);
                for (let sm of seatMatches) {
                    table.updatePlayer(parseInt(sm[1], 10), sm[2], sm[3]);
                }
                updateUI();
            }
        }

        /* Сканирование новых столов турнира из лобби */
        if (xml.includes('<Tables') && OFC_DB.autoScanEnabled) {
            let tMatches = xml.matchAll(/<Table\s+[^>]*?\bid="(f54-[^"]+)"/gi);
            for (let tm of tMatches) {
                let foundTableId = tm[1];
                if (!OFC_DB.tables.has(foundTableId) || !OFC_DB.tables.get(foundTableId).isOpen) {
                    launchGhostSpectator(foundTableId);
                }
            }
        }

        let table = getSessionForSocket(ws, xml);
        if (!table || !table.isOFC || !table.isOpen) return;

        /* 2. Обновление куша */
        let scoreMatch = xml.match(/(?:<CurrentLevel|<PlayerStackAdjusted|<Parameters|<HandInfo)\s+[^>]*?\bpointScore="(\d+)"/i);
        if (scoreMatch) {
            let ps = parseInt(scoreMatch[1], 10);
            table.pointScoreChips = ps;
            if (table.hand && !table.hand.context.is_fantasy_round) {
                table.hand.tournament.point_score_chips = ps;
            }
        }

        /* 3. Hero Seat */
        let meMatch = xml.match(/<Seats\s+[^>]*?\bme="(\d+)"/i);
        if (meMatch) {
            table.heroSeat = parseInt(meMatch[1], 10);
            if (table.hand) table.hand.context.hero_seat = table.heroSeat;
        }

        /* 4. Ники игроков */
        let npMatches = xml.matchAll(/(?:<NewPlayer|<PlayerInfo|<Player)\s+[^>]*?\bseat="(\d+)"[^>]*?\bnickname="([^"]+)"(?:[^>]*?\buuid="([^"]+)")?/gi);
        for (let npm of npMatches) {
            table.updatePlayer(parseInt(npm[1], 10), npm[2], npm[3]);
        }

        /* 5. Старт руки */
        let nhM = xml.match(/<NewHand\s+([^>]*?)\/>/i);
        let gsM = xml.match(/<GameState\s+([^>]*?)\bhand="(\d+)"/i);
        if (nhM || gsM) {
            let hId = nhM ? attr(nhM[1], 'number') : gsM[2];
            let dealer = nhM ? iattr(nhM[1], 'dealer', 0) : iattr(xml, 'dealer', 0);
            let gNum = nhM ? iattr(nhM[1], 'gameNumber', 1) : 1;
            let gCnt = nhM ? iattr(nhM[1], 'gamesCount', 1) : 1;
            table.startHand(hId, dealer, gNum, gCnt);
        }

        if (!table.hand) return;

        /* 6. Сдача карт */
        let dealMatches = xml.matchAll(/<DealingCards(?:\s+[^>]*?\bstreet="(\d+)")?[^>]*?>([\s\S]*?)<\/DealingCards>/gi);
        for (let dm of dealMatches) {
            let stNum = dm[1] ? parseInt(dm[1], 10) : 1;
            let sMatches = dm[2].matchAll(/<Seat\s+[^>]*?\bid="(\d+)"[^>]*?>\s*<Cards>([\s\S]*?)<\/Cards>\s*<\/Seat>/gi);
            for (let sm of sMatches) {
                let sn = parseInt(sm[1], 10);
                let cards = parseCards(sm[2]);
                let p = table.getPlayer(sn);
                if (p) {
                    if (cards.length > 5) {
                        p.is_fantasy = true;
                        p.fantasy_cards_count = cards.length;
                        stNum = 0;
                    }
                    p.streets.push({
                        street: stNum,
                        street_name: p.is_fantasy ? `fantasy_deal_${cards.length}_cards` : `street_${stNum}`,
                        dealt_cards: cards,
                        placed: { front: [], middle: [], back: [] },
                        discarded: []
                    });
                }
            }
        }

        /* 7. Выставление карт и сбросы */
        let paMatches = xml.matchAll(/<PlayerAction\s+[^>]*?\bseat="(\d+)"[^>]*?>([\s\S]*?)<\/PlayerAction>/gi);
        for (let pam of paMatches) {
            let sn = parseInt(pam[1], 10);
            let body = pam[2];
            let p = table.getPlayer(sn);
            if (p && body.includes('<LayOut')) {
                let discM = body.match(/<Discarded>([\s\S]*?)<\/Discarded>/i);
                let discards = discM ? parseCards(discM[1]) : [];
                if (discards.length > 0) p.discards.push(...discards);

                let placed = { front: [], middle: [], back: [] };
                ['FRONT', 'MIDDLE', 'BACK'].forEach(row => {
                    let rM = body.match(new RegExp(`<Hand\\s+[^>]*?\\bname="${row}"[^>]*?>([\\s\\S]*?)<\\/Hand>`, 'i'));
                    if (rM) placed[row.toLowerCase()] = parseCards(rM[1]);
                });

                if (p.streets.length > 0) {
                    let latest = p.streets[p.streets.length - 1];
                    latest.placed = placed;
                    latest.discarded = discards;
                }
            }
        }

        /* 8. Комбинации, Роялти, Джокеры и Доска */
        let ccMatches = xml.matchAll(/<CombinationChange\s+([^>]*?)>([\s\S]*?)<\/CombinationChange>/gi);
        for (let ccm of ccMatches) {
            let cAttr = ccm[1];
            let cBody = ccm[2];
            let sn = iattr(cAttr, 'seat');
            let p = table.getPlayer(sn);
            if (p) {
                if (cAttr.includes('dead="true"')) {
                    p.is_foul = true;
                    p.foul_reason = 'Misplacement: Row strength hierarchy violation (Top <= Middle <= Bottom)';
                }

                ['FRONT', 'MIDDLE', 'BACK'].forEach(row => {
                    let rowM = cBody.match(new RegExp(`<Hand\\s+([^>]*?\\bname="${row}"[^>]*?)>([\\s\\S]*?)<\\/Hand>`, 'i'));
                    if (rowM) {
                        let hAttr = rowM[1];
                        let cards = parseCards(rowM[2]);
                        let rowKey = row.toLowerCase();
                        if (cards.length > 0) p.final_board[rowKey] = cards;
                        
                        let roy = iattr(hAttr, 'royalty', 0);
                        let str = attr(hAttr, 'strength') || '';
                        p.royalties[rowKey] = roy;
                        if (str) p.combinations[rowKey] = str;
                    }
                });
                p.royalties.total = p.royalties.front + p.royalties.middle + p.royalties.back;
            }
        }

        /* 9. Шоудаун */
        let sdMatches = xml.matchAll(/<Showdown\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/Showdown>)/gi);
        for (let sdm of sdMatches) {
            let sAttr = sdm[1];
            let sBody = sdm[2] || '';
            let lineDetails = {};
            ['FRONT', 'MIDDLE', 'BACK'].forEach(row => {
                let lm = sBody.match(new RegExp(`<Hand\\s+[^>]*?\\bname="${row}"([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/Hand>)`, 'i'));
                if (lm) {
                    let lhAttr = lm[1];
                    lineDetails[row.toLowerCase()] = {
                        points: iattr(lhAttr, 'points', 0),
                        royalty: iattr(lhAttr, 'royalty', 0)
                    };
                }
            });
            table.hand.showdowns.push({
                winner_seat: iattr(sAttr, 'firstSeat'),
                loser_seat: iattr(sAttr, 'secondSeat'),
                points: iattr(sAttr, 'points', 0),
                is_scoop: iattr(sAttr, 'scoop', 0) > 0,
                chips_delta: iattr(sAttr, 'cash', 0),
                lines: lineDetails
            });
        }

        /* 10. Победители и квалификация в Фантазию */
        let winMatches = xml.matchAll(/<Winner\s+([^>]*?)\/>/gi);
        for (let wm of winMatches) {
            let wAttr = wm[1];
            let sn = iattr(wAttr, 'seat');
            let score = iattr(wAttr, 'score', 0);
            let amt = iattr(wAttr, 'amount', 0);
            let isFant = wAttr.includes('fantasy="true"');

            let p = table.getPlayer(sn);
            if (p) {
                p.score_points = score;
                p.chips_delta = amt;
                p.qualified_for_next_fantasy = isFant;
            }

            table.hand.winners.push({
                seat: sn,
                score_points: score,
                chips_delta: amt,
                fantasy_qualified: isFant
            });
        }

        /* 11. Финализация раздачи */
        if (xml.includes('<EndHand')) {
            table.finalize();
        }
    }

    /* ══════════════════════════════════════════════════════════════════
       TOURNAMENT GHOST SPECTATOR (ФОНОВЫЙ МАЙНЕР ВСЕХ СТОЛОВ)
       ══════════════════════════════════════════════════════════════════ */
    function launchGhostSpectator(tableId) {
        if (!OFC_DB.wsUrl || !OFC_DB.sessionId || OFC_DB.ghostSockets.has(tableId)) return;
        try {
            let gws = new NativeWebSocket(OFC_DB.wsUrl);
            OFC_DB.ghostSockets.set(tableId, gws);

            gws.onopen = function() {
                let enterMsg = `<EnterTable sessionId="${OFC_DB.sessionId}" tableId="${tableId}" tournamentId="${OFC_DB.tournamentId || ''}" client="html5mobile" clientFace="pokerdom" deviceToken="${OFC_DB.deviceToken || ''}"/>`;
                gws.send(enterMsg);
            };

            gws.onmessage = function(e) {
                let text = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data);
                parseMessage(text, gws);
            };

            gws.onclose = function() {
                OFC_DB.ghostSockets.delete(tableId);
                if (OFC_DB.tables.has(tableId)) OFC_DB.tables.get(tableId).isOpen = false;
                updateUI();
            };
        } catch(err) {
            console.error('[Ghost Spectator Error]', err);
        }
    }

    /* ══════════════════════════════════════════════════════════════════
       WEBSOCKET PROXY INTERCEPTOR
       ══════════════════════════════════════════════════════════════════ */
    let NativeWebSocket = window.WebSocket;
    window.WebSocket = new Proxy(NativeWebSocket, {
        construct(target, args) {
            let ws = Reflect.construct(target, args);
            if (args[0]) OFC_DB.wsUrl = args[0];

            ws.addEventListener('message', function(e) {
                try {
                    let text = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data);
                    parseMessage(text, ws);
                } catch(err) {
                    console.error('[OFC Engine Error]', err);
                }
            });

            ws.addEventListener('close', function() {
                if (ws.__ofcSession) {
                    ws.__ofcSession.isOpen = false;
                    updateUI();
                }
            });

            return ws;
        }
    });

    /* ══════════════════════════════════════════════════════════════════
       COLLAPSIBLE MOBILE HUD UI (С КНОПКОЙ СВОРАЧИВАНИЯ ▾/▸)
       ══════════════════════════════════════════════════════════════════ */
    let hud = document.createElement('div');
    hud.id = 'ofc-god-hud-v40';
    hud.style.cssText = 'position:fixed;top:10px;right:10px;z-index:999999999;background:rgba(15,23,42,0.95);backdrop-filter:blur(10px);border:1px solid rgba(16,185,129,0.5);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,0.85);color:#f8fafc;font-family:ui-monospace,monospace;font-size:12px;user-select:none;transition:all 0.25s ease;';

    hud.innerHTML = `
        <div id="ofc-hud-header" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;cursor:pointer;gap:8px;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span id="ofc-hud-toggle-icon" style="color:#10b981;font-weight:900;font-size:13px;">▾</span>
                <span style="font-weight:900;color:#10b981;font-size:12px;">🍍 OFC MINER v4.0</span>
            </div>
            <span id="ofc-badge-hands-40" style="background:#047857;color:#ecfdf5;padding:2px 8px;border-radius:999px;font-weight:700;font-size:11px;">0 рук</span>
        </div>
        <div id="ofc-hud-body" style="padding:0 14px 12px 14px;display:block;">
            <div style="font-size:11px;color:#94a3b8;margin-bottom:10px;line-height:1.6;">
                <div>Активных столов: <b id="ofc-badge-tables-40" style="color:#38bdf8;">0</b></div>
                <div>Фоновых майнеров: <b id="ofc-badge-ghosts-40" style="color:#f59e0b;">0</b></div>
                <div>Статус: <b id="ofc-badge-status-40" style="color:#a78bfa;">Авто-сканер активен</b></div>
            </div>
            <div style="display:flex;gap:6px;">
                <button id="ofc-btn-save-40" style="flex:1;background:linear-gradient(135deg,#059669,#10b981);color:#fff;border:none;padding:7px 10px;border-radius:6px;font-weight:700;cursor:pointer;">💾 JSON</button>
                <button id="ofc-btn-clip-40" style="background:#334155;color:#fff;border:none;padding:7px 10px;border-radius:6px;font-weight:700;cursor:pointer;">📋 Копия</button>
            </div>
        </div>
    `;
    document.body.appendChild(hud);

    let isCollapsed = false;
    document.getElementById('ofc-hud-header').onclick = function() {
        isCollapsed = !isCollapsed;
        let body = document.getElementById('ofc-hud-body');
        let icon = document.getElementById('ofc-hud-toggle-icon');
        if (isCollapsed) {
            body.style.display = 'none';
            icon.innerText = '▸';
            hud.style.borderRadius = '999px';
        } else {
            body.style.display = 'block';
            icon.innerText = '▾';
            hud.style.borderRadius = '12px';
        }
    };

    function updateUI() {
        let bHands = document.getElementById('ofc-badge-hands-40');
        let bTables = document.getElementById('ofc-badge-tables-40');
        let bGhosts = document.getElementById('ofc-badge-ghosts-40');
        
        let activeOFC = Array.from(OFC_DB.tables.values()).filter(t => t.isOFC && t.isOpen).length;
        if (bHands) bHands.innerText = `${OFC_DB.hands.length} рук`;
        if (bTables) bTables.innerText = `${activeOFC}`;
        if (bGhosts) bGhosts.innerText = `${OFC_DB.ghostSockets.size}`;
    }

    function exportPayload() {
        return {
            version: '4.0-OFC-TOURNAMENT-DATASET',
            currency: 'TOURNAMENT_CHIPS',
            exported_at: new Date().toISOString(),
            total_hands_count: OFC_DB.hands.length,
            hands: OFC_DB.hands
        };
    }

    document.getElementById('ofc-btn-save-40').onclick = function(e) {
        e.stopPropagation();
        let blob = new Blob([JSON.stringify(exportPayload(), null, 2)], { type: 'application/json' });
        let a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `pokerdom_ofc_miner_v4_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    document.getElementById('ofc-btn-clip-40').onclick = function(e) {
        e.stopPropagation();
        navigator.clipboard.writeText(JSON.stringify(exportPayload(), null, 2)).then(() => {
            alert('🍍 Полный турнирный датасет v4.0 скопирован в буфер обмена!');
        });
    };

    console.log('%c🍍 [OFC God Engine v4.0] Активирован. Фоновый авто-майнер и сворачиваемый HUD запущены.', 'color:#10b981;font-weight:bold;font-size:13px;');
})();
