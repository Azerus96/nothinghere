javascript:(function(){
    const SERVER_URL = "https://37273550d474c200-34-181-218-137.serveousercontent.com/"; // URL вашего Serveo туннеля

    // ── 1. СОЗДАНИЕ ПЛАВАЮЩЕГО HUD ВИДЖЕТА НА ЭКРАНЕ ────────────────────
    let hud = document.getElementById("poker-gto-hud");
    if (!hud) {
        hud = document.createElement("div");
        hud.id = "poker-gto-hud";
        hud.style.cssText = "position:fixed; top:20px; right:20px; z-index:999999; background:rgba(9,13,22,0.92); color:#fff; border:1px solid #6366f1; border-radius:12px; padding:12px 16px; font-family:monospace; box-shadow:0 10px 25px rgba(0,0,0,0.7); min-width:240px; pointer-events:auto; backdrop-filter:blur(6px); cursor:move;";
        hud.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1e293b; padding-bottom:6px; margin-bottom:8px;">
                <span style="font-weight:bold; color:#818cf8; font-size:12px;">⚡ GTO CUDA BOT</span>
                <span id="hud-status" style="font-size:10px; color:#10b981;">● Online</span>
            </div>
            <div id="hud-cards" style="font-size:13px; color:#94a3b8; margin-bottom:4px;">Ожидание раздачи...</div>
            <div id="hud-action" style="font-size:16px; font-weight:bold; color:#f8fafc; margin-bottom:4px;">-</div>
            <div id="hud-details" style="font-size:11px; color:#64748b;">EV: - | 0 ms</div>
        `;
        document.body.appendChild(hud);

        // Перетаскивание HUD мышкой
        let isDragging = false, offsetX, offsetY;
        hud.onmousedown = (e) => { isDragging = true; offsetX = e.clientX - hud.offsetLeft; offsetY = e.clientY - hud.offsetTop; };
        document.onmousemove = (e) => { if(isDragging) { hud.style.left = (e.clientX - offsetX) + "px"; hud.style.top = (e.clientY - offsetY) + "px"; }};
        document.onmouseup = () => { isDragging = false; };
    }

    // ── 2. STATE MACHINE РАЗДАЧИ ─────────────────────────────────────────
    let gameState = {
        heroSeat: null,
        bbValue: 100,
        cards: { hero: [], board: [] },
        finances: { big_blind: 100, pot_bb: 0, hero_effective_stack_bb: 0 },
        structure: { hero_position: "BTN", active_players_count: 0, opponents_positions: [] },
        history: { pot_type: "SRP", preflop_raises: 0, flop_actions_before_hero: [] }
    };

    const parser = new DOMParser();

    function parseXmlPacket(xmlStr) {
        try {
            const xml = parser.parseFromString(xmlStr, "application/xml");
            
            // 1. Блайнды и стол (<GameParams bb="100"/>)
            const gameParams = xml.querySelector("GameParams");
            if (gameParams && gameParams.getAttribute("bb")) {
                gameState.bbValue = parseFloat(gameParams.getAttribute("bb"));
                gameState.finances.big_blind = gameState.bbValue;
            }

            // 2. Карты Героя (<DealingCards seat="7">)
            const dealingCards = xml.querySelector("DealingCards");
            if (dealingCards) {
                gameState.heroSeat = dealingCards.getAttribute("seat");
                const cards = Array.from(dealingCards.querySelectorAll("Card")).map(c => c.textContent.trim());
                gameState.cards.hero = cards;
                gameState.history.flop_actions_before_hero = [];
                document.getElementById("hud-cards").innerText = `Рука: [${cards.join(" ")}]`;
            }

            // 3. Флоп (<DealingFlop>)
            const dealingFlop = xml.querySelector("DealingFlop");
            if (dealingFlop) {
                const cards = Array.from(dealingFlop.querySelectorAll("Card")).map(c => c.textContent.trim());
                gameState.cards.board = cards;
                document.getElementById("hud-cards").innerText = `[${gameState.cards.hero.join(" ")}] | Доска: ${cards.join(" ")}`;
            }

            // 4. Банк (<Pot amount="1000"/>)
            const pot = xml.querySelector("Pot");
            if (pot && pot.getAttribute("amount")) {
                const potChips = parseFloat(pot.getAttribute("amount"));
                gameState.finances.pot_bb = parseFloat((potChips / gameState.bbValue).toFixed(1));
            }

            // 5. Стеки (<Seats>)
            const seats = xml.querySelectorAll("Seat");
            if (seats.length > 0) {
                let activeCount = 0;
                let heroChips = 0;
                let maxOppChips = 0;

                seats.forEach(s => {
                    const status = s.getAttribute("status");
                    const chips = parseFloat(s.getAttribute("chips") || 0);
                    const sId = s.getAttribute("id");

                    if (status === "active" || status === "inHand") {
                        activeCount++;
                        if (sId === gameState.heroSeat) {
                            heroChips = chips;
                        } else {
                            if (chips > maxOppChips) maxOppChips = chips;
                        }
                    }
                });

                gameState.structure.active_players_count = activeCount;
                const effChips = Math.min(heroChips, maxOppChips);
                gameState.finances.hero_effective_stack_bb = parseFloat((effChips / gameState.bbValue).toFixed(1));
            }

            // 6. Действия оппонентов (<PlayerAction seat="3"><Check/></PlayerAction>)
            const pAction = xml.querySelector("PlayerAction");
            if (pAction) {
                const seatId = pAction.getAttribute("seat");
                if (seatId !== gameState.heroSeat) {
                    const actName = pAction.children[0] ? pAction.children[0].tagName.toUpperCase() : "CALL";
                    gameState.history.flop_actions_before_hero.push({ seat: seatId, action: actName });
                }
            }

            // 7. НАСТУПИЛ НАШ ХОД! (<ActiveChange seat="7">)
            const activeChange = xml.querySelector("ActiveChange");
            if (activeChange && activeChange.getAttribute("seat") === gameState.heroSeat) {
                requestGtoAdvice();
            }

        } catch (e) {
            console.error("XML parse error:", e);
        }
    }

    // ── 3. ЗАПРОС К KAGGLE БЭКЕНДУ НА 2x TESLA T4 ────────────────────────
    async function requestGtoAdvice() {
        document.getElementById("hud-action").innerHTML = `<span style="color:#fbbf24;">● Расчет на GPU...</span>`;
        
        try {
            const res = await fetch(`${SERVER_URL}/api/advice`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(gameState)
            });
            const data = await res.json();

            if (data.status === "ok") {
                const actColor = data.action_type === "BET" || data.action_type === "RAISE" ? "#ef4444" : "#10b981";
                document.getElementById("hud-action").innerHTML = `
                    <span style="color:${actColor}; font-size:18px;">👉 ${data.recommended_action}</span>
                `;
                document.getElementById("hud-details").innerText = `EV: ${data.ev_chips} | Время: ${data.calc_time_ms} ms`;
            }
        } catch (err) {
            document.getElementById("hud-action").innerHTML = `<span style="color:#ef4444;">Ошибка связи с Kaggle</span>`;
        }
    }

    // ── 4. MONKEY-PATCHING WEBSOCKET ─────────────────────────────────────
    if (!window._wsHooked) {
        const OrigWebSocket = window.WebSocket;
        window.WebSocket = function(...args) {
            const ws = new OrigWebSocket(...args);
            ws.addEventListener("message", (e) => {
                if (typeof e.data === "string" && e.data.startsWith("<")) {
                    parseXmlPacket(e.data);
                }
            });
            return ws;
        };
        window._wsHooked = true;
        console.log("✅ WebSocket перехватчик XML успешно активирован!");
    }
})();
