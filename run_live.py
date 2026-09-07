import os
import sys
import time
import subprocess
import re
from pathlib import Path

WORKDIR = Path("/kaggle/working/nothinghere")
BUILD_DIR = WORKDIR / "cuda_postflop_solver/build"

def build_solver():
    print("🔨 [1/3] Сборка C++/CUDA солвера под 2x Tesla T4...", flush=True)
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    cmd = f"cd {BUILD_DIR} && cmake -DUSE_CUDA=ON -DCUDA_ARCH=75 .. && make -j4 live_solver"
    res = subprocess.run(cmd, shell=True, text=True)
    if res.returncode != 0:
        print("❌ Ошибка сборки live_solver!", flush=True)
        sys.exit(1)
    print("✅ Сборка live_solver успешно завершена.", flush=True)

def start_api_server():
    print("🚀 [2/3] Запуск FastAPI сервера на порту 8000...", flush=True)
    cmd = f"cd {WORKDIR} && python3 live_bridge.py"
    subprocess.Popen(cmd, shell=True)
    time.sleep(2)

def start_tunnel():
    print("🌐 [3/3] Запуск Cloudflare HTTPS туннеля...", flush=True)
    cf_bin = Path("/kaggle/working/cloudflared")
    if not cf_bin.exists():
        subprocess.run("wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O /kaggle/working/cloudflared && chmod +x /kaggle/working/cloudflared", shell=True)

    cmd = "/kaggle/working/cloudflared tunnel --url http://127.0.0.1:8000"
    url_regex = re.compile(r'https://[a-zA-Z0-9.-]+\.trycloudflare\.com')

    proc = subprocess.Popen(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    for line in iter(proc.stdout.readline, ''):
        match = url_regex.search(line)
        if match:
            url = match.group(0)
            print(f"\n========================================================", flush=True)
            print(f"🚀 ВАША ПОСТОЯННАЯ ССЫЛКА ДЛЯ БУКМАРКЛЕТА:", flush=True)
            print(f"👉 {url}", flush=True)
            print(f"========================================================\n", flush=True)
            break
    proc.wait()

if __name__ == "__main__":
    build_solver()
    start_api_server()
    start_tunnel()
