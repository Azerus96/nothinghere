import os
import sys
import json
import time
import asyncio
import threading
import subprocess
from pathlib import Path
from collections import deque
from typing import AsyncGenerator, List, Dict, Any

from fastapi import FastAPI, UploadFile, File, Request
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
import uvicorn
from kaggle_secrets import UserSecretsClient
from google import genai
from google.genai import types

# --- 1. СЕКРЕТЫ И НАСТРОЙКИ ---
secrets = UserSecretsClient()
GEMINI_KEY = secrets.get_secret("GEMINI_API_KEY")
GITHUB_TOKEN = secrets.get_secret("GITHUB_TOKEN")

os.environ["GEMINI_API_KEY"] = GEMINI_KEY
client = genai.Client()
WORKDIR = Path("/kaggle/working/nothinghere") if Path("/kaggle/working/nothinghere").exists() else Path("/kaggle/working")
HISTORY_FILE = Path("/kaggle/working/session_history.json")

app = FastAPI(title="Kaggle Vibe Agent")

# --- 2. МАСКИРОВАНИЕ СЕКРЕТОВ ---
def sanitize_logs(text: str) -> str:
    if GITHUB_TOKEN:
        text = text.replace(GITHUB_TOKEN, "ghp_***HIDDEN_TOKEN***")
    if GEMINI_KEY:
        text = text.replace(GEMINI_KEY, "AIza***HIDDEN_KEY***")
    return text

# --- 3. RATE LIMITER ДЛЯ ЗАЩИТЫ ОТ 429 ---
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
                await asyncio.sleep(wait_time)
        self.timestamps.append(time.time())

limiter = RollingRateLimiter(max_per_minute=12)

# --- 4. ДИНАМИЧЕСКИЙ СПИСОК ДОСТУПНЫХ МОДЕЛЕЙ ---
def get_available_gemini_models() -> List[str]:
    """Динамически запрашивает все доступные модели у Google API и выстраивает каскад приоритетов."""
    try:
        raw_models = []
        for m in client.models.list():
            clean_name = m.name.replace("models/", "")
            # Фильтруем генеративные модели общего назначения
            if "gemini" in clean_name and not any(x in clean_name for x in ["embed", "image", "tts", "robotics", "computer-use"]):
                raw_models.append(clean_name)

        # Желаемый порядок убывания интеллекта и агентных возможностей
        preferred_hierarchy = [
            "gemini-3.7-flash",
            "gemini-3.6-flash",
            "gemini-3.5-flash",
            "gemini-3.5-flash-lite",
            "gemini-3.1-pro-preview",
            "gemini-3.1-flash-lite",
            "gemini-2.5-pro",
            "gemini-2.5-flash",
            "gemini-2.5-flash-lite"
        ]

        cascade = [m for m in preferred_hierarchy if m in raw_models]
        for m in raw_models:
            if m not in cascade:
                cascade.append(m)

        print(f"🤖 [Discovery] Доступный каскад моделей: {cascade}")
        return cascade if cascade else ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-2.5-flash"]
    except Exception as e:
        print(f"⚠️ [Discovery Error] Ошибка запроса списка моделей: {e}. Используем базовый каскад.")
        return ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"]

AVAILABLE_MODELS = get_available_gemini_models()

# --- 5. ИНСТРУМЕНТЫ АГЕНТА (TOOLS) ---
def execute_bash(command: str) -> str:
    """Выполняет bash-команду (компиляция, cmake, make, pip, pytest, nvidia-smi) в рабочем каталоге."""
    try:
        res = subprocess.run(command, shell=True, text=True, capture_output=True, timeout=300, cwd=WORKDIR)
        out = res.stdout + ("\n[STDERR]:\n" + res.stderr if res.stderr else "")
        return sanitize_logs(out.strip()) if out.strip() else "[Успешно без вывода]"
    except subprocess.TimeoutExpired:
        return "[Ошибка: Превышен таймаут 300 секунд]"
    except Exception as e:
        return f"[Исключение при выполнении: {str(e)}]"

def read_file(path: str) -> str:
    """Читает содержимое файла проекта."""
    p = WORKDIR / path if not Path(path).is_absolute() else Path(path)
    if not p.exists():
        return f"[Ошибка: Файл {path} не найден]"
    try:
        return p.read_text(encoding="utf-8")
    except Exception as e:
        return f"[Ошибка чтения: {str(e)}]"

def write_file(path: str, content: str) -> str:
    """Создает или обновляет файл по указанному пути."""
    p = WORKDIR / path if not Path(path).is_absolute() else Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    try:
        p.write_text(content, encoding="utf-8")
        return f"Файл {path} успешно сохранен."
    except Exception as e:
        return f"[Ошибка записи: {str(e)}]"

def list_files(directory: str = ".") -> str:
    """Возвращает структуру каталогов и файлов."""
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
    """Коммитит и пушит изменения в текущий репозиторий через GitHub Token."""
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
    """Проверяет утилизацию и память 2x Tesla T4."""
    return execute_bash("nvidia-smi --query-gpu=index,name,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu --format=csv")

tools_list = [execute_bash, read_file, write_file, list_files, git_commit_and_push, inspect_gpu]

# --- 6. КАСКАДНЫЙ ИСПОЛНИТЕЛЬ С AUTO-RETRY ---
async def call_gemini_cascade(contents: list, sys_inst: str):
    last_err = None
    for model_name in AVAILABLE_MODELS:
        for attempt in range(3):
            await limiter.acquire()
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        system_instruction=sys_inst,
                        tools=tools_list,
                        temperature=0.2,
                    )
                )
                return response, model_name
            except Exception as e:
                err_str = str(e)
                last_err = err_str
                # Временные ошибки серверов или квот: ждем и повторяем
                if any(code in err_str for code in ["503", "429", "UNAVAILABLE", "RESOURCE_EXHAUSTED"]):
                    await asyncio.sleep(2.5 * (attempt + 1))
                else:
                    break  # Если ошибка синтаксическая — переходим к следующей модели
    raise Exception(f"Все доступные модели исчерпаны. Ошибка: {last_err}")

# --- 7. ХРАНЕНИЕ ИСТОРИИ ---
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

# --- 8. ФРОНТЕНД ИНТЕРФЕЙС ---
HTML_CODE = """
<!DOCTYPE html>
<html lang="ru" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kaggle Vibe Agent (2x T4)</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        darkbg: '#090d16',
                        cardbg: '#131b2e',
                        bordercol: '#1e293b',
                        terminalbg: '#02040a'
                    }
                }
            }
        }
    </script>
    <style>
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        pre, code { font-family: 'JetBrains Mono', Consolas, Monaco, monospace; }
    </style>
</head>
<body class="bg-darkbg text-slate-100 h-screen flex flex-col antialiased">
    
    <header class="bg-cardbg border-b border-bordercol px-6 py-3 flex justify-between items-center shadow-md">
        <div class="flex items-center space-x-3">
            <div class="bg-gradient-to-tr from-cyan-500 to-indigo-600 p-2.5 rounded-xl shadow-lg">
                <i class="fa-solid fa-microchip text-white text-lg"></i>
            </div>
            <div>
                <h1 class="font-bold text-base text-white tracking-wide">Gemini Auto-Cascade Agent</h1>
                <p id="modelCascadeList" class="text-xs text-slate-400">Target: 2x Tesla T4 (Arch 75) • Dynamic Discovery</p>
            </div>
        </div>
        <div class="flex items-center space-x-3">
            <span class="inline-flex items-center gap-1.5 py-1 px-3 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> 2x T4 Ready
            </span>
            <button onclick="clearHistory()" class="text-xs bg-slate-800 hover:bg-red-950/40 hover:text-red-400 text-slate-400 px-3 py-1.5 rounded-lg border border-bordercol transition">
                <i class="fa-solid fa-trash-can mr-1"></i> Сброс
            </button>
        </div>
    </header>

    <main id="chatBox" class="flex-1 overflow-y-auto p-6 space-y-6 max-w-5xl w-full mx-auto"></main>

    <footer class="bg-cardbg border-t border-bordercol p-4">
        <div class="max-w-5xl mx-auto flex flex-col space-y-2">
            <div id="fileBadge" class="hidden text-xs bg-indigo-950/60 text-indigo-300 border border-indigo-700/50 px-3 py-1.5 rounded-lg flex items-center justify-between w-fit gap-3">
                <span id="fileBadgeName"><i class="fa-solid fa-paperclip mr-1.5"></i></span>
                <button onclick="clearUploadedFile()" class="text-slate-400 hover:text-red-400"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <div class="flex items-center space-x-3 bg-darkbg border border-bordercol rounded-2xl p-2.5 focus-within:border-indigo-500 transition">
                <label class="cursor-pointer text-slate-400 hover:text-indigo-400 p-2 transition">
                    <i class="fa-solid fa-cloud-arrow-up text-lg"></i>
                    <input type="file" id="fileInput" class="hidden" onchange="uploadFile(this)">
                </label>
                <textarea id="promptInput" rows="1" placeholder="Поставьте задачу (например: покажи файлы, собери solver, проверь GPU)..." 
                    class="flex-1 bg-transparent border-0 focus:ring-0 text-slate-100 placeholder-slate-500 resize-none outline-none text-sm leading-relaxed"
                    onkeydown="if(event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendPrompt(); }"></textarea>
                <button onclick="sendPrompt()" id="sendBtn" class="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl transition flex items-center gap-2 text-sm font-semibold shadow-md">
                    <span>Запуск</span>
                    <i class="fa-solid fa-paper-plane text-xs"></i>
                </button>
            </div>
        </div>
    </footer>

    <script>
        let currentFile = null;

        window.onload = async () => {
            const modelsRes = await fetch("/api/models");
            const modelsData = await modelsRes.json();
            if (modelsData.models) {
                document.getElementById("modelCascadeList").innerText = "Каскад: " + modelsData.models.slice(0, 3).join(" ➔ ");
            }

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
            if (!confirm("Очистить историю диалога?")) return;
            await fetch("/api/clear", { method: "POST" });
            document.getElementById("chatBox").innerHTML = "";
        }

        function appendUserMsg(text) {
            const chat = document.getElementById("chatBox");
            const d = document.createElement("div");
            d.className = "flex justify-end";
            d.innerHTML = `<div class="bg-indigo-600 text-white rounded-2xl rounded-tr-none px-4 py-3 max-w-2xl text-sm shadow-md">${text}</div>`;
            chat.appendChild(d);
            chat.scrollTop = chat.scrollHeight;
        }

        function renderAgentEvents(events, modelName) {
            const chat = document.getElementById("chatBox");
            const container = document.createElement("div");
            container.className = "flex flex-col space-y-3 max-w-4xl";
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
                        thoughtDetails.className = "bg-slate-900/90 border border-slate-800 rounded-xl p-3 text-xs text-slate-300";
                        thoughtDetails.innerHTML = `
                            <summary class="cursor-pointer text-indigo-400 font-semibold flex items-center gap-2">
                                <i class="fa-solid fa-brain"></i> Рассуждения агента (View Thoughts)
                            </summary>
                            <div class="thought-txt mt-2 text-slate-400 font-mono whitespace-pre-wrap border-t border-slate-800 pt-2 leading-relaxed"></div>
                        `;
                        body.appendChild(thoughtDetails);
                    }
                    thoughtDetails.querySelector(".thought-txt").innerText += ev.content;
                } else if (ev.type === "action") {
                    const act = document.createElement("div");
                    act.className = "bg-terminalbg border border-slate-800/80 rounded-xl p-3 text-xs";
                    act.innerHTML = `
                        <div class="text-amber-400 font-semibold mb-1 flex items-center gap-2">
                            <i class="fa-solid fa-terminal"></i> ${ev.title}
                        </div>
                        <pre class="bg-black/60 p-2.5 rounded text-slate-300 overflow-x-auto text-[11px]">${ev.detail}</pre>
                    `;
                    body.appendChild(act);
                } else if (ev.type === "final_text") {
                    const txt = document.createElement("div");
                    txt.className = "bg-cardbg border border-bordercol rounded-2xl p-4 text-sm text-slate-100 leading-relaxed shadow-sm";
                    txt.innerHTML = ev.content.replace(/\\n/g, "<br>");
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

            const chat = document.getElementById("chatBox");
            const container = document.createElement("div");
            container.className = "flex flex-col space-y-3 max-w-4xl";
            container.innerHTML = `
                <div class="flex items-center space-x-2 text-indigo-400 text-xs font-semibold">
                    <i class="fa-solid fa-robot"></i> <span class="agent-title-text">Gemini Agent</span>
                    <span id="typingIndicator" class="text-slate-400 text-[10px] animate-pulse">● выполняет...</span>
                </div>
                <div class="agent-body space-y-3"></div>
            `;
            chat.appendChild(container);
            const body = container.querySelector(".agent-body");
            const titleEl = container.querySelector(".agent-title-text");

            const res = await fetch("/api/agent_stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: fullPrompt })
            });

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let thoughtDetails = null;

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split("\\n");
                buffer = lines.pop();

                for (const line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    try {
                        const ev = JSON.parse(line.substring(6));
                        
                        if (ev.type === "model_info") {
                            titleEl.innerText = `Agent (${ev.model})`;
                        } else if (ev.type === "thought") {
                            if (!thoughtDetails) {
                                thoughtDetails = document.createElement("details");
                                thoughtDetails.className = "bg-slate-900/90 border border-slate-800 rounded-xl p-3 text-xs text-slate-300";
                                thoughtDetails.innerHTML = `
                                    <summary class="cursor-pointer text-indigo-400 font-semibold flex items-center gap-2">
                                        <i class="fa-solid fa-brain"></i> Рассуждения агента (View Thoughts)
                                    </summary>
                                    <div class="thought-txt mt-2 text-slate-400 font-mono whitespace-pre-wrap border-t border-slate-800 pt-2 leading-relaxed"></div>
                                `;
                                body.appendChild(thoughtDetails);
                            }
                            thoughtDetails.querySelector(".thought-txt").innerText += ev.content;
                        } else if (ev.type === "action") {
                            const act = document.createElement("div");
                            act.className = "bg-terminalbg border border-slate-800/80 rounded-xl p-3 text-xs";
                            act.innerHTML = `
                                <div class="text-amber-400 font-semibold mb-1 flex items-center gap-2">
                                    <i class="fa-solid fa-terminal"></i> ${ev.title}
                                </div>
                                <pre class="bg-black/60 p-2.5 rounded text-slate-300 overflow-x-auto text-[11px]">${ev.detail}</pre>
                            `;
                            body.appendChild(act);
                        } else if (ev.type === "final_text") {
                            const txt = document.createElement("div");
                            txt.className = "bg-cardbg border border-bordercol rounded-2xl p-4 text-sm text-slate-100 leading-relaxed";
                            txt.innerHTML = ev.content.replace(/\\n/g, "<br>");
                            body.appendChild(txt);
                        }
                        chat.scrollTop = chat.scrollHeight;
                    } catch (err) {
                        console.error("JSON parse error:", err);
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

# --- 9. FASTAPI РОУТЫ ---
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
    return {"status": "cleared"}

@app.post("/api/upload")
async def handle_upload(file: UploadFile = File(...)):
    dest = WORKDIR / file.filename
    with open(dest, "wb") as f:
        f.write(await file.read())
    return {"status": "ok", "filename": file.filename}

@app.post("/api/agent_stream")
async def agent_stream(req: Request):
    data = await req.json()
    user_prompt = data.get("prompt", "")

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
        active_model = AVAILABLE_MODELS[0] if AVAILABLE_MODELS else "gemini-3.7-flash"

        for step in range(15):
            try:
                response, active_model = await call_gemini_cascade(contents, sys_instruction)
                yield f"data: {json.dumps({'type': 'model_info', 'model': active_model})}\\n\\n"
            except Exception as e:
                err_ev = {"type": "final_text", "content": f"[Ошибка: {str(e)}]"}
                agent_events.append(err_ev)
                yield f"data: {json.dumps(err_ev)}\\n\\n"
                break

            # 1. Мысли (Thoughts)
            for cand in response.candidates:
                for part in cand.content.parts:
                    if getattr(part, 'thought', False):
                        th_ev = {"type": "thought", "content": part.text}
                        agent_events.append(th_ev)
                        yield f"data: {json.dumps(th_ev)}\\n\\n"

            # 2. Вызовы инструментов (Tools)
            if response.function_calls:
                for call in response.function_calls:
                    fn_name = call.name
                    fn_args = call.args

                    call_ev = {"type": "action", "title": f"Команда: {fn_name}", "detail": json.dumps(fn_args, ensure_ascii=False, indent=2)}
                    agent_events.append(call_ev)
                    yield f"data: {json.dumps(call_ev)}\\n\\n"

                    f_map = {
                        "execute_bash": execute_bash,
                        "read_file": read_file,
                        "write_file": write_file,
                        "list_files": list_files,
                        "git_commit_and_push": git_commit_and_push,
                        "inspect_gpu": inspect_gpu
                    }
                    result = f_map[fn_name](**fn_args) if fn_name in f_map else "Unknown tool"

                    res_ev = {"type": "action", "title": f"Вывод {fn_name}", "detail": str(result)[:1500]}
                    agent_events.append(res_ev)
                    yield f"data: {json.dumps(res_ev)}\\n\\n"

                    contents.append(response.candidates[0].content)
                    contents.append(types.Content(
                        role="tool",
                        parts=[types.Part.from_function_response(name=fn_name, response={"result": result})]
                    ))
            else:
                final_text = response.text or "Готово."
                fin_ev = {"type": "final_text", "content": final_text}
                agent_events.append(fin_ev)
                yield f"data: {json.dumps(fin_ev)}\\n\\n"
                break

        history.append({"role": "agent", "events": agent_events, "model": active_model})
        save_history(history)

    return StreamingResponse(event_stream(), media_type="text/event-stream")

# --- 10. ЗАПУСК СЕРВЕРА И SSH ТУННЕЛЯ ---
def start_api():
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")

def run_ssh_keepalive_tunnel():
    cmd = [
        "ssh",
        "-o", "StrictHostKeyChecking=no",
        "-o", "ServerAliveInterval=15",
        "-o", "ServerAliveCountMax=5",
        "-R", "80:localhost:8000",
        "nokey@localhost.run"
    ]
    while True:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for line in proc.stdout:
            if "lhr.life" in line or "localhost.run" in line:
                print(f"\n========================================================")
                print(f"🚀 ССЫЛКА НА ВАШ АГЕНТ: {line.strip()}")
                print(f"========================================================\n")
        proc.wait()
        time.sleep(3)

if __name__ == "__main__":
    threading.Thread(target=start_api, daemon=True).start()
    time.sleep(2)
    run_ssh_keepalive_tunnel()
