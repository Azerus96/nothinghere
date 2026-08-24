javascript:(function(){
    if (window.__pokerSyncV31) {
        alert('✅ MASTER SYNC HUD v31.0 уже активен!');
        return;
    }
    window.__pokerSyncV31 = true;

    /* ══════════════════════════════════════════════════════════════════
       MASTER SYNC HUD v31.0 — ZERO-DRIFT HAND LEVEL LOCK ENGINE
       ══════════════════════════════════════════════════════════════════ */

    'use strict';
    var SYNC_ENGINE_VERSION = 'v31.0-PRO-SYNC';

    function attr(str, name) {
        if (!str) return null;
        var m = str.match(new RegExp(name + '="([^"]*)"'));
        return m ? m[1] : null;
    }
    function iattr(str, name) {
        var v = attr(str, name);
        return v === null || v === '' ? null : parseInt(v, 10);
    }
    function decodeHtml(s) {
        return s ? String(s).replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>') : '';
    }

    var SEAT_BLOCK_RE = /<Seat\s+([^>]*?\bid="(\d+)"[^>]*?)(?:\/>|>([\s\S]*?)<\/Seat>)/g;
    var CARD_RE = /<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi;
    var ACTION_RE = /<PlayerAction\s+seat="(\d+)"[^>]*>([\s\S]*?)<\/PlayerAction>/g;

    function createTableContext() {
        return {
            id: null, name: null, tournamentId: null, tournamentName: null,
            level: { sb: 0, bb: 0, ante: 0, number: null, remaining: null },
            nextLevel: null,
            seats: {},
            hand: null, dealer: null,
            board: [], street: 'PREFLOP',
            activeSeats: {},
            dealtSeats: {},
            positions: {},
            potSwept: 0,
            winnerSum: 0,
            winners: [],
            showdownCards: {},
            handStart: {},
            handOrigin: null,
            handLevel: null,
            lastSyncReport: null,
            handsCompleted: 0,
            syncFails: 0,
            sawFullSeats: false
        };
    }

    function ensureSeat(ctx, seatNum, nick) {
        if (!ctx.seats[seatNum]) {
            ctx.seats[seatNum] = {
                seat: seatNum, nick: nick || ('Seat ' + seatNum), stack: null, streetBet: 0,
                inHand: false, busted: false, vacated: false, lastSeen: Date.now()
            };
        }
        if (nick && (!ctx.seats[seatNum].nick || ctx.seats[seatNum].nick.indexOf('Seat ') === 0)) {
            ctx.seats[seatNum].nick = nick;
        }
        return ctx.seats[seatNum];
    }

    function getActiveHandBB(ctx) {
        if (ctx.hand && ctx.handLevel && ctx.handLevel.bb > 0) {
            return ctx.handLevel.bb;
        }
        return ctx.level.bb || 0;
    }

    function liveStackBB(ctx, chips) {
        var bb = getActiveHandBB(ctx);
        return (bb > 0 && chips !== null) ? Math.round((chips / bb) * 100) / 100 : null;
    }

    function calcPositions(activeList, dealerSeat) {
        var seats = activeList.slice().sort(function (a, b) { return a - b; });
        var n = seats.length, map = {};
        if (!n) return map;
        var dIdx = seats.indexOf(dealerSeat);
        if (dIdx === -1) dIdx = 0;
        var ordered = [];
        for (var i = 0; i < n; i++) ordered.push(seats[(dIdx + i) % n]);
        
        if (n === 2) {
            map[ordered[0]] = 'BTN/SB'; map[ordered[1]] = 'BB';
        } else if (n === 3) {
            map[ordered[0]] = 'BTN'; map[ordered[1]] = 'SB'; map[ordered[2]] = 'BB';
        } else {
            map[ordered[0]] = 'BTN'; map[ordered[1]] = 'SB'; map[ordered[2]] = 'BB';
            var namedBack = { 1: 'CO', 2: 'HJ', 3: 'LJ', 4: 'MP' };
            for (var idx = 3; idx < n; idx++) {
                var distFromEnd = n - idx;
                if (namedBack[distFromEnd] && distFromEnd <= 3) {
                    map[ordered[idx]] = namedBack[distFromEnd];
                } else {
                    var utgOffset = idx - 3;
                    map[ordered[idx]] = utgOffset === 0 ? 'UTG' : ('UTG+' + utgOffset);
                }
            }
        }
        return map;
    }

    function parseCards(str) {
        var out = [], m;
        CARD_RE.lastIndex = 0;
        while ((m = CARD_RE.exec(str)) !== null) out.push(m[1] + m[2]);
        return out;
    }

    function setLevelFromTag(ctx, tagStr) {
        var bb = iattr(tagStr, 'highStake'), sb = iattr(tagStr, 'lowStake'),
            an = iattr(tagStr, 'ante'), num = iattr(tagStr, 'number');
        if (bb !== null && bb > 0) {
            ctx.level.bb = bb;
            ctx.level.sb = sb !== null ? sb : Math.round(bb / 2);
            ctx.level.ante = an !== null ? an : 0;
            if (num !== null) ctx.level.number = num;
            if (!ctx.hand || !ctx.handLevel || !ctx.handLevel.bb) {
                ctx.handLevel = { sb: ctx.level.sb, bb: ctx.level.bb, ante: ctx.level.ante, number: ctx.level.number };
            }
        }
    }

    function syncSeatsFromSnapshot(ctx, xml, isGameState) {
        var m, report = { seq: Date.now(), isGameState: isGameState, diffs: [], applied: 0 };
        SEAT_BLOCK_RE.lastIndex = 0;
        while ((m = SEAT_BLOCK_RE.exec(xml)) !== null) {
            var seatNum = parseInt(m[2], 10), body = m[3] || '';
            var piM = body.match(/<PlayerInfo[^>]*>/);
            var chipsM = body.match(/<Chips[^>]*\/>/);
            if (piM && chipsM) {
                var nick = attr(piM[0], 'nickname');
                var sz = iattr(chipsM[0], 'stack-size'), bet = iattr(chipsM[0], 'bet') || 0;
                if (sz === null) continue;
                var s = ensureSeat(ctx, seatNum, nick);
                if (s.stack !== null && s.stack !== sz) {
                    report.diffs.push({ seat: seatNum, nick: nick, model: s.stack, server: sz, delta: s.stack - sz });
                }
                s.stack = sz; s.streetBet = bet; s.busted = false; s.vacated = false;
                s.inHand = /activeInHand="true"/.test(m[1]) || (isGameState && bet > 0);
                report.applied++;
            }
        }
        ctx.lastSyncReport = report.diffs.length ? report : { diffs: [], applied: report.applied, isGameState: isGameState };
        return report;
    }

    function beginHand(ctx, handNum, dealerSeat, activeSeatsList) {
        ctx.hand = handNum;
        ctx.dealer = dealerSeat;
        ctx.board = [];
        ctx.street = 'PREFLOP';
        ctx.potSwept = 0;
        ctx.winnerSum = 0;
        ctx.winners = [];
        ctx.showdownCards = {};
        ctx.handStart = {};
        ctx.activeSeats = {};
        ctx.dealtSeats = {};
        /* Фиксируем уровень строго для этой раздачи */
        ctx.handLevel = { sb: ctx.level.sb, bb: ctx.level.bb, ante: ctx.level.ante, number: ctx.level.number };
        for (var seatNum in ctx.seats) {
            var s = ctx.seats[seatNum];
            s.streetBet = 0;
            s.inHand = false;
            if (s.busted || s.vacated) continue;
            s.handActions = [];
        }
        for (var i = 0; i < activeSeatsList.length; i++) {
            var sn = activeSeatsList[i];
            ensureSeat(ctx, sn, null);
            ctx.activeSeats[sn] = true;
            ctx.dealtSeats[sn] = true;
            ctx.seats[sn].inHand = true;
            ctx.seats[sn].handActions = [];
            ctx.handStart[sn] = ctx.seats[sn].stack;
        }
        ctx.positions = calcPositions(activeSeatsList, dealerSeat);
    }

    function streetBetTotal(ctx) {
        var t = 0;
        for (var sn in ctx.seats) { var b = ctx.seats[sn].streetBet || 0; if (b > 0) t += b; }
        return t;
    }
    function displayPot(ctx) { return ctx.potSwept + streetBetTotal(ctx); }

    function applyChipAction(ctx, seatNum, kind, amount) {
        var s = ensureSeat(ctx, seatNum, null);
        if (!amount) return;
        if (s.stack === null) s.stack = 0;
        
        if (kind === 'PostAnte') {
            s.stack -= amount;
            if (!ctx.handLevel || !ctx.handLevel.ante) { ctx.level.ante = amount; if (ctx.handLevel) ctx.handLevel.ante = amount; }
        } else if (kind === 'PostSmallBlind') {
            s.stack -= amount; s.streetBet = amount;
            if (!ctx.handLevel || !ctx.handLevel.sb) { ctx.level.sb = amount; if (ctx.handLevel) ctx.handLevel.sb = amount; }
        } else if (kind === 'PostBigBlind') {
            s.stack -= amount; s.streetBet = amount;
            if (!ctx.handLevel || !ctx.handLevel.bb) { ctx.level.bb = amount; if (ctx.handLevel) ctx.handLevel.bb = amount; }
        } else if (kind === 'Bet') {
            s.stack -= amount; s.streetBet = amount;
        } else if (kind === 'Raise') {
            s.stack -= amount; s.streetBet = (s.streetBet || 0) + amount;
        } else if (kind === 'Call' || kind === 'AllIn') {
            s.stack -= amount; s.streetBet = (s.streetBet || 0) + amount;
        } else if (kind === 'UncalledBet') {
            s.stack += amount;
            s.streetBet = Math.max(0, (s.streetBet || 0) - amount);
        }
    }

    function recordAction(ctx, seatNum, label, amount) {
        var s = ensureSeat(ctx, seatNum, null);
        if (!s.handActions) s.handActions = [];
        var str = ctx.street + '_' + label;
        if (amount) {
            var pot = displayPot(ctx);
            str += ':' + amount + (pot > 0 ? '(' + Math.round(amount / pot * 100) + '%pot)' : '');
        }
        s.handActions.push(str);
    }

    function processTableMessage(ctx, xml, meta) {
        if (!xml || typeof xml !== 'string') return [];
        xml = xml.trim();
        if (xml.charAt(0) !== '<') return [];
        var trace = [];

        if (/^<(ClientAppearanceConfig|TableAttributes|TablesTags|Tables |MyTables|MyTournaments|Tournaments |QuickSeatBlocks|ServerInfo|HudConfig)/.test(xml)) {
            return trace;
        }

        if (/<TableDetails/.test(xml)) {
            var tdMatch = xml.match(/<TableDetails[^>]*>/);
            if (tdMatch) {
                var tdId = attr(tdMatch[0], 'id');
                var tdName = decodeHtml(attr(tdMatch[0], 'name') || '');
                if (tdId) ctx.id = tdId;
                if (tdName && (!ctx.name || ctx.name === 'Стол')) ctx.name = tdName;
            }
            var tt = xml.match(/<TournamentTable[^>]*>/);
            if (tt) {
                var tn = attr(tt[0], 'tournamentName');
                if (tn) ctx.tournamentName = decodeHtml(tn);
                var tId = attr(tt[0], 'id') || ctx.id;
                if (tId) ctx.id = tId;
            }
            var par = xml.match(/<Parameters[^>]*\/>/);
            if (par) setLevelFromTag(ctx, par[0]);
            if (/<Seats/.test(xml)) {
                syncSeatsFromSnapshot(ctx, xml, false);
                ctx.sawFullSeats = true;
                trace.push('SYNC:TableDetails seats=' + Object.keys(ctx.seats).length);
            }
            return trace;
        }

        var gsM = xml.match(/<GameState\s+([^>]*)>/);
        if (gsM) {
            var gh = attr(gsM[0], 'hand');
            var hi = xml.match(/<HandInfo[^>]*\/>/);
            if (hi) setLevelFromTag(ctx, hi[0]);
            var seatsTag = xml.match(/<Seats\s+([^>]*)>/);
            var gsDealer = seatsTag ? iattr(seatsTag[0], 'dealer') : null;
            var rep = syncSeatsFromSnapshot(ctx, xml, true);
            trace.push('SYNC:GameState' + (rep.diffs.length ? ' DRIFT[' + rep.diffs.length + ']' : ' OK'));
            if (gh && (!ctx.hand || ctx.hand !== gh)) {
                var actList = [];
                SEAT_BLOCK_RE.lastIndex = 0;
                var mm;
                while ((mm = SEAT_BLOCK_RE.exec(xml)) !== null) {
                    if (/activeInHand="true"/.test(mm[1]) && mm[3] && /<PlayerInfo/.test(mm[3])) actList.push(parseInt(mm[2], 10));
                }
                beginHand(ctx, gh, gsDealer === null ? 0 : gsDealer, actList);
                ctx.handOrigin = 'midhand-sync';
            } else if (gsDealer !== null) {
                ctx.dealer = gsDealer;
            }
            var boardM = xml.match(/<Board>([\s\S]*?)<\/Board>/);
            if (boardM) {
                var bc = parseCards(boardM[1]);
                if (bc.length >= 3) {
                    ctx.board = bc;
                    ctx.street = bc.length >= 5 ? 'RIVER' : (bc.length === 4 ? 'TURN' : 'FLOP');
                }
            }
            var potsM = xml.match(/<Pots>([\s\S]*?)<\/Pots>/);
            if (potsM) {
                var swept = 0, pm;
                var potRe = /<Pot[^>]*amount="(\d+)"[^>]*\/>/g;
                while ((pm = potRe.exec(potsM[1])) !== null) swept += parseInt(pm[1], 10);
                ctx.potSwept = Math.max(0, swept - streetBetTotal(ctx));
            }
            var ti = xml.match(/<TournamentInfo[\s\S]*?<\/TournamentInfo>/);
            if (ti) processTournamentInfo(ctx, ti[0]);
            return trace;
        }

        var newHandM = xml.match(/<NewHand\s+([^>]*)\/>/);
        if (newHandM) {
            var handNum = attr(newHandM[0], 'number');
            var dealer = iattr(newHandM[0], 'dealer') || 0;
            var actSeats = [];
            var asM = xml.match(/<ActiveSeats>([\s\S]*?)<\/ActiveSeats>/);
            if (asM) {
                var sm, asRe = /<Seat\s+id="(\d+)"/g;
                while ((sm = asRe.exec(asM[1])) !== null) actSeats.push(parseInt(sm[1], 10));
            }
            beginHand(ctx, handNum, dealer, actSeats);
            ctx.handOrigin = 'newhand';
            trace.push('NEWHAND:' + handNum + ' dealer=' + dealer);
        }

        var am;
        ACTION_RE.lastIndex = 0;
        while ((am = ACTION_RE.exec(xml)) !== null) {
            var seatNum = parseInt(am[1], 10);
            var body = am[2];
            var inner = body.match(/^<(\w+)([^>]*)\/?>/) || body.match(/^<(\w+)([^>]*)>/);
            if (!inner) continue;
            var kind = inner[1], aStr = inner[2];
            var amount = iattr(aStr, 'amount') || 0;

            if (kind === 'PostAnte' || kind === 'PostSmallBlind' || kind === 'PostBigBlind' ||
                kind === 'Bet' || kind === 'Raise' || kind === 'Call' || kind === 'AllIn') {
                applyChipAction(ctx, seatNum, kind, amount);
                recordAction(ctx, seatNum,
                    kind === 'PostAnte' ? 'ANTE' :
                    kind === 'PostSmallBlind' ? 'SB' :
                    kind === 'PostBigBlind' ? 'BB' : kind.toUpperCase(),
                    amount);
                trace.push('ACT:' + kind + ' seat' + seatNum + ' ' + amount);
            } else if (kind === 'UncalledBet') {
                applyChipAction(ctx, seatNum, 'UncalledBet', amount);
                trace.push('UNCALLED: seat' + seatNum + ' +' + amount);
            } else if (kind === 'Fold') {
                delete ctx.activeSeats[seatNum];
                if (ctx.seats[seatNum]) ctx.seats[seatNum].inHand = false;
                recordAction(ctx, seatNum, 'FOLD', 0);
                trace.push('ACT:FOLD seat' + seatNum);
            } else if (kind === 'Check') {
                recordAction(ctx, seatNum, 'CHECK', 0);
            } else if (kind === 'Show') {
                var cards = parseCards(body);
                var comb = attr(aStr, 'combination') || '';
                if (cards.length >= 2) {
                    ctx.showdownCards[seatNum] = { cards: cards.slice(0, 2).join(' '), isMuck: false, combination: decodeHtml(comb) };
                }
            } else if (kind === 'Muck') {
                var mc = parseCards(body);
                ctx.showdownCards[seatNum] = ctx.showdownCards[seatNum] ||
                    { cards: mc.length >= 2 ? mc.slice(0, 2).join(' ') : null, isMuck: true, combination: '' };
                if (ctx.showdownCards[seatNum] && !ctx.showdownCards[seatNum].isMuck) ctx.showdownCards[seatNum].isMuck = true;
            }
        }

        var pcM, pcRe = /<PotsChange>([\s\S]*?)<\/PotsChange>/g;
        while ((pcM = pcRe.exec(xml)) !== null) {
            var potM, potEntryRe = /<Pot\s+([^>]*)\/>/g;
            while ((potM = potEntryRe.exec(pcM[1])) !== null) {
                var pSeat = iattr(potM[1], 'seat'), pChange = iattr(potM[1], 'change');
                if (pChange === null || pChange <= 0) continue;
                ctx.potSwept += pChange;
                var ps = ctx.seats[pSeat];
                if (ps && ps.streetBet === pChange) ps.streetBet = 0;
            }
            trace.push('POTS swept=' + ctx.potSwept);
        }

        var streets = [['DealingFlop', 'FLOP', 3], ['DealingTurn', 'TURN', 4], ['DealingRiver', 'RIVER', 5]];
        for (var si = 0; si < streets.length; si++) {
            var tag = streets[si][0], sName = streets[si][1], maxCount = streets[si][2];
            var stM = xml.match(new RegExp('<' + tag + '>[\\s\\S]*?<\\/' + tag + '>'));
            if (stM) {
                var fc = parseCards(stM[0]);
                ctx.street = sName;
                for (var ssn in ctx.seats) ctx.seats[ssn].streetBet = 0;
                if (fc.length) {
                    if (sName === 'FLOP') {
                        ctx.board = fc.slice(0, 3);
                    } else if (ctx.board.length < maxCount) {
                        while (ctx.board.length < maxCount - 1) ctx.board.push('??');
                        ctx.board.push(fc[fc.length - 1]);
                    }
                }
                trace.push('STREET:' + sName);
            }
        }

        var dcM = xml.match(/<DealingCards>([\s\S]*?)<\/DealingCards>/);
        if (dcM) {
            var dSeatRe = /<Seat\s+id="(\d+)">([\s\S]*?)<\/Seat>/g, dsm;
            while ((dsm = dSeatRe.exec(dcM[1])) !== null) {
                var sId = parseInt(dsm[1], 10);
                ensureSeat(ctx, sId, null);
                var hc = parseCards(dsm[2]);
                if (hc.length >= 2 && hc[0] !== 'xx') {
                    ctx.holeCardsNow = ctx.holeCardsNow || {};
                    ctx.holeCardsNow[sId] = hc.slice(0, 2).join(' ');
                }
            }
        }

        var wM, wRe = /<Winner\s+([^>]*)>([\s\S]*?)<\/Winner>|<Winner\s+([^>]*)\/>/g;
        while ((wM = wRe.exec(xml)) !== null) {
            var wAttr = wM[1] || wM[3] || '';
            var wSeat = iattr(wAttr, 'seat'), wAmt = iattr(wAttr, 'amount') || 0;
            var wComb = decodeHtml(attr(wAttr, 'combination') || '');
            var wCards = parseCards(wM[2] || '').slice(0, 5).join(' ');
            if (wSeat !== null && wAmt > 0) {
                var ws2 = ensureSeat(ctx, wSeat, null);
                if (ws2.stack === null) ws2.stack = 0;
                ws2.stack += wAmt;
                ctx.winnerSum += wAmt;
                ctx.winners.push({ seat: wSeat, amount: wAmt, combination: wComb, cards: wCards });
                trace.push('WIN: seat' + wSeat + ' +' + wAmt.toLocaleString());
            }
        }

        var koM = xml.match(/<Knockout\s+([^>]*)busted="(\d+)"/);
        if (koM) {
            var bSeat = parseInt(koM[2], 10);
            if (ctx.seats[bSeat]) ctx.seats[bSeat].busted = true;
            trace.push('KNOCKOUT: seat' + bSeat);
        }
        var rankedM = xml.match(/<TournamentPlayerRanked\s+([^>]*)>/);
        if (rankedM) {
            var rSeat = iattr(rankedM[0], 'seat');
            if (rSeat !== null && ctx.seats[rSeat]) ctx.seats[rSeat].busted = true;
        }
        var npM = xml.match(/<NewPlayer\s+([^>]*)>/);
        if (npM) {
            var npSeat = iattr(npM[0], 'seat'), npAvail = attr(npM[0], 'available');
            if (npSeat !== null && npAvail === 'false' && ctx.seats[npSeat]) {
                ctx.seats[npSeat].vacated = true;
                ctx.seats[npSeat].inHand = false;
            }
            if (npAvail === 'true' && /stack-size=/.test(xml)) {
                var npChips = xml.match(/<Chips[^>]*stack-size="(\d+)"[^>]*\/>/);
                var npNick = xml.match(/<PlayerInfo[^>]*nickname="([^"]+)"/);
                if (npChips) {
                    var ns = ensureSeat(ctx, npSeat, npNick ? npNick[1] : null);
                    ns.stack = parseInt(npChips[1], 10);
                    ns.busted = false; ns.vacated = false; ns.streetBet = 0;
                }
            }
        }

        var lvlM = xml.match(/<CurrentLevel\s+([^>]*)\/>/) || xml.match(/<HandInfo\s+([^>]*)\/>/);
        if (lvlM) setLevelFromTag(ctx, lvlM[0]);
        var tiM = xml.match(/<TournamentInfo[\s\S]*?<\/TournamentInfo>/);
        if (tiM) processTournamentInfo(ctx, tiM[0]);

        if (/<EndHand/.test(xml)) {
            finalizeHand(ctx, meta);
            trace.push('ENDHAND');
        }
        return trace;
    }

    function processTournamentInfo(ctx, xml) {
        var cl = xml.match(/<CurrentLevel\s+([^>]*)\/>/);
        if (cl) setLevelFromTag(ctx, cl[0]);
        var nl = xml.match(/<NextLevel\s+([^>]*)\/>/);
        if (nl) {
            ctx.nextLevel = {
                sb: iattr(nl[0], 'lowStake'), bb: iattr(nl[0], 'highStake'),
                ante: iattr(nl[0], 'ante'), number: iattr(nl[0], 'number')
            };
        }
        var part = xml.match(/<Participants\s+([^>]*)>/);
        if (part) {
            var rem = iattr(part[0], 'remaining');
            if (rem !== null) ctx.level.remaining = rem;
        }
    }

    function finalizeHand(ctx, meta) {
        if (!ctx.hand) return;
        var handBB = getActiveHandBB(ctx);
        var startTotal = 0, endTotal = 0, anyStart = false;
        var players = [];
        var seatNums = Object.keys(ctx.seats).map(Number).sort(function (a, b) { return a - b; });
        for (var i = 0; i < seatNums.length; i++) {
            var sn = seatNums[i];
            var s = ctx.seats[sn];
            if (!ctx.dealtSeats[sn]) continue;
            anyStart = true;
            var startStack = (ctx.handStart[sn] !== undefined && ctx.handStart[sn] !== null) ? ctx.handStart[sn] : s.stack;
            if (startStack === null || isNaN(startStack)) startStack = 0;
            startTotal += startStack;
            endTotal += (s.stack || 0);
            var sd = ctx.showdownCards[sn];
            players.push({
                seat: sn,
                nick: s.nick || ('Seat ' + sn),
                position: ctx.positions[sn] || 'N/A',
                stack_start: startStack,
                stack_start_bb: handBB > 0 ? Math.round(startStack / handBB * 100) / 100 : null,
                stack_end: s.stack,
                stack_end_bb: handBB > 0 ? Math.round((s.stack || 0) / handBB * 100) / 100 : null,
                cards: sd ? sd.cards : ((ctx.holeCardsNow && ctx.holeCardsNow[sn]) || 'xx xx'),
                is_muck_leak: sd ? (sd.isMuck ? 1 : 0) : 0,
                busted: s.busted ? 1 : 0,
                actions: s.handActions || []
            });
        }
        if (!anyStart) return;
        var partial = ctx.handOrigin === 'midhand-sync' || startTotal === 0;
        var conserved = partial ? null : (startTotal === endTotal);
        var potTotal = ctx.winnerSum > 0 ? ctx.winnerSum : ctx.potSwept;
        var handObj = {
            hand_number: ctx.hand,
            tracking: partial ? 'partial' : 'full',
            table_id: ctx.id, table_name: ctx.name,
            tournament_id: ctx.tournamentId, tournament_name: ctx.tournamentName,
            timestamp: new Date().toISOString(),
            level: ctx.handLevel || { sb: ctx.level.sb, bb: ctx.level.bb, ante: ctx.level.ante, number: ctx.level.number },
            dealer_seat: ctx.dealer,
            board: ctx.board.join(' '),
            pot_total: potTotal,
            pot_bb: handBB > 0 ? Math.round(potTotal / handBB * 100) / 100 : null,
            winners: ctx.winners,
            players: players,
            sync_verified: partial ? null : (conserved && (ctx.winnerSum === 0 || ctx.winnerSum === ctx.potSwept)),
            chip_conservation: { start_total: startTotal, end_total: endTotal, ok: conserved }
        };
        ctx.handsCompleted++;
        if (conserved === false) ctx.syncFails++;
        for (var sn2 in ctx.seats) {
            ctx.seats[sn2].streetBet = 0;
        }
        ctx.holeCardsNow = null;
        if (meta && meta.onHandFinished) {
            try { meta.onHandFinished(handObj, ctx); } catch (e) {}
        }
    }

    /* ═══════════════ STATE / STORAGE ═══════════════ */
    var STORAGE_KEY = '__poker_hands_archive_v31';
    var handsArchive = [];
    try { handsArchive = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (e) { handsArchive = []; }

    var engineLog = [];
    function logEngine(tableKey, trace) {
        for (var i = 0; i < trace.length; i++) {
            engineLog.push({ t: Date.now(), table: tableKey, msg: trace[i] });
        }
        if (engineLog.length > 400) engineLog.splice(0, engineLog.length - 400);
    }

    var tables = {};
    var wsSeq = 0;

    function persistArchive() {
        try {
            if (handsArchive.length > 1000) handsArchive = handsArchive.slice(-1000);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(handsArchive));
        } catch (e) {}
    }

    function getCtxFor(ws) {
        if (!ws.__syncUid) ws.__syncUid = 'ws' + (++wsSeq);
        if (!tables[ws.__syncUid]) {
            var ctx = createTableContext();
            ctx.__wsUid = ws.__syncUid;
            tables[ws.__syncUid] = ctx;
        }
        return tables[ws.__syncUid];
    }

    /* ═══════════════ UI ═══════════════ */
    var ui = document.createElement('div');
    ui.id = 'sync-hud-v31';
    ui.style.cssText = 'position:fixed;top:6px;left:50%;transform:translateX(-50%);width:96vw;max-width:470px;z-index:2147483647;background:rgba(8,12,22,0.97);color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,monospace;font-size:11px;padding:9px 11px;border-radius:12px;border:2px solid #22d3ee;box-shadow:0 14px 44px rgba(0,0,0,0.9);backdrop-filter:blur(14px);box-sizing:border-box;';
    ui.innerHTML = [
        '<div style="display:flex;justify-content:space-between;align-items:center;">',
        '  <div style="display:flex;align-items:center;gap:6px;">',
        '    <span id="v31-dot" style="color:#22d3ee;">●</span>',
        '    <b style="color:#22d3ee;font-size:12px;">SYNC HUD v31 · 100% СТЕКИ</b>',
        '  </div>',
        '  <div style="display:flex;gap:6px;align-items:center;">',
        '    <span id="v31-syncbadge" style="font-size:9.5px;color:#22c55e;border:1px solid #22c55e;border-radius:4px;padding:0 4px;">SYNC ✓</span>',
        '    <button id="v31-toggle" style="background:transparent;border:1px solid #475569;color:#22d3ee;cursor:pointer;font-size:11px;padding:0 6px;border-radius:4px;">▾</button>',
        '    <button id="v31-close" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:13px;">✕</button>',
        '  </div>',
        '</div>',
        '<div id="v31-body" style="margin-top:7px;">',
        '  <div style="display:flex;justify-content:space-between;align-items:center;font-size:10.5px;color:#94a3b8;background:#0b1220;padding:4px 8px;border-radius:7px;border:1px solid #1e293b;margin-bottom:6px;">',
        '    <span>Столов: <b id="v31-tcount" style="color:#38bdf8;">0</b></span>',
        '    <span>Раздач: <b id="v31-hcount" style="color:#22c55e;">0</b></span>',
        '    <span>Сбой: <b id="v31-fcount" style="color:#f87171;">0</b></span>',
        '    <button id="v31-clear" style="background:#334155;border:none;color:#cbd5e1;padding:2px 6px;border-radius:4px;cursor:pointer;font-size:9px;">Сброс</button>',
        '  </div>',
        '  <div id="v31-tables" style="max-height:300px;overflow-y:auto;margin-bottom:7px;"></div>',
        '  <button id="v31-export" style="width:100%;padding:7px;background:linear-gradient(90deg,#0891b2,#16a34a);color:#fff;border:none;border-radius:7px;font-weight:bold;font-size:11px;cursor:pointer;">📥 Скачать JSON (раздачи + стеки + лог)</button>',
        '</div>'].join('');
    document.body.appendChild(ui);

    document.getElementById('v31-toggle').onclick = function () {
        var b = document.getElementById('v31-body');
        var hidden = b.style.display === 'none';
        b.style.display = hidden ? 'block' : 'none';
        this.innerText = hidden ? '▾' : '▴';
    };
    document.getElementById('v31-close').onclick = function () {
        ui.remove();
        window.__pokerSyncV31 = false;
    };
    document.getElementById('v31-clear').onclick = function () {
        if (confirm('Очистить архив раздач?')) {
            handsArchive = [];
            localStorage.removeItem(STORAGE_KEY);
            renderUI();
        }
    };
    document.getElementById('v31-export').onclick = function () {
        var liveTables = [];
        Object.keys(tables).forEach(function (k) {
            var c = tables[k];
            if (Object.keys(c.seats).length === 0) return;
            var seats = [];
            Object.keys(c.seats).map(Number).sort(function (a, b) { return a - b; }).forEach(function (sn) {
                var s = c.seats[sn];
                if (s.busted || s.vacated) return;
                seats.push({
                    seat: sn, nick: s.nick, position: c.positions[sn] || '—',
                    stack: s.stack, stack_bb: liveStackBB(c, s.stack),
                    street_bet: s.streetBet || 0, in_hand: !!c.activeSeats[sn],
                    cards: c.showdownCards[sn] ? c.showdownCards[sn].cards : null
                });
            });
            liveTables.push({
                table_id: c.id, table_name: c.name, tournament_name: c.tournamentName,
                level: c.handLevel || c.level, hand: c.hand, board: c.board.join(' '),
                pot_display: displayPot(c), seats: seats,
                last_sync_report: c.lastSyncReport
            });
        });
        var dump = {
            recorder_version: SYNC_ENGINE_VERSION,
            export_time: new Date().toISOString(),
            total_hands_recorded: handsArchive.length,
            live_tables_snapshot: liveTables,
            engine_log_tail: engineLog.slice(-120),
            recorded_hands: handsArchive
        };
        var blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'pokerdom_sync_v31_' + Date.now() + '.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    };

    function fmtChips(n) {
        if (n === null || n === undefined) return '—';
        if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(n % 1e3 === 0 ? 0 : 1) + 'K';
        return String(n);
    }

    var rafPending = false;
    function renderUI() {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(function () {
            rafPending = false;
            var tEl = document.getElementById('v31-tables');
            if (!tEl) return;
            var activeCtx = Object.keys(tables).map(function (k) { return tables[k]; })
                .filter(function (c) { return Object.keys(c.seats).length > 0; });
            document.getElementById('v31-tcount').innerText = activeCtx.length;
            document.getElementById('v31-hcount').innerText = handsArchive.length;
            var totalFails = activeCtx.reduce(function (a, c) { return a + (c.syncFails || 0); }, 0);
            document.getElementById('v31-fcount').innerText = totalFails;
            var badge = document.getElementById('v31-syncbadge');
            badge.textContent = totalFails ? 'DRIFT ' + totalFails : 'SYNC ✓';
            badge.style.color = totalFails ? '#f87171' : '#22c55e';
            badge.style.borderColor = totalFails ? '#f87171' : '#22c55e';

            if (!activeCtx.length) {
                tEl.innerHTML = '<div style="color:#64748b;text-align:center;padding:10px;font-size:10px;">Ожидание данных стола… (сделайте действие или откройте стол)</div>';
                return;
            }
            var html = '';
            activeCtx.forEach(function (c) {
                var handBB = getActiveHandBB(c);
                var activeLvl = (c.hand && c.handLevel && c.handLevel.bb) ? c.handLevel : c.level;
                var lvl = 'SB ' + fmtChips(activeLvl.sb) + ' / BB ' + fmtChips(handBB) + (activeLvl.ante ? ' / ANTE ' + fmtChips(activeLvl.ante) : '');
                if (c.level.bb && c.level.bb > handBB) {
                    lvl += ' <span style="color:#f59e0b;">(Сл: ' + fmtChips(c.level.bb) + ')</span>';
                } else if (c.nextLevel && c.nextLevel.bb) {
                    lvl += ' <span style="color:#64748b;">→ BB ' + fmtChips(c.nextLevel.bb) + '</span>';
                }
                var pot = displayPot(c);
                html += '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:8px;padding:6px 8px;margin-bottom:6px;">';
                html += '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #1e293b;padding-bottom:3px;margin-bottom:4px;">';
                html += '<span style="color:#38bdf8;font-weight:bold;">🟢 ' + (c.name || 'Стол') + (c.tournamentName ? ' · ' + c.tournamentName.substr(0, 22) : '') + '</span>';
                html += '<span style="color:#f59e0b;">' + lvl + '</span></div>';
                html += '<div style="display:flex;justify-content:space-between;color:#94a3b8;font-size:9.5px;margin-bottom:3px;">';
                html += '<span>Рука #' + (c.hand || '—') + ' · ' + c.street + ' · D: место ' + (c.dealer !== null ? c.dealer : '—') + '</span>';
                html += '<span>БАНК <b style="color:#fbbf24;">' + fmtChips(pot) + '</b>' + (handBB ? ' (' + (pot / handBB).toFixed(2) + ' BB)' : '') + '</span></div>';
                if (c.board.length) {
                    html += '<div style="color:#a855f7;font-size:10px;margin-bottom:3px;"> Board: ' + c.board.join(' ') + '</div>';
                }
                var seatNums = Object.keys(c.seats).map(Number).sort(function (a, b) { return a - b; });
                seatNums.forEach(function (sn) {
                    var s = c.seats[sn];
                    var dead = s.busted || s.vacated;
                    var bbv = handBB && s.stack !== null ? (s.stack / handBB) : null;
                    var bbStr = bbv !== null ? bbv.toFixed(2) + ' BB' : '—';
                    var col = dead ? '#475569' : (bbv !== null && bbv < 15 ? '#ef4444' : (bbv !== null && bbv < 30 ? '#f59e0b' : '#22c55e'));
                    var dot = dead ? '💀' : (c.activeSeats[sn] ? '🟢' : '⚪');
                    var dBtn = (c.dealer === sn) ? '<span style="color:#fbbf24;">[D]</span>' : '';
                    var pos = c.positions[sn] ? '<span style="color:#94a3b8;">(' + c.positions[sn] + ')</span>' : '';
                    var bet = '';
                    if (s.streetBet > 0) {
                        bet = '<span style="color:#38bdf8;font-size:9.5px;">+' + fmtChips(s.streetBet) + (handBB ? '(' + (s.streetBet / handBB).toFixed(2) + 'BB)' : '') + '</span>';
                    }
                    var cards = c.showdownCards[sn] && c.showdownCards[sn].cards
                        ? ' <span style="color:' + (c.showdownCards[sn].isMuck ? '#94a3b8' : '#a855f7') + ';font-weight:bold;">[' + c.showdownCards[sn].cards + ']</span>' : '';
                    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:1.5px 0;' + (dead ? 'opacity:0.45;text-decoration:line-through;' : '') + '">';
                    html += '<span>' + dot + ' <b>' + (s.nick || ('Seat ' + sn)) + '</b> ' + pos + dBtn + ' ' + bet + cards + '</span>';
                    html += '<span><b style="color:' + col + ';font-size:11.5px;">' + bbStr + '</b> <span style="color:#64748b;font-size:9.5px;">' + fmtChips(s.stack) + '</span></span>';
                    html += '</div>';
                });
                html += '</div>';
            });
            tEl.innerHTML = html;
        });
    }

    /* ═══════════════ WEBSOCKET INTERCEPT ═══════════════ */
    function decodePayload(data) {
        if (!data) return Promise.resolve('');
        if (typeof data === 'string') return Promise.resolve(data);
        return Promise.resolve(data instanceof ArrayBuffer ? data : data.arrayBuffer()).then(function (buf) {
            var u8 = new Uint8Array(buf);
            if (u8.length > 2 && ((u8[0] === 0x1f && u8[1] === 0x8b) || u8[0] === 0x78)) {
                if (typeof DecompressionStream !== 'undefined') {
                    try {
                        var ds = new DecompressionStream(u8[0] === 0x1f ? 'gzip' : 'deflate');
                        return new Response(new Response(buf).body.pipeThrough(ds)).text();
                    } catch (e) {}
                }
            }
            return new TextDecoder('utf-8').decode(buf);
        }).catch(function () { return ''; });
    }

    function handleTableXml(ws, text) {
        if (!text || text.charAt(0) !== '<') return;
        var ctx = getCtxFor(ws);
        var trace = processTableMessage(ctx, text, {
            onHandFinished: function (handObj) {
                var exists = handsArchive.some(function (h) {
                    return h.hand_number === handObj.hand_number && h.table_id === handObj.table_id;
                });
                if (!exists) {
                    handsArchive.push(handObj);
                    persistArchive();
                }
            }
        });
        if (trace.length) logEngine(ctx.__wsUid, trace);
        renderUI();
    }

    function hookWs(ws) {
        if (!ws || ws.__v31Hooked) return;
        ws.__v31Hooked = true;
        ws.addEventListener('message', function (e) {
            decodePayload(e.data).then(function (text) { handleTableXml(ws, text); }).catch(function () {});
        });
        ws.addEventListener('close', function () {
            var ctx = ws.__syncUid && tables[ws.__syncUid];
            if (ctx) {
                delete tables[ws.__syncUid];
                renderUI();
            }
        });
        try {
            if (ws.readyState === 1) {
                ws.send('<GetTableDetails/>');
            }
        } catch (e) {}
    }

    var OrigWS = window.WebSocket;
    if (OrigWS && !window.__v31WsProxy) {
        window.__v31WsProxy = true;
        window.WebSocket = new Proxy(OrigWS, {
            construct: function (target, args) {
                var ws = Reflect.construct(target, args);
                hookWs(ws);
                return ws;
            }
        });
        ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (p) {
            if (OrigWS[p] !== undefined) window.WebSocket[p] = OrigWS[p];
        });
        var origSend = OrigWS.prototype.send;
        OrigWS.prototype.send = function () {
            if (!this.__v31Hooked) hookWs(this);
            try {
                var arg = arguments[0];
                if (typeof arg === 'string' && arg.charAt(0) === '<') {
                    var et = arg.match(/<EnterTable[^>]*>/);
                    if (et) {
                        var ctx = getCtxFor(this);
                        var tid = attr(et[0], 'tableId');
                        if (tid) {
                            ctx.id = tid;
                            ctx.name = ctx.name || 'Стол ' + tid.substr(-4);
                        }
                        ctx.tournamentId = attr(et[0], 'tournamentId') || ctx.tournamentId;
                    }
                }
            } catch (e) {}
            return origSend.apply(this, Array.prototype.slice.call(arguments));
        };
    }

    window.__pokerSyncV31API = {
        version: SYNC_ENGINE_VERSION,
        tables: tables,
        archive: handsArchive,
        engineLog: engineLog,
        export: function () { document.getElementById('v31-export').click(); }
    };

    renderUI();
    console.log('%c✅ [SYNC HUD v31.0] Запущен. Блайнды текущей руки заблокированы от преждевременного пересчета.', 'color:#22d3ee;font-weight:bold;');
})();
