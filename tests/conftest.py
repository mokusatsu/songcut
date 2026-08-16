"""共有pytest設定と、長時間テストを観測する進捗reporter。"""

from __future__ import annotations

import threading
import time
from contextlib import contextmanager
from typing import Iterator

import pytest


class _SongcutProgressReporter:
    """各test itemのphase、経過時間、長時間heartbeatをterminalへ出す。"""

    def __init__(self, config: pytest.Config, heartbeat_interval: float) -> None:
        self.config = config
        self.heartbeat_interval = heartbeat_interval
        self.total = 0
        self.positions: dict[str, int] = {}
        self.starts: dict[str, float] = {}
        self.outcomes: dict[str, dict[str, str]] = {}
        self._write_lock = threading.Lock()

    def _write(self, message: str) -> None:
        reporter = self.config.pluginmanager.get_plugin("terminalreporter")
        if reporter is None:
            return
        with self._write_lock:
            reporter.write_line(f"[pytest-progress] {message}")

    def _position(self, nodeid: str) -> str:
        position = self.positions.get(nodeid)
        return f"[{position}/{self.total}]" if position is not None else "[?/?]"

    def collection_finish(self, session: pytest.Session) -> None:
        self.total = len(session.items)
        self.positions = {item.nodeid: index for index, item in enumerate(session.items, start=1)}
        self._write(f"COLLECTED total={self.total}")

    def pytest_runtest_logstart(self, nodeid: str, location: tuple[str, int | None, str]) -> None:
        self.starts[nodeid] = time.monotonic()
        self.outcomes[nodeid] = {}
        self._write(f"START {self._position(nodeid)} {nodeid}")

    def pytest_runtest_logreport(self, report: pytest.TestReport) -> None:
        if report.when not in {"setup", "call", "teardown"}:
            return
        self.outcomes.setdefault(report.nodeid, {})[report.when] = report.outcome
        self._write(
            f"RESULT {self._position(report.nodeid)} phase={report.when} "
            f"status={report.outcome} duration={report.duration:.3f}s"
        )

    def pytest_runtest_logfinish(self, nodeid: str, location: tuple[str, int | None, str]) -> None:
        started = self.starts.pop(nodeid, None)
        elapsed = time.monotonic() - started if started is not None else 0.0
        phase_outcomes = self.outcomes.pop(nodeid, {})
        status = "passed" if all(value == "passed" for value in phase_outcomes.values()) else ",".join(
            f"{phase}:{value}" for phase, value in phase_outcomes.items()
        )
        self._write(
            f"END {self._position(nodeid)} status={status or 'unknown'} "
            f"elapsed={elapsed:.3f}s {nodeid}"
        )

    @contextmanager
    def phase(self, item: pytest.Item, name: str) -> Iterator[None]:
        started = time.monotonic()
        stop = threading.Event()
        self._write(f"PHASE-START {self._position(item.nodeid)} phase={name} {item.nodeid}")
        heartbeat = threading.Thread(
            target=self._heartbeat,
            args=(item.nodeid, name, started, stop),
            name="songcut-pytest-heartbeat",
            daemon=True,
        )
        heartbeat.start()
        try:
            yield
        finally:
            stop.set()
            heartbeat.join(timeout=0.25)
            self._write(
                f"PHASE-END {self._position(item.nodeid)} phase={name} "
                f"elapsed={time.monotonic() - started:.3f}s {item.nodeid}"
            )

    def _heartbeat(
        self,
        nodeid: str,
        phase: str,
        started: float,
        stop: threading.Event,
    ) -> None:
        while not stop.wait(self.heartbeat_interval):
            self._write(
                f"HEARTBEAT {self._position(nodeid)} phase={phase} "
                f"elapsed={time.monotonic() - started:.1f}s {nodeid}"
            )


def pytest_addoption(parser: pytest.Parser) -> None:
    group = parser.getgroup("songcut")
    group.addoption(
        "--songcut-progress",
        action="store_true",
        default=True,
        dest="songcut_progress",
        help="各pytest itemのphaseとheartbeatを表示する（既定: 有効）",
    )
    group.addoption(
        "--no-songcut-progress",
        action="store_false",
        dest="songcut_progress",
        help="Songcut固有の進捗ログを無効化する",
    )
    group.addoption(
        "--songcut-progress-interval",
        type=float,
        default=30.0,
        metavar="SECONDS",
        help="長時間phaseのheartbeat間隔（秒、既定: 30）",
    )


def pytest_configure(config: pytest.Config) -> None:
    if not config.getoption("songcut_progress"):
        return
    interval = config.getoption("songcut_progress_interval")
    if interval <= 0:
        raise pytest.UsageError("--songcut-progress-intervalは0より大きくしてください")
    config.pluginmanager.register(
        _SongcutProgressReporter(config, interval),
        "songcut-progress",
    )


def pytest_collection_finish(session: pytest.Session) -> None:
    reporter = session.config.pluginmanager.get_plugin("songcut-progress")
    if reporter is not None:
        reporter.collection_finish(session)


@pytest.hookimpl(hookwrapper=True, tryfirst=True)
def pytest_runtest_setup(item: pytest.Item) -> Iterator[None]:
    reporter = item.config.pluginmanager.get_plugin("songcut-progress")
    if reporter is None:
        yield
        return
    with reporter.phase(item, "setup"):
        yield


@pytest.hookimpl(hookwrapper=True, tryfirst=True)
def pytest_runtest_call(item: pytest.Item) -> Iterator[None]:
    reporter = item.config.pluginmanager.get_plugin("songcut-progress")
    if reporter is None:
        yield
        return
    with reporter.phase(item, "call"):
        yield


@pytest.hookimpl(hookwrapper=True, tryfirst=True)
def pytest_runtest_teardown(item: pytest.Item) -> Iterator[None]:
    reporter = item.config.pluginmanager.get_plugin("songcut-progress")
    if reporter is None:
        yield
        return
    with reporter.phase(item, "teardown"):
        yield
