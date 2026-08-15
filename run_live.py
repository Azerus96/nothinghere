import os
import sys
import time
import subprocess
import re
from pathlib import Path

WORKDIR = Path("/kaggle/working/nothinghere")
BUILD_DIR = WORKDIR / "cuda_postflop_solver/build"

def build_solver():
    print("🔨 [1/3] Компиляция C++/CUDA солвера под 2x Tesla T4...", flush=True)
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    cmd = f"cd {BUILD_DIR} && cmake -DUSE_CUDA=ON -DCUDA_ARCH=75 .. && make -j4"
    res = subprocess.run(cmd, shell=True, text=True)
    if res.returncode != 0:
        print("❌ Ошибка компиляции!", flush=True)
        sys.exit(1)
    print("✅ Сборка успешно завершена.", flush=True)

def start_api_server():
    print("🚀 [2/3] Запуск FastAPI сервера на порту 8000...", flush=True)
    cmd = f"cd {WORKDIR} && python3 live_bridge.py"
    subprocess.Popen(cmd, shell=True)
    time.sleep(3)

def start_tunnel():
    print("🌐 [3/3] Подключение стабильного SSH-туннеля...", flush=True)
    
    ssh_dir = Path(os.path.expanduser("~/.ssh"))
    ssh_dir.mkdir(parents=True, exist_ok=True)
    key_path = ssh_dir / "id_ed25519"
    if not key_path.exists():
        subprocess.run(f"ssh-keygen -t ed25519 -N '' -f {key_path} -q", shell=True)

    rand_subdomain = f"poker-gto-{int(time.time()) % 10000}"
    cmd = f"ssh -tt -o StrictHostKeyChecking=no -o ServerAliveInterval=15 -o ServerAliveCountMax=5 -R {rand_subdomain}:80:localhost:8000 serveo.net"
    
    url_regex = re.compile(r'https://[a-zA-Z0-9.-]+(?:\.serveousercontent\.com|\.serveo\.net|\.lhr\.life)')

    proc = subprocess.Popen(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    for line in iter(proc.stdout.readline, ''):
        clean = line.strip()
        if not clean:
            continue
        print(f"[SSH] {clean}", flush=True)
        match = url_regex.search(clean)
        if match:
            url = match.group(0)
            print(f"\n========================================================", flush=True)
            print(f"🚀 ВАША РАБОЧАЯ ССЫЛКА ДЛЯ БУКМАРКЛЕТА (SERVER_URL):", flush=True)
            print(f"👉 {url}", flush=True)
            print(f"========================================================\n", flush=True)
    proc.wait()

if __name__ == "__main__":
    build_solver()
    start_api_server()
    start_tunnel()
