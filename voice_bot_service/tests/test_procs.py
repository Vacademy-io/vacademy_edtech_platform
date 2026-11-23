"""app/procs.py: pod-wide counts and single-use tokens across bot processes."""
import importlib
import os
import subprocess
import sys

import pytest


@pytest.fixture
def procs(tmp_path, monkeypatch):
    monkeypatch.setenv("VB_SHM_DIR", str(tmp_path / "shm"))
    monkeypatch.setenv("VB_PROCS", "3")
    monkeypatch.setenv("VB_PROC_INDEX", "0")
    import app.procs as m
    return importlib.reload(m)


def _as(procs, monkeypatch, i):
    monkeypatch.setenv("VB_PROC_INDEX", str(i))


def test_single_process_is_a_no_op(tmp_path, monkeypatch):
    monkeypatch.setenv("VB_SHM_DIR", str(tmp_path / "shm"))
    monkeypatch.delenv("VB_PROCS", raising=False)
    monkeypatch.delenv("VB_PROC_INDEX", raising=False)
    import app.procs as m
    m = importlib.reload(m)
    assert m.count() == 1 and m.index() == 0 and m.is_leader() and not m.multi()
    m.publish(4, 1)
    assert not (tmp_path / "shm").exists()
    assert m.pod_totals(4, 1) == (4, 1)


def test_totals_sum_every_process(procs, monkeypatch):
    _as(procs, monkeypatch, 1)
    procs.publish(2, 1)
    _as(procs, monkeypatch, 2)
    procs.publish(3, 0)
    _as(procs, monkeypatch, 0)
    # Process 0's own numbers come from memory, not its file.
    assert procs.pod_totals(4, 2) == (9, 3)


def test_a_dead_process_counts_zero(procs, monkeypatch, tmp_path):
    p = subprocess.Popen([sys.executable, "-c", "pass"])
    p.wait()
    shm = tmp_path / "shm"
    shm.mkdir(parents=True, exist_ok=True)
    (shm / "active.1").write_text(f"5 0 {p.pid}")
    _as(procs, monkeypatch, 2)
    procs.publish(1, 0)
    _as(procs, monkeypatch, 0)
    assert procs.pod_totals(0, 0) == (1, 0)


def test_garbage_count_file_is_ignored(procs, monkeypatch, tmp_path):
    shm = tmp_path / "shm"
    shm.mkdir(parents=True, exist_ok=True)
    (shm / "active.1").write_text("not numbers")
    assert procs.pod_totals(2, 0) == (2, 0)


def test_token_is_single_use_across_processes(procs, monkeypatch):
    assert procs.spend_token_shared("corr-1|tok", 900) is True
    _as(procs, monkeypatch, 2)            # another process, same pod
    assert procs.spend_token_shared("corr-1|tok", 900) is False
    assert procs.spend_token_shared("corr-2|tok", 900) is True


def test_expired_spends_are_pruned(procs, tmp_path):
    assert procs.spend_token_shared("old|tok", 900)
    spent = tmp_path / "shm" / "spent"
    (f,) = list(spent.iterdir())
    os.utime(f, (1, 1))                   # spent long ago
    procs._prune_tokens(older_than=1000)
    assert not list(spent.iterdir())


def test_only_process_zero_leads(procs, monkeypatch):
    assert procs.is_leader()
    _as(procs, monkeypatch, 1)
    assert not procs.is_leader()


def test_haproxy_config_lists_every_process():
    from app.supervisor import haproxy_cfg
    cfg = haproxy_cfg(3)
    for port in (8091, 8092, 8093):
        assert cfg.count(f"127.0.0.1:{port}") == 2    # calls + api backends
    assert "balance leastconn" in cfg and "timeout tunnel" in cfg
