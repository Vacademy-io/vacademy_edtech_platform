"""Container entrypoint: one uvicorn process, or several behind an in-pod HAProxy.

    python -m app.supervisor

VB_PROCS unset or 1 -> exec uvicorn on :8090 exactly as before (no HAProxy, no
supervisor left running; behaviour is byte-for-byte the old CMD).

VB_PROCS=N (N > 1) -> why: one Python process runs on one core (the GIL) and
carries about five calls; a pod with N cores runs N processes to use them.
  * N uvicorn processes on 127.0.0.1:8091..8090+N, each told its slot
    (VB_PROC_INDEX) and the pod size (VB_PROCS) -- app/procs.py;
  * HAProxy on :8090 in front: /ws (a live call, minutes long) goes to the
    process with the FEWEST open connections, so calls spread evenly; every
    other route round-robins; a process that stops answering /health is taken
    out until it does;
  * a process that exits is restarted (its calls are lost, the others are not);
  * SIGTERM (after the preStop drain) stops the processes, then HAProxy.

Keep N <= the pod's CPU limit in cores: on 2026-11-23 three processes in a
2-core pod were throttled by the kernel quota even at ~1 core average, because
each can burst to a full core.
"""
from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import time

PORT = int(os.environ.get("PORT", "8090"))
BASE = PORT + 1
HEALTH = "/voice-bot-service/health"
CFG = "/tmp/haproxy.cfg"


def _log(msg: str) -> None:
    print(f"supervisor: {msg}", flush=True)


def _procs() -> int:
    try:
        return max(1, int(os.environ.get("VB_PROCS", "1")))
    except ValueError:
        return 1


def haproxy_cfg(n: int) -> str:
    servers = "\n".join(
        f"    server p{i} 127.0.0.1:{BASE + i} check inter 5s fall 3 rise 1"
        for i in range(n))
    # Timeouts: a call is up to ~30 min; the tunnel timeout is what governs an
    # upgraded websocket. No forwardfor: the ingress's X-Forwarded-For passes
    # through untouched.
    return f"""global
    maxconn 4096
    log stdout format raw local0 warning

defaults
    mode http
    log global
    option dontlognull
    timeout connect 5s
    timeout client 60s
    timeout server 120s
    timeout tunnel 2h
    timeout http-request 15s
    default-server maxconn 256

frontend fe
    bind :{PORT}
    acl is_ws path_end /ws
    use_backend calls if is_ws
    default_backend api

backend calls
    balance leastconn
    option httpchk GET {HEALTH}
{servers}

backend api
    balance roundrobin
    option httpchk GET {HEALTH}
    retry-on conn-failure
    retries 2
    option redispatch
{servers}
"""


class Supervisor:
    def __init__(self, n: int):
        self.n = n
        self.children: dict[int, subprocess.Popen] = {}
        self.haproxy: subprocess.Popen | None = None
        self.stopping = False

    def _spawn(self, i: int) -> None:
        env = dict(os.environ, VB_PROC_INDEX=str(i), VB_PROCS=str(self.n))
        self.children[i] = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app",
             "--host", "127.0.0.1", "--port", str(BASE + i)], env=env)
        _log(f"process {i} started pid={self.children[i].pid} port={BASE + i}")

    def _spawn_haproxy(self) -> None:
        self.haproxy = subprocess.Popen(["haproxy", "-db", "-f", CFG])
        _log(f"haproxy started pid={self.haproxy.pid} on :{PORT}")

    def _on_term(self, signum, _frame) -> None:
        self.stopping = True

    def run(self) -> int:
        from app.procs import SHM_DIR
        shutil.rmtree(SHM_DIR, ignore_errors=True)
        with open(CFG, "w") as f:
            f.write(haproxy_cfg(self.n))
        signal.signal(signal.SIGTERM, self._on_term)
        signal.signal(signal.SIGINT, self._on_term)
        for i in range(self.n):
            self._spawn(i)
        self._spawn_haproxy()
        while not self.stopping:
            time.sleep(1.0)
            if self.stopping:
                break
            for i, p in list(self.children.items()):
                rc = p.poll()
                if rc is not None:
                    _log(f"process {i} exited rc={rc} -- restarting")
                    self._spawn(i)
            if self.haproxy is not None and self.haproxy.poll() is not None:
                _log(f"haproxy exited rc={self.haproxy.returncode} -- restarting")
                self._spawn_haproxy()
        return self._shutdown()

    def _shutdown(self) -> int:
        _log("SIGTERM -- stopping processes")
        for p in self.children.values():
            if p.poll() is None:
                p.send_signal(signal.SIGTERM)
        deadline = time.time() + 25
        for p in self.children.values():
            try:
                p.wait(timeout=max(0.1, deadline - time.time()))
            except subprocess.TimeoutExpired:
                p.kill()
        if self.haproxy is not None and self.haproxy.poll() is None:
            self.haproxy.send_signal(signal.SIGUSR1)   # soft stop
            try:
                self.haproxy.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.haproxy.kill()
        _log("stopped")
        return 0


def main() -> int:
    n = _procs()
    if n == 1:
        # Exactly the old CMD: uvicorn replaces this process as PID 1.
        os.execvp(sys.executable, [sys.executable, "-m", "uvicorn", "app.main:app",
                                   "--host", "0.0.0.0", "--port", str(PORT)])
    if shutil.which("haproxy") is None:
        _log(f"VB_PROCS={n} but haproxy is not installed -- running ONE process")
        os.environ["VB_PROCS"] = "1"
        os.execvp(sys.executable, [sys.executable, "-m", "uvicorn", "app.main:app",
                                   "--host", "0.0.0.0", "--port", str(PORT)])
    return Supervisor(n).run()


if __name__ == "__main__":
    sys.exit(main())
