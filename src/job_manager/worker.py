"""Run separately from Uvicorn so jobs outlive individual HTTP requests."""

import argparse
import logging
import signal
import threading
import time

from job_manager.database import make_engine
from job_manager.experiments import LeaseLost, monte_carlo_pi
from job_manager.settings import Settings
from job_manager.store import JobStore

logger = logging.getLogger(__name__)


class Worker:
    def __init__(self, store: JobStore, runner=monte_carlo_pi):
        self.store = store
        self.runner = runner

    def run_once(self) -> bool:
        self.store.recover_expired()
        claim = self.store.claim_next()
        if claim is None:
            return False
        started = time.perf_counter()
        logger.info("job_started id=%s", claim.id)
        try:
            result = self.runner(
                claim.parameters, lambda progress: self.store.checkpoint(claim, progress)
            )
            result["duration_seconds"] = time.perf_counter() - started
            committed = self.store.finish(claim, result)
            logger.info("job_finished id=%s result_committed=%s", claim.id, committed)
        except LeaseLost:
            logger.info("job_lease_lost id=%s", claim.id)
        except Exception as exc:
            logger.exception("job_failed id=%s", claim.id)
            self.store.fail(claim, f"Job execution failed ({type(exc).__name__}).")
        return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="Process at most one job, then exit")
    args = parser.parse_args()
    settings = Settings.from_env()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    engine = make_engine(settings.database_url)
    worker = Worker(JobStore(engine, settings.lease_seconds))
    stop = threading.Event()

    def request_stop(_signum, _frame):
        # Finish the current bounded workload, then stop claiming new jobs.
        stop.set()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    try:
        if args.once:
            worker.run_once()
            return
        while not stop.is_set():
            if not worker.run_once():
                stop.wait(settings.poll_seconds)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
