import os
import sys
import json
import time
import asyncio
import threading
import subprocess
import re
from pathlib import Path
from collections import deque
from typing import AsyncGenerator, List, Dict, Any

from fastapi import FastAPI, UploadFile, File, Request
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
import uvicorn
from kaggle_secrets import UserSecretsClient
from google import genai
from google.genai import types

# --- 1. СЕКРЕТЫ И ИНИЦИАЛИЗАЦИЯ ---
secrets = UserSecretsClient()
GEMINI_KEY = secrets.get_secret("GEMINI_API_KEY")
GITHUB_TOKEN = secrets.get_secret("GITHUB_TOKEN")

os.environ["GEMINI_API_KEY"] = GEMINI_KEY
client = genai.Client()
WORKDIR = Path("/kaggle/working/nothinghere") if Path("/kaggle/working/nothinghere").exists() else Path("/kaggle/working")
HISTORY_FILE = Path("/kaggle/working/session_history.json")

app = FastAPI(title="Kaggle Vibe Agent")

def log_console(msg: str):
    """Принудительный вывод логов в ячейку Kaggle в реальном времени."""
    timestamp = time.strftime("%H:%M:%S")
    print(f"[{timestamp}] {msg}", flush=True)

# --- 2. МАСКИРОВАНИЕ СЕКРЕТОВ ---
def sanitize_logs(text: str) -> str:
    if GITHUB_TOKEN:
        text = text.replace(GITHUB_TOKEN, "ghp_***HIDDEN_TOKEN***")
    if GEMINI_KEY:
        text = text.replace(GEMINI_KEY, "AIza***HIDDEN_KEY***")
    return text

# --- 3. ДИНАМИЧЕСКИЙ СПИСОК ДОСТУПНЫХ МОДЕЛЕЙ ---
def fetch_available_models() -> List[str]:
    try:
        raw = []
        for m in client.models.list():
            c_name = m.name.replace("models/", "")
            if "gemini" in c_name and not any(x in c_name for x in ["embed", "image", "tts", "robotics", "computer-use", "2.0"]):
                raw.append(c_name)

        priority = [
            "gemini-3.7-flash",
            "gemini-3.6-flash",
            "gemini-3.5-flash",
            "gemini-3.5-flash-lite",
            "gemini-3.1-pro-preview",
            "gemini-3.1-flash-lite",
            "gemini-2.5-pro",
            "gemini-2.5-flash-lite"
        ]
        sorted_models = [m for m in priority if m in raw]
        for m in raw:
            if m not in sorted_models:
                sorted_models.append(m)
        log_console(f"✅ Обнаружено моделей Google: {len(sorted_models)}. Приоритет: {sorted_models[:3]}")
        return sorted_models if sorted_models else ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"]
    except Exception as e:
        log_console(f"⚠️ Ошибка загрузки списка моделей: {e}")
        return ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"]

AVAILABLE_MODELS = fetch_available_models()

# --- 4. RATE LIMITER ---
class RollingRateLimiter:
    def __init__(self, max_per_minute: int = 12):
        self.max_per_minute = max_per_minute
        self.timestamps = deque()

    async def acquire(self):
        now = time.time()
        while self.timestamps and self.timestamps[0] <= now - 60:
            self.timestamps.popleft()
        if len(self.timestamps) >= self.max_per_minute:
            wait_time = 60 - (now - self.timestamps[0]) + 1.0
            if wait_time > 0:
                log_console(f"⏳ [Rate Limiter] Пауза {wait_time:.1f}с для соблюдения квоты 12 RPM...")
                await asyncio.sleep(wait_time)
        self.timestamps.append(time.time())

limiter = RollingRateLimiter(max_per_minute=12)

# --- 5. ИНСТРУМЕНТЫ (TOOLS) ---
def execute_bash(command: str) -> str:
    log_console(f"💻 [Bash Запуск]: {command[:100]}...")
    try:
        res = subprocess.run(command, shell=True, text=True, capture_output=True, timeout=300, cwd=WORKDIR)
        out = res.stdout + ("\n[STDERR]:\n" + res.stderr if res.stderr else "")
        log_console(f"💻 [Bash Результат]: код {res.returncode}, байт {len(out)}")
        return sanitize_logs(out.strip()) if out.strip() else "[Успешно без вывода]"
    except subprocess.TimeoutExpired:
        log_console("❌ [Bash Ошибка]: Превышен таймаут 300с")
        return "[Ошибка: Превышен таймаут 300 секунд]"
    except Exception as e:
        log_console(f"❌ [Bash Исключение]: {e}")
        return f"[Исключение: {str(e)}]"

def read_file(path: str) -> str:
    p = WORKDIR / path if not Path(path).is_absolute() else Path(path)
    if not p.exists():
        return f"[Ошибка: Файл {path} не найден]"
    try:
        return p.read_text(encoding="utf-8")
    except Exception as e:
        return f"[Ошибка чтения: {str(e)}]"

def write_file(path: str, content: str) -> str:
    p = WORKDIR / path if not Path(path).is_absolute() else Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    try:
        p.write_text(content, encoding="utf-8")
        log_console(f"📝 [Файл сохранен]: {path} ({len(content)} символов)")
        return f"Файл {path} успешно сохранен."
    except Exception as e:
        return f"[Ошибка записи: {str(e)}]"

def list_files(directory: str = ".") -> str:
    p = WORKDIR / directory if not Path(directory).is_absolute() else Path(directory)
    if not p.exists():
        return f"[Директория {directory} не найдена]"
    tree = []
    for root, _, files in os.walk(p):
        if any(x in root for x in [".git", "__pycache__", "build"]):
            continue
        rel = os.path.relpath(root, p)
        for f in files:
            tree.append(os.path.join(rel, f) if rel != "." else f)
    return "\n".join(tree[:150]) if tree else "[Директория пуста]"

def git_commit_and_push(branch: str = "main", message: str = "auto: updates by Kaggle Vibe Agent") -> str:
    script = f"""
    cd {WORKDIR}
    git config --global user.name "Kaggle Gemini Agent"
    git config --global user.email "agent@kaggle.t4"
    git add .
    git commit -m "{message}" || true
    REMOTE_URL=$(git config --get remote.origin.url | sed 's#https://##' | sed 's#.*@##')
    git push https://x-access-token:{GITHUB_TOKEN}@$REMOTE_URL {branch}
    """
    return execute_bash(script)

def inspect_gpu() -> str:
    return execute_bash("nvidia-smi --query-gpu=index,name,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu --format=csv")

tools_list = [execute_bash, read_file, write_file, list_files, git_commit_and_push, inspect_gpu]

# --- 6. ИСТОРИЯ ДИАЛОГА ---
def load_history() -> List[Dict[str, Any]]:
    if HISTORY_FILE.exists():
        try:
            return json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
        except:
            return []
    return []

def save_history(history: List[Dict[str, Any]]):
    try:
        HISTORY_FILE.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as e:
        print(f"Error saving history: {e}")

# --- 7. НЕБЛОКИРУЮЩИЙ КАСКАДНЫЙ ИНФЕРЕНС ---
def sync_gemini_call(model_name: str, contents: list, config: types.GenerateContentConfig):
    return client.models.generate_content(
        model=model_name,
        contents=contents,
        config=config
    )

async def call_gemini_async(contents: list, sys_inst: str, settings: dict):
    selected_model = settings.get("model", "auto")
    temperature = float(settings.get("temperature", 0.2))
    top_p = float(settings.get("top_p", 0.95))
    max_tokens = int(settings.get("max_tokens", 8192))
    safety_level = settings.get("safety", "BLOCK_NONE")

    safety_settings_list = []
    if safety_level == "BLOCK_NONE":
        threshold = types.HarmBlockThreshold.BLOCK_NONE
    elif safety_level == "BLOCK_ONLY_HIGH":
        threshold = types.HarmBlockThreshold.BLOCK_ONLY_HIGH
    else:
        threshold = types.HarmBlockThreshold.HARM_BLOCK_THRESHOLD_UNSPECIFIED

    for cat in [
        types.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        types.HarmCategory.HARM_CATEGORY_HARASSMENT,
        types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    ]:
        safety_settings_list.append(types.SafetySetting(category=cat, threshold=threshold))

    config = types.GenerateContentConfig(
        system_instruction=sys_inst,
        tools=tools_list,
        temperature=temperature,
        top_p=top_p,
        max_output_tokens=max_tokens,
        safety_settings=safety_settings_list
    )

    models_queue = AVAILABLE_MODELS if selected_model == "auto" else [selected_model] + [m for m in AVAILABLE_MODELS if m != selected_model]
    last_error = None

    for m_name in models_queue:
        for attempt in range(3):
            await limiter.acquire()
            try:
                log_console(f"🤖 [Запрос к Gemini]: Модель {m_name} (Попытка {attempt+1})")
                response = await asyncio.to_thread(sync_gemini_call, m_name, contents, config)
                log_console(f"✨ [Ответ получен]: Модель {m_name} успешно сгенерировала ответ.")
                return response, m_name
            except Exception as e:
                err_str = str(e)
                last_error = err_str
                log_console(f"⚠️ [Ошибка {m_name}]: {err_str[:120]}")
                if "404" in err_str or "NOT_FOUND" in err_str:
                    break # Не ретраим устаревшие модели
                if any(k in err_str for k in ["503", "429", "UNAVAILABLE", "RESOURCE_EXHAUSTED"]):
                    await asyncio.sleep(2.0 * (attempt + 1))
                else:
                    break
        if selected_model != "auto":
            break

    raise Exception(f"Все попытки вызова моделей завершились ошибкой: {last_error}")

# --- 8. WEB UI (С MARKDOWN, HIGHLIGHT.JS И REAL-TIME SSE) ---
HTML_CODE = """
<!DOCTYPE html>
<html lang="ru" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kaggle Vibe Agent Studio (2x T4)</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        darkbg: '#080c14',
                        cardbg: '#111827',
                        sidebg: '#0f172a',
                        bordercol: '#1f2937',
                        terminalbg: '#030712'
                    }
                }
            }
        }
    </script>
    <style>
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-thumb { background: #374151; border-radius: 4px; }
        pre, code { font-family: 'JetBrains Mono', Consolas, Monaco, monospace; }
        .markdown-body pre { background-color: #030712 !important; border: 1px solid #1f2937; border-radius: 0.75rem; padding: 1rem; margin: 0.5rem 0; overflow-x: auto; }
        .markdown-body code { font-size: 0.85rem; }
        .markdown-body p { margin-bottom: 0.5rem; line-height: 1.6; }
        .markdown-body ul { list-style-type: disc; margin-left: 1.25rem; margin-bottom: 0.5rem; }
    </style>
</head>
<body class="bg-darkbg text-slate-100 h-screen flex flex-col font-sans antialiased overflow-hidden">
    
    <header class="bg-cardbg border-b border-bordercol px-6 py-3 flex justify-between items-center z-10 shadow-md">
        <div class="flex items-center space-x-3">
            <div class="bg-gradient-to-tr from-cyan-500 to-indigo-600 p-2.5 rounded-xl shadow-lg">
                <i class="fa-solid fa-microchip text-white text-lg"></i>
            </div>
            <div>
                <h1 class="font-bold text-base text-white tracking-wide flex items-center gap-2">
                    Gemini Agent Studio
                    <span class="text-[11px] font-normal px-2 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-md">2x Tesla T4</span>
                </h1>
                <p id="activeModelIndicator" class="text-xs text-slate-400">Режим: Авто-каскад активен</p>
            </div>
        </div>
        <div class="flex items-center space-x-3">
            <button onclick="toggleSettings()" class="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg border border-bordercol text-xs flex items-center gap-2 transition">
                <i class="fa-solid fa-sliders text-indigo-400"></i>
                <span>Параметры & Модели</span>
            </button>
            <button onclick="clearHistory()" class="bg-slate-800 hover:bg-red-950/50 hover:text-red-400 text-slate-400 px-3 py-1.5 rounded-lg border border-bordercol text-xs transition">
                <i class="fa-solid fa-trash-can mr-1"></i> Сброс
            </button>
        </div>
    </header>

    <div class="flex-1 flex overflow-hidden relative">
        <main class="flex-1 flex flex-col h-full bg-darkbg">
            <div id="chatBox" class="flex-1 overflow-y-auto p-6 space-y-6 max-w-4xl w-full mx-auto"></div>

            <footer class="bg-cardbg border-t border-bordercol p-4">
                <div class="max-w-4xl mx-auto flex flex-col space-y-2">
                    <div id="fileBadge" class="hidden text-xs bg-indigo-950/60 text-indigo-300 border border-indigo-700/50 px-3 py-1.5 rounded-lg flex items-center justify-between w-fit gap-3">
                        <span id="fileBadgeName"><i class="fa-solid fa-paperclip mr-1.5"></i></span>
                        <button onclick="clearUploadedFile()" class="text-slate-400 hover:text-red-400"><i class="fa-solid fa-xmark"></i></button>
                    </div>

                    <div class="flex items-center space-x-3 bg-darkbg border border-bordercol rounded-2xl p-2.5 focus-within:border-indigo-500 transition shadow-inner">
                        <label class="cursor-pointer text-slate-400 hover:text-indigo-400 p-2 transition">
                            <i class="fa-solid fa-paperclip text-lg"></i>
                            <input type="file" id="fileInput" class="hidden" onchange="uploadFile(this)">
                        </label>
                        <textarea id="promptInput" rows="1" placeholder="Поставьте задачу агенту (например: покажи файлы, собери solver с CUDA_ARCH=75, запусти тесты)..." 
                            class="flex-1 bg-transparent border-0 focus:ring-0 text-slate-100 placeholder-slate-500 resize-none outline-none text-sm leading-relaxed"
                            onkeydown="if(event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendPrompt(); }"></textarea>
                        <button onclick="sendPrompt()" id="sendBtn" class="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl transition flex items-center gap-2 text-sm font-semibold shadow-md">
                            <span>Запуск</span>
                            <i class="fa-solid fa-paper-plane text-xs"></i>
                        </button>
                    </div>
                </div>
            </footer>
        </main>

        <aside id="settingsDrawer" class="w-80 bg-sidebg border-l border-bordercol flex flex-col h-full transform transition-all duration-300 ease-in-out p-5 overflow-y-auto hidden">
            <div class="flex justify-between items-center mb-6">
                <h2 class="font-bold text-sm text-white flex items-center gap-2">
                    <i class="fa-solid fa-sliders text-indigo-400"></i> Настройки Инференса
                </h2>
                <button onclick="toggleSettings()" class="text-slate-400 hover:text-slate-200"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <div class="space-y-5 text-xs">
                <div>
                    <label class="block font-semibold text-slate-300 mb-1.5">Модель Gemini</label>
                    <select id="modelSelect" class="w-full bg-slate-900 border border-bordercol rounded-xl px-3 py-2 text-slate-200 outline-none focus:border-indigo-500">
                        <option value="auto">⚡ Авто-каскад (Умный выбор)</option>
                    </select>
                </div>

                <div>
                    <div class="flex justify-between font-semibold text-slate-300 mb-1">
                        <span>Temperature</span>
                        <span id="tempVal" class="text-indigo-400">0.2</span>
                    </div>
                    <input type="range" id="tempRange" min="0" max="2" step="0.05" value="0.2" class="w-full accent-indigo-500" oninput="document.getElementById('tempVal').innerText = this.value">
                </div>

                <div>
                    <div class="flex justify-between font-semibold text-slate-300 mb-1">
                        <span>Top-P</span>
                        <span id="toppVal" class="text-indigo-400">0.95</span>
                    </div>
                    <input type="range" id="toppRange" min="0" max="1" step="0.05" value="0.95" class="w-full accent-indigo-500" oninput="document.getElementById('toppVal').innerText = this.value">
                </div>

                <div>
                    <label class="block font-semibold text-slate-300 mb-1.5">Max Output Tokens</label>
                    <select id="maxTokensSelect" class="w-full bg-slate-900 border border-bordercol rounded-xl px-3 py-2 text-slate-200 outline-none focus:border-indigo-500">
                        <option value="4096">4,096 токенов</option>
                        <option value="8192" selected>8,192 токенов (Стандарт)</option>
                        <option value="16384">16,384 токенов</option>
                        <option value="65536">65,536 токенов (Максимум)</option>
                    </select>
                </div>

                <div>
                    <label class="block font-semibold text-slate-300 mb-1.5">Фильтры безопасности (Safety)</label>
                    <select id="safetySelect" class="w-full bg-slate-900 border border-bordercol rounded-xl px-3 py-2 text-slate-200 outline-none focus:border-indigo-500">
                        <option value="BLOCK_NONE" selected>🔓 BLOCK_NONE (Полная свобода кода)</option>
                        <option value="BLOCK_ONLY_HIGH">🛡️ BLOCK_ONLY_HIGH</option>
                        <option value="DEFAULT">🔒 DEFAULT (Стандартные)</option>
                    </select>
                </div>
            </div>
        </aside>
    </div>

    <script>
        let currentFile = null;

        function toggleSettings() {
            document.getElementById("settingsDrawer").classList.toggle("hidden");
        }

        window.onload = async () => {
            try {
                const mRes = await fetch("/api/models");
                const mData = await mRes.json();
                const sel = document.getElementById("modelSelect");
                for (const m of mData.models) {
                    const opt = document.createElement("option");
                    opt.value = m;
                    opt.innerText = m;
                    sel.appendChild(opt);
                }
            } catch (e) { console.error("Error loading models:", e); }

            const res = await fetch("/api/history");
            const history = await res.json();
            for (const item of history) {
                if (item.role === "user") appendUserMsg(item.content);
                else renderAgentEvents(item.events, item.model);
            }
        };

        async function uploadFile(input) {
            if (!input.files || input.files.length === 0) return;
            const fd = new FormData();
            fd.append("file", input.files[0]);
            const res = await fetch("/api/upload", { method: "POST", body: fd });
            const data = await res.json();
            if (data.status === "ok") {
                currentFile = data.filename;
                document.getElementById("fileBadgeName").innerHTML = `<i class="fa-solid fa-file mr-1"></i> ${data.filename}`;
                document.getElementById("fileBadge").classList.remove("hidden");
            }
        }

        function clearUploadedFile() {
            currentFile = null;
            document.getElementById("fileInput").value = "";
            document.getElementById("fileBadge").classList.add("hidden");
        }

        async function clearHistory() {
            if (!confirm("Очистить всю историю диалога?")) return;
            await fetch("/api/clear", { method: "POST" });
            document.getElementById("chatBox").innerHTML = "";
        }

        function appendUserMsg(text) {
            const chat = document.getElementById("chatBox");
            const d = document.createElement("div");
            d.className = "flex justify-end";
            d.innerHTML = `<div class="bg-indigo-600 text-white rounded-2xl rounded-tr-none px-4 py-3 max-w-2xl text-sm shadow-md leading-relaxed whitespace-pre-wrap">${text}</div>`;
            chat.appendChild(d);
            chat.scrollTop = chat.scrollHeight;
        }

        function renderAgentEvents(events, modelName) {
            const chat = document.getElementById("chatBox");
            const container = document.createElement("div");
            container.className = "flex flex-col space-y-3 max-w-3xl";
            container.innerHTML = `
                <div class="flex items-center space-x-2 text-indigo-400 text-xs font-semibold">
                    <i class="fa-solid fa-robot"></i> <span>Agent (${modelName || 'Gemini'})</span>
                </div>
                <div class="agent-body space-y-3"></div>
            `;
            chat.appendChild(container);
            const body = container.querySelector(".agent-body");

            let thoughtDetails = null;

            for (const ev of events) {
                if (ev.type === "thought") {
                    if (!thoughtDetails) {
                        thoughtDetails = document.createElement("details");
                        thoughtDetails.className = "bg-slate-900/90 border border-bordercol rounded-xl p-3 text-xs text-slate-300";
                        thoughtDetails.innerHTML = `
                            <summary class="cursor-pointer text-indigo-400 font-semibold flex items-center gap-2">
                                <i class="fa-solid fa-brain"></i> Рассуждения агента (View Thoughts)
                            </summary>
                            <div class="thought-txt mt-2 text-slate-400 font-mono whitespace-pre-wrap border-t border-bordercol pt-2 leading-relaxed"></div>
                        `;
                        body.appendChild(thoughtDetails);
                    }
                    thoughtDetails.querySelector(".thought-txt").innerText += ev.content;
                } else if (ev.type === "action") {
                    const act = document.createElement("div");
                    act.className = "bg-terminalbg border border-slate-800 rounded-xl p-3 text-xs shadow-inner";
                    act.innerHTML = `
                        <div class="text-amber-400 font-semibold mb-1 flex items-center gap-2">
                            <i class="fa-solid fa-terminal"></i> ${ev.title}
                        </div>
                        <pre class="bg-black/60 p-2.5 rounded text-slate-300 overflow-x-auto text-[11px]">${ev.detail}</pre>
                    `;
                    body.appendChild(act);
                } else if (ev.type === "final_text") {
                    const txt = document.createElement("div");
                    txt.className = "bg-cardbg border border-bordercol rounded-2xl p-4 text-sm text-slate-100 leading-relaxed shadow-sm markdown-body";
                    txt.innerHTML = marked.parse(ev.content);
                    txt.querySelectorAll('pre code').forEach((el) => { hljs.highlightElement(el); });
                    body.appendChild(txt);
                }
            }
            chat.scrollTop = chat.scrollHeight;
        }

        async function sendPrompt() {
            const input = document.getElementById("promptInput");
            const text = input.value.trim();
            if (!text) return;

            let fullPrompt = text;
            if (currentFile) {
                fullPrompt += `\\n[Прикреплен файл: ${currentFile}]`;
            }

            appendUserMsg(text);
            input.value = "";
            clearUploadedFile();

            const settings = {
                model: document.getElementById("modelSelect").value,
                temperature: document.getElementById("tempRange").value,
                top_p: document.getElementById("toppRange").value,
                max_tokens: document.getElementById("maxTokensSelect").value,
                safety: document.getElementById("safetySelect").value
            };

            const chat = document.getElementById("chatBox");
            const container = document.createElement("div");
            container.className = "flex flex-col space-y-3 max-w-3xl";
            container.innerHTML = `
                <div class="flex items-center space-x-2 text-indigo-400 text-xs font-semibold">
                    <i class="fa-solid fa-robot"></i> <span class="agent-title-text">Gemini Agent</span>
                    <span id="typingIndicator" class="text-slate-400 text-[11px] animate-pulse">● выполняет...</span>
                </div>
                <div class="agent-body space-y-3"></div>
            `;
            chat.appendChild(container);
            const body = container.querySelector(".agent-body");
            const titleEl = container.querySelector(".agent-title-text");

            const res = await fetch("/api/agent_stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: fullPrompt, settings: settings })
            });

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let thoughtDetails = null;

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                const messages = buffer.split(String.fromCharCode(10) + String.fromCharCode(10));
                buffer = messages.pop();

                for (const msg of messages) {
                    const cleanMsg = msg.trim();
                    if (!cleanMsg.startsWith("data: ")) continue;
                    try {
                        const ev = JSON.parse(cleanMsg.substring(6));
                        
                        if (ev.type === "model_info") {
                            titleEl.innerText = `Agent (${ev.model})`;
                            document.getElementById("activeModelIndicator").innerText = `Активна: ${ev.model}`;
                        } else if (ev.type === "thought") {
                            if (!thoughtDetails) {
                                thoughtDetails = document.createElement("details");
                                thoughtDetails.className = "bg-slate-900/90 border border-bordercol rounded-xl p-3 text-xs text-slate-300";
                                thoughtDetails.innerHTML = `
                                    <summary class="cursor-pointer text-indigo-400 font-semibold flex items-center gap-2">
                                        <i class="fa-solid fa-brain"></i> Рассуждения агента (View Thoughts)
                                    </summary>
                                    <div class="thought-txt mt-2 text-slate-400 font-mono whitespace-pre-wrap border-t border-bordercol pt-2 leading-relaxed"></div>
                                `;
                                body.appendChild(thoughtDetails);
                            }
                            thoughtDetails.querySelector(".thought-txt").innerText += ev.content;
                        } else if (ev.type === "action") {
                            const act = document.createElement("div");
                            act.className = "bg-terminalbg border border-slate-800 rounded-xl p-3 text-xs";
                            act.innerHTML = `
                                <div class="text-amber-400 font-semibold mb-1 flex items-center gap-2">
                                    <i class="fa-solid fa-terminal"></i> ${ev.title}
                                </div>
                                <pre class="bg-black/60 p-2.5 rounded text-slate-300 overflow-x-auto text-[11px]">${ev.detail}</pre>
                            `;
                            body.appendChild(act);
                        } else if (ev.type === "final_text") {
                            const txt = document.createElement("div");
                            txt.className = "bg-cardbg border border-bordercol rounded-2xl p-4 text-sm text-slate-100 leading-relaxed shadow-sm markdown-body";
                            txt.innerHTML = marked.parse(ev.content);
                            txt.querySelectorAll('pre code').forEach((el) => { hljs.highlightElement(el); });
                            body.appendChild(txt);
                        }
                        chat.scrollTop = chat.scrollHeight;
                    } catch (err) {
                        console.error("JSON parse error:", err, cleanMsg);
                    }
                }
            }
            const typing = container.querySelector("#typingIndicator");
            if (typing) typing.remove();
        }
    </script>
</body>
</html>
"""

# --- 9. FASTAPI ЭНДПОИНТЫ ---
@app.get("/", response_class=HTMLResponse)
async def serve_ui():
    return HTML_CODE

@app.get("/api/models")
async def get_models():
    return {"models": AVAILABLE_MODELS}

@app.get("/api/history")
async def get_hist():
    return load_history()

@app.post("/api/clear")
async def clear_hist():
    save_history([])
    log_console("🗑️ История диалога очищена.")
    return {"status": "cleared"}

@app.post("/api/upload")
async def handle_upload(file: UploadFile = File(...)):
    dest = WORKDIR / file.filename
    with open(dest, "wb") as f:
        f.write(await file.read())
    log_console(f"📁 Загружен файл через UI: {file.filename}")
    return {"status": "ok", "filename": file.filename}

@app.post("/api/agent_stream")
async def agent_stream(req: Request):
    data = await req.json()
    user_prompt = data.get("prompt", "")
    settings = data.get("settings", {})

    log_console(f"📨 [Новое сообщение]: {user_prompt[:80]}...")

    history = load_history()
    history.append({"role": "user", "content": user_prompt})

    async def event_stream() -> AsyncGenerator[str, None]:
        sys_instruction = """Ты — автономный Senior C++/CUDA/Python разработчик в окружении Kaggle с 2x Tesla T4 GPU.
        Твоя задача — исследовать структуру репозитория, компилировать, запускать, профилировать solver под архитектуру Turing (CUDA_ARCH=75).
        У тебя есть доступ к Bash, файловой системе и Git.
        Всегда сначала размышляй в мыслях. Ошибки исследуй и исправляй самостоятельно."""

        contents = []
        for item in history:
            if item["role"] == "user":
                contents.append(types.Content(role="user", parts=[types.Part.from_text(text=item["content"])]))

        agent_events = []
        active_model = "gemini-3.7-flash"

        for step in range(15):
            try:
                response, active_model = await call_gemini_async(contents, sys_instruction, settings)
                yield f"data: {json.dumps({'type': 'model_info', 'model': active_model})}\n\n"
            except Exception as e:
                err_ev = {"type": "final_text", "content": f"[Ошибка: {str(e)}]"}
                agent_events.append(err_ev)
                yield f"data: {json.dumps(err_ev)}\n\n"
                break

            # 1. Мысли (Thoughts)
            for cand in response.candidates:
                for part in cand.content.parts:
                    if getattr(part, 'thought', False):
                        th_ev = {"type": "thought", "content": part.text}
                        agent_events.append(th_ev)
                        yield f"data: {json.dumps(th_ev)}\n\n"

            # 2. Вызовы инструментов (Tools)
            if response.function_calls:
                for call in response.function_calls:
                    fn_name = call.name
                    fn_args = call.args

                    call_ev = {"type": "action", "title": f"Команда: {fn_name}", "detail": json.dumps(fn_args, ensure_ascii=False, indent=2)}
                    agent_events.append(call_ev)
                    yield f"data: {json.dumps(call_ev)}\\n\\n".replace("\\n", "\n")

                    f_map = {
                        "execute_bash": execute_bash,
                        "read_file": read_file,
                        "write_file": write_file,
                        "list_files": list_files,
                        "git_commit_and_push": git_commit_and_push,
                        "inspect_gpu": inspect_gpu
                    }
                    result = await asyncio.to_thread(f_map[fn_name], **fn_args) if fn_name in f_map else "Unknown tool"

                    res_ev = {"type": "action", "title": f"Вывод {fn_name}", "detail": str(result)[:1500]}
                    agent_events.append(res_ev)
                    yield f"data: {json.dumps(res_ev)}\n\n"

                    contents.append(response.candidates[0].content)
                    contents.append(types.Content(
                        role="tool",
                        parts=[types.Part.from_function_response(name=fn_name, response={"result": result})]
                    ))
            else:
                final_text = response.text or "Готово."
                fin_ev = {"type": "final_text", "content": final_text}
                agent_events.append(fin_ev)
                yield f"data: {json.dumps(fin_ev)}\n\n"
                break

        history.append({"role": "agent", "events": agent_events, "model": active_model})
        save_history(history)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

# --- 10. ЗАПУСК UVICORN И ЧИСТЫЙ SSH ТУННЕЛЬ ---
def start_api():
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")

def run_ssh_keepalive_tunnel():
    log_console("🌐 [Туннель] Запуск SSH Keep-Alive соединения...")
    cmd = "ssh -tt -o StrictHostKeyChecking=no -o ServerAliveInterval=15 -o ServerAliveCountMax=5 -R 80:localhost:8000 nokey@localhost.run"
    
    url_regex = re.compile(r'https?://[a-zA-Z0-9.-]+\.lhr\.life')
    
    while True:
        proc = subprocess.Popen(
            cmd,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            universal_newlines=True
        )
        for line in iter(proc.stdout.readline, ''):
            clean = line.strip()
            match = url_regex.search(clean)
            if match:
                url = match.group(0)
                print(f"\n========================================================", flush=True)
                print(f"🚀 ССЫЛКА НА ВАШ АГЕНТ: {url}", flush=True)
                print(f"========================================================\n", flush=True)
        proc.wait()
        time.sleep(3)

if __name__ == "__main__":
    threading.Thread(target=start_api, daemon=True).start()
    time.sleep(2)
    run_ssh_keepalive_tunnel()
