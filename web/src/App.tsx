import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Copy,
  FlaskConical,
  LayoutDashboard,
  Link2,
  ListFilter,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { ApiClient } from "./api";
import { DemoClient } from "./demo";
import { validateParameters } from "./experiment";
import {
  clock,
  compact,
  ConvergenceChart,
  duration,
  labels,
  Modal,
  number,
  StatusPill,
} from "./components";
import type { Client, Job, JobEvent, Parameters, Status } from "./types";

const REPO = "https://github.com/JesU2504/experiment-job-manager";
const isActive = (status: Status) =>
  status === "running" || status === "queued";
function newDemo() {
  let storage: Storage | undefined;
  try {
    storage = window.sessionStorage;
  } catch {
    /* Private browsing can disable storage. */
  }
  return new DemoClient(storage);
}

export default function App() {
  const [client, setClient] = useState<Client>(newDemo);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<"run" | "connect" | "architecture" | null>(
    null,
  );
  const [toast, setToast] = useState<{
    message: string;
    error?: boolean;
  } | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [codeView, setCodeView] = useState(false);
  const [nav, setNav] = useState("overview");
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const bootstrapped = useRef(new WeakSet<Client>());
  const connectionAttempt = useRef(0);
  const closeModal = useCallback(() => {
    connectionAttempt.current++;
    setModal(null);
  }, []);

  useEffect(() => {
    let alive = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const items = await client.list();
        if (!alive) return;
        setJobs(items);
        setSelectedId((current) =>
          items.some((job) => job.id === current)
            ? current
            : (items[0]?.id ?? null),
        );
        setConnectionError("");
      } catch (error) {
        if (alive)
          setConnectionError(
            error instanceof Error
              ? error.message
              : "Could not load experiments.",
          );
      } finally {
        pending = false;
      }
    };
    refreshRef.current = refresh;
    const unsubscribe = client.subscribe?.(() => {
      void refresh();
    });
    void (async () => {
      try {
        const items = await client.list();
        if (!alive) return;
        if (
          client instanceof DemoClient &&
          items.length === 0 &&
          !bootstrapped.current.has(client)
        ) {
          bootstrapped.current.add(client);
          await client.submit({ samples: 100_000, seed: 42 }, true);
        }
      } catch (error) {
        if (alive)
          setConnectionError(
            error instanceof Error
              ? error.message
              : "Could not initialise this workspace.",
          );
      }
      await refresh();
    })();
    const timer = setInterval(() => {
      void refresh();
    }, 700);
    return () => {
      alive = false;
      clearInterval(timer);
      unsubscribe?.();
    };
  }, [client]);

  useEffect(() => () => client.dispose(), [client]);
  useEffect(() => {
    let alive = true;
    if (!selectedId) {
      setEvents([]);
      return;
    }
    client
      .events(selectedId)
      .then((data) => {
        if (alive) setEvents(data);
      })
      .catch(() => {
        if (alive) setEvents([]);
      });
    return () => {
      alive = false;
    };
  }, [client, selectedId, jobs]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const selected = jobs.find((job) => job.id === selectedId) ?? null;
  const succeeded = jobs.filter((job) => job.status === "succeeded");
  const active = jobs.filter((job) => isActive(job.status));
  const totalTime = succeeded.reduce(
    (sum, job) => sum + (job.result?.duration_seconds ?? 0),
    0,
  );
  const meanTime = succeeded.length
    ? duration(totalTime / succeeded.length)
    : "—";
  const visible = jobs.filter((job) => {
    const matchesStatus =
      filter === "all" ||
      (filter === "stopped"
        ? ["cancelled", "failed"].includes(job.status)
        : job.status === filter);
    const haystack =
      `${job.id} monte carlo pi ${job.parameters.seed} ${job.example ? "example" : ""}`.toLowerCase();
    return matchesStatus && haystack.includes(search.toLowerCase());
  });
  let points = selected ? client.series(selected.id) : [];
  if (selected?.result && points.length === 0)
    points = [
      {
        samples: selected.result.samples,
        estimate: selected.result.pi_estimate,
      },
    ];

  async function perform(action: () => Promise<Job>, message: string) {
    setBusy(true);
    try {
      const job = await action();
      setSelectedId(job.id);
      setToast({ message });
      await refreshRef.current();
      return job;
    } catch (error) {
      setToast({
        message:
          error instanceof Error
            ? error.message
            : "The action could not be completed.",
        error: true,
      });
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function connect(base: string, key: string) {
    const attempt = ++connectionAttempt.current;
    const next = new ApiClient(base, key);
    try {
      await next.list();
    } catch (error) {
      next.dispose();
      throw error;
    }
    if (attempt !== connectionAttempt.current) {
      next.dispose();
      return;
    }
    setSelectedId(null);
    setJobs([]);
    setEvents([]);
    setClient(next);
    setModal(null);
    setToast({ message: "Connected to your Python API." });
  }

  const exportResult = () => {
    if (!selected?.result) return;
    const blob = new Blob(
      [JSON.stringify({ mode: client.mode, job: selected, events }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `experiment-${selected.id.slice(0, 8)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const copy = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setToast({ message });
    } catch {
      setToast({
        message:
          "Copy is unavailable. You can copy the link from your address bar.",
        error: true,
      });
    }
  };
  const showExperiments = () => {
    setNav("experiments");
    setFilter("all");
    document
      .getElementById("experiments")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to workspace
      </a>
      <aside className="sidebar">
        <a className="brand" href="#main" onClick={() => setNav("overview")}>
          <span className="brand-icon">
            <FlaskConical size={24} />
          </span>
          <span>
            Experiment<span className="brand-sub">Job Manager</span>
          </span>
        </a>
        <div className="sidebar-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            className={`nav-item ${nav === "overview" ? "active" : ""}`}
            onClick={() => {
              setNav("overview");
              setFilter("all");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <LayoutDashboard size={18} />
            Overview
          </button>
          <button
            className={`nav-item ${nav === "experiments" ? "active" : ""}`}
            onClick={showExperiments}
          >
            <ListFilter size={18} />
            Experiments<span className="nav-count">{jobs.length}</span>
          </button>
          <button className="nav-item" onClick={() => setModal("architecture")}>
            <Boxes size={18} />
            Architecture
            <ArrowUpRight size={14} className="nav-arrow" />
          </button>
        </nav>
        <div className="sidebar-project">
          <span className="tiny-label">THE PROJECT</span>
          <p>A workspace for reproducible computational experiments.</p>
          <a href={REPO} target="_blank" rel="noreferrer">
            <Code2 size={16} />
            Explore the source
            <ArrowUpRight size={14} />
          </a>
        </div>
        <div className="sidebar-bottom">
          <div className="avatar">JU</div>
          <div>
            <strong>Jesus Urbaneja</strong>
            <span>Software engineering portfolio</span>
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Projects</span>
            <ChevronRight size={14} />
            <strong>Experiment Job Manager</strong>
          </div>
          <div className="topbar-actions">
            <a
              href={`${REPO}/blob/codex/initial-mvp/docs/walkthrough.md`}
              target="_blank"
              rel="noreferrer"
              className="walkthrough-link"
            >
              <CircleHelp size={16} />
              Walkthrough
            </a>
            <button
              className="button small"
              onClick={() =>
                void copy(window.location.origin, "Dashboard link copied.")
              }
            >
              <Share2 size={15} />
              Share demo
            </button>
          </div>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span />
                PROJECT DASHBOARD
              </div>
              <h1>Experiment workspace</h1>
              <p>
                Run reproducible calculations and inspect their progress,
                results and history.
              </p>
            </div>
            <button className="button primary" onClick={() => setModal("run")}>
              <Plus size={18} />
              New experiment
            </button>
          </div>

          <div
            className={`environment-banner ${client.mode === "api" ? "api-environment" : ""}`}
          >
            <div className="environment-icon">
              <Terminal size={20} />
            </div>
            <div className="environment-copy">
              <strong>
                {client.mode === "demo"
                  ? "You’re in the interactive browser demo"
                  : "Connected to your Python backend"}
              </strong>
              <span>
                {client.mode === "demo"
                  ? "Real calculations, run locally in this tab. No account or setup needed."
                  : "Jobs run in the separate Python worker and persist in your SQL database."}
              </span>
            </div>
            {client.mode === "demo" ? (
              <button
                className="button text-button"
                onClick={() => setModal("connect")}
              >
                Connect API
                <ArrowRight size={16} />
              </button>
            ) : (
              <button
                className="button text-button"
                onClick={() => {
                  setClient(newDemo());
                  setSelectedId(null);
                }}
              >
                Use browser demo
                <ArrowRight size={16} />
              </button>
            )}
          </div>
          {connectionError && (
            <div className="error-banner" role="alert">
              <span>{connectionError}</span>
              <button
                onClick={() => void refreshRef.current()}
                className="button small"
              >
                Try again
              </button>
            </div>
          )}

          <section className="stats-grid" aria-label="Workspace statistics">
            <Stat
              label="Total experiments"
              value={String(jobs.length).padStart(2, "0")}
              note="This workspace"
              icon={<FlaskConical size={18} />}
            />
            <Stat
              label="Completed"
              value={String(succeeded.length).padStart(2, "0")}
              note="Results ready to inspect"
              icon={<CheckCircle2 size={18} />}
              tone="green"
            />
            <Stat
              label="Active runs"
              value={String(active.length).padStart(2, "0")}
              note={
                active.length
                  ? `${active.filter((job) => job.status === "running").length} running · ${active.filter((job) => job.status === "queued").length} queued`
                  : "No jobs running or queued"
              }
              icon={<Activity size={18} />}
            />
            <Stat
              label="Average wall time"
              value={meanTime}
              note="Completed experiments"
              icon={<Clock3 size={18} />}
            />
          </section>

          <div className="workspace-grid">
            <div className="left-column">
              <section
                className="card experiments-card"
                id="experiments"
                aria-labelledby="experiments-title"
              >
                <div className="card-heading">
                  <div>
                    <h2 id="experiments-title">
                      Experiments
                      <span className="count-label">{jobs.length}</span>
                    </h2>
                    <p>A history of what you’ve tried and what happened.</p>
                  </div>
                  {client.mode === "demo" && (
                    <button
                      className="icon-button"
                      aria-label="Clear finished demo runs"
                      title="Clear finished demo runs"
                      disabled={!jobs.some((job) => !isActive(job.status))}
                      onClick={() => {
                        client.clearFinished?.();
                        void refreshRef.current();
                      }}
                    >
                      <Trash2 size={17} />
                    </button>
                  )}
                </div>
                <div className="experiment-toolbar">
                  <div className="filter-group" aria-label="Filter experiments">
                    {[
                      ["all", "All runs"],
                      ["running", "Running"],
                      ["succeeded", "Completed"],
                      ["stopped", "Stopped"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        aria-pressed={filter === value}
                        className={filter === value ? "selected" : ""}
                        onClick={() => setFilter(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="search-input">
                    <Search size={15} />
                    <span className="sr-only">
                      Search experiments by ID or seed
                    </span>
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search runs…"
                    />
                  </label>
                </div>
                <div className="table-scroll">
                  <table>
                    <caption className="sr-only">
                      Select an experiment to inspect its progress, result and
                      history.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">EXPERIMENT</th>
                        <th scope="col">STATUS</th>
                        <th scope="col">SAMPLES</th>
                        <th scope="col" className="time-column">
                          WALL TIME
                        </th>
                        <th scope="col">
                          <span className="sr-only">Select</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((job) => (
                        <tr
                          key={job.id}
                          tabIndex={0}
                          aria-selected={selectedId === job.id}
                          className={
                            selectedId === job.id ? "selected-row" : ""
                          }
                          onClick={() => {
                            setSelectedId(job.id);
                            setCodeView(false);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedId(job.id);
                              setCodeView(false);
                            }
                          }}
                        >
                          <td>
                            <div className="run-title">
                              <span className={`run-icon ${job.status}`}>
                                <FlaskConical size={16} />
                              </span>
                              <div>
                                <strong>
                                  Monte Carlo π
                                  {job.example && (
                                    <span className="example-label">
                                      Example
                                    </span>
                                  )}
                                </strong>
                                <span className="run-subtitle">
                                  {job.id.slice(0, 8)}
                                  <i />
                                  seed {job.parameters.seed}
                                </span>
                              </div>
                            </div>
                            {isActive(job.status) && (
                              <div className="row-progress">
                                <span
                                  style={{
                                    width: `${Math.round(job.progress * 100)}%`,
                                  }}
                                />
                              </div>
                            )}
                          </td>
                          <td>
                            <StatusPill status={job.status} />
                          </td>
                          <td className="numeric">
                            {compact(job.parameters.samples)}
                          </td>
                          <td className="numeric time-column">
                            {job.result
                              ? duration(job.result.duration_seconds)
                              : job.status === "running" && job.started_at
                                ? duration(
                                    (Date.now() -
                                      new Date(job.started_at).getTime()) /
                                      1000,
                                  )
                                : "—"}
                          </td>
                          <td>
                            <ChevronRight size={15} className="row-chevron" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {visible.length === 0 && (
                  <div className="empty-state">
                    <FlaskConical size={28} />
                    <h3>
                      {jobs.length
                        ? "No matching experiments"
                        : "Start with a small experiment"}
                    </h3>
                    <p>
                      {jobs.length
                        ? "Try another filter or search term."
                        : "Choose a sample size and seed. We’ll take it from there."}
                    </p>
                    <button
                      className="button small"
                      onClick={() =>
                        jobs.length
                          ? (setSearch(""), setFilter("all"))
                          : setModal("run")
                      }
                    >
                      {jobs.length ? "Reset filters" : "Create an experiment"}
                      <ArrowRight size={15} />
                    </button>
                  </div>
                )}
                <div className="table-footer">
                  <span>
                    Showing {visible.length} of {jobs.length} runs
                    {client.mode === "api" && jobs.length === 100
                      ? " · latest 100"
                      : ""}
                  </span>
                  <span className="live-indicator">
                    <i />
                    {connectionError
                      ? "Reconnecting"
                      : client.mode === "demo"
                        ? "Browser engine"
                        : "API connected"}
                  </span>
                </div>
              </section>

              <section className="card activity-card">
                <div className="card-heading">
                  <div>
                    <h2>Run activity</h2>
                    <p>
                      {selected
                        ? `State transitions for ${selected.id.slice(0, 8)}`
                        : "A clear record of every state transition."}
                    </p>
                  </div>
                  <span className="count-label">{events.length} events</span>
                </div>
                <div className="activity-list">
                  {events.length ? (
                    events.slice(-8).map((event) => (
                      <div
                        className={`activity-event ${event.status}`}
                        key={event.id}
                      >
                        <span className="event-icon">
                          {event.status === "succeeded" ? (
                            <Check size={13} />
                          ) : event.status === "running" ? (
                            <Play size={11} />
                          ) : event.status === "cancelled" ||
                            event.status === "failed" ? (
                            <X size={12} />
                          ) : (
                            <Clock3 size={13} />
                          )}
                        </span>
                        <div>
                          <strong>{labels[event.status]}</strong>
                          <p>{event.message}</p>
                        </div>
                        <time dateTime={event.created_at}>
                          {clock(event.created_at)}
                        </time>
                      </div>
                    ))
                  ) : (
                    <p className="muted-empty">
                      Select a run to see its activity.
                    </p>
                  )}
                </div>
              </section>
            </div>
            <div className="right-column">
              <section
                className="card result-card"
                aria-labelledby="result-title"
              >
                <div className="card-heading">
                  <div>
                    <span className="tiny-label">RUN INSPECTOR</span>
                    <h2 id="result-title">
                      {selected ? "Monte Carlo π" : "Select an experiment"}
                    </h2>
                  </div>
                  {selected && <StatusPill status={selected.status} />}
                </div>
                {selected ? (
                  <>
                    <div className="run-id-line">
                      <span>{selected.id.slice(0, 8)}</span>
                      <button
                        aria-label="Copy experiment ID"
                        className="icon-button tiny"
                        onClick={() =>
                          void copy(selected.id, "Experiment ID copied.")
                        }
                      >
                        <Copy size={13} />
                      </button>
                      <span className="id-divider" />
                      <span>
                        Attempt {selected.attempts} of {selected.max_attempts}
                      </span>
                    </div>
                    <div className="estimate-block">
                      <span className="estimate-label">
                        {selected.result
                          ? "FINAL ESTIMATE"
                          : points.length
                            ? "CURRENT ESTIMATE"
                            : "EXPERIMENT PROGRESS"}
                      </span>
                      <div className="estimate-value">
                        {selected.result
                          ? selected.result.pi_estimate.toFixed(6)
                          : points.length
                            ? points[points.length - 1].estimate.toFixed(6)
                            : selected.status === "queued"
                              ? "In the queue"
                              : `${Math.round(selected.progress * 100)}%`}
                      </div>
                      <span className="reference-value">
                        π reference <strong>3.141593</strong>
                      </span>
                    </div>
                    {isActive(selected.status) && (
                      <div className="detail-progress">
                        <div>
                          <span>
                            {selected.status === "queued"
                              ? "Waiting for a worker"
                              : "Processing samples"}
                          </span>
                          <strong>
                            {Math.round(selected.progress * 100)}%
                          </strong>
                        </div>
                        <progress
                          value={selected.progress}
                          max="1"
                          aria-label="Experiment progress"
                        />
                      </div>
                    )}
                    {selected.error && (
                      <p className="result-error" role="alert">
                        {selected.error}
                      </p>
                    )}
                    <div className="result-numbers">
                      <div>
                        <span>Sample size</span>
                        <strong>{number(selected.parameters.samples)}</strong>
                      </div>
                      <div>
                        <span>Random seed</span>
                        <strong>{selected.parameters.seed}</strong>
                      </div>
                      <div>
                        <span>Absolute error</span>
                        <strong>
                          {selected.result
                            ? selected.result.absolute_error.toFixed(6)
                            : "—"}
                        </strong>
                      </div>
                      <div>
                        <span>Wall time</span>
                        <strong>
                          {selected.result
                            ? duration(selected.result.duration_seconds)
                            : "—"}
                        </strong>
                      </div>
                    </div>
                    <div className="chart-heading">
                      <span>
                        {client.mode === "demo"
                          ? "Estimate convergence"
                          : "Worker result"}
                      </span>
                      <button
                        className={`icon-button tiny ${codeView ? "pressed" : ""}`}
                        aria-label={
                          codeView ? "Show result chart" : "Show result JSON"
                        }
                        onClick={() => setCodeView(!codeView)}
                      >
                        <Code2 size={16} />
                      </button>
                    </div>
                    {codeView ? (
                      <pre className="result-json">
                        {JSON.stringify(
                          selected.result ?? {
                            status: selected.status,
                            progress: selected.progress,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    ) : points.length ? (
                      <ConvergenceChart points={points} />
                    ) : (
                      <div className="chart-placeholder">
                        <Activity size={23} />
                        <span>
                          {isActive(selected.status)
                            ? "The estimate will appear as the calculation runs."
                            : "No result was produced for this attempt."}
                        </span>
                      </div>
                    )}
                    <div className="result-actions">
                      {isActive(selected.status) ? (
                        <button
                          className="button danger"
                          disabled={busy}
                          onClick={() =>
                            void perform(
                              () => client.cancel(selected.id),
                              "Experiment cancelled.",
                            ).catch(() => {})
                          }
                        >
                          <Square size={14} />
                          Cancel experiment
                        </button>
                      ) : ["failed", "cancelled"].includes(selected.status) ? (
                        <button
                          className="button"
                          disabled={
                            busy || selected.attempts >= selected.max_attempts
                          }
                          onClick={() =>
                            void perform(
                              () => client.retry(selected.id),
                              "Experiment queued for retry.",
                            ).catch(() => {})
                          }
                        >
                          <RefreshCw size={15} />
                          {selected.attempts >= selected.max_attempts
                            ? "Attempt limit reached"
                            : "Retry experiment"}
                        </button>
                      ) : (
                        <button className="button" onClick={exportResult}>
                          <ArrowDownToLine size={16} />
                          Export result<span className="json-label">JSON</span>
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="empty-state inspector-empty">
                    <Activity size={28} />
                    <p>
                      Your result, convergence chart and run metadata will
                      appear here.
                    </p>
                  </div>
                )}
              </section>

              <section className="architecture-card">
                <div className="architecture-illustration">
                  <span>
                    <LayoutDashboard size={19} />
                  </span>
                  <i />
                  <span>
                    <Boxes size={19} />
                  </span>
                  <i />
                  <span>
                    <Activity size={19} />
                  </span>
                </div>
                <span className="tiny-label">HOW THE PROJECT WORKS</span>
                <h2>Explore the system</h2>
                <p>
                  Explore the API, durable SQL queue and worker lifecycle behind
                  this project.
                </p>
                <button
                  className="button text-button"
                  onClick={() => setModal("architecture")}
                >
                  Explore the architecture
                  <ArrowRight size={16} />
                </button>
              </section>
            </div>
          </div>
          <footer className="page-footer">
            <span>
              Built by{" "}
              <a
                href="https://github.com/JesU2504"
                target="_blank"
                rel="noreferrer"
              >
                Jesus Urbaneja
                <ArrowUpRight size={12} />
              </a>
            </span>
            <span>
              Demo and connected API modes
              <a href={`${REPO}/actions`} target="_blank" rel="noreferrer">
                CI & tests
                <ArrowUpRight size={12} />
              </a>
            </span>
          </footer>
        </main>
      </div>

      {modal === "run" && (
        <RunModal
          close={closeModal}
          busy={busy}
          onRun={async (parameters) => {
            await perform(
              () => client.submit(parameters),
              "Experiment submitted.",
            );
            setModal(null);
            setFilter("all");
            setSearch("");
          }}
        />
      )}
      {modal === "connect" && (
        <ConnectModal close={closeModal} onConnect={connect} />
      )}
      {modal === "architecture" && (
        <Modal
          title="A closer look at the system"
          subtitle="One interface. Two clearly defined execution modes."
          close={closeModal}
        >
          <div className="architecture-modal">
            <div className="architecture-mode">
              <strong>Public browser demo</strong>
              <p>
                A Web Worker performs the calculation in this tab. The queue,
                results and events are saved in session storage. No shared
                server or API key is involved.
              </p>
            </div>
            <div className="architecture-mode">
              <strong>Connected Python backend</strong>
              <p>
                The React dashboard calls FastAPI. SQL stores jobs and events; a
                separate Python worker claims work, renews its lease and commits
                results.
              </p>
            </div>
            <div className="architecture-features">
              <div>
                <CheckCircle2 size={17} />
                <span>Validated inputs and seeded calculations</span>
              </div>
              <div>
                <RefreshCw size={17} />
                <span>Cancellation, retries and attempt budgets</span>
              </div>
              <div>
                <Boxes size={17} />
                <span>Backend transactions and stale-worker protection</span>
              </div>
            </div>
            <p className="modal-note">
              The browser demo uses a different seeded random-number generator
              from Python. Each mode is reproducible within its own
              implementation. Demo wall time includes small pauses so progress
              is easy to follow.
            </p>
            <a
              className="button primary"
              href={REPO}
              target="_blank"
              rel="noreferrer"
            >
              <Code2 size={17} />
              Read the source and tests
              <ArrowUpRight size={16} />
            </a>
          </div>
        </Modal>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <CircleHelp size={17} /> : <CheckCircle2 size={17} />}
          <span>{toast.message}</span>
          <button
            className="icon-button tiny"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  icon,
  tone = "",
}: {
  label: string;
  value: string;
  note: string;
  icon: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className={`stat-card ${tone}`}>
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <strong className="stat-value">{value}</strong>
      <span className="stat-note">{note}</span>
    </div>
  );
}

function RunModal({
  close,
  onRun,
  busy,
}: {
  close: () => void;
  onRun: (parameters: Parameters) => Promise<void>;
  busy: boolean;
}) {
  const [samples, setSamples] = useState("250000");
  const [seed, setSeed] = useState("42");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const parameters = { samples: Number(samples), seed: Number(seed) };
    const message = validateParameters(parameters.samples, parameters.seed);
    if (message) {
      setError(message);
      return;
    }
    setError("");
    try {
      await onRun(parameters);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not create the experiment.",
      );
    }
  }
  return (
    <Modal
      title="New experiment"
      subtitle="A small calculation with a reproducible result."
      close={close}
    >
      <form onSubmit={(event) => void submit(event)}>
        <div className="workload-card">
          <span className="workload-icon">
            <FlaskConical size={24} />
          </span>
          <div>
            <strong>Monte Carlo π</strong>
            <p>Estimate pi by sampling points in a unit square.</p>
          </div>
          <span className="selected-check">
            <Check size={16} />
          </span>
        </div>
        <label className="field-label" htmlFor="samples">
          Number of samples
        </label>
        <input
          id="samples"
          type="number"
          min="1000"
          max="5000000"
          step="1"
          required
          className="form-input"
          value={samples}
          onChange={(event) => setSamples(event.target.value)}
        />
        <div className="sample-presets">
          {[100_000, 1_000_000, 5_000_000].map((value) => (
            <button
              type="button"
              key={value}
              className={Number(samples) === value ? "chosen" : ""}
              onClick={() => setSamples(String(value))}
            >
              {compact(value)} samples
            </button>
          ))}
        </div>
        <label className="field-label" htmlFor="seed">
          Random seed
        </label>
        <input
          id="seed"
          type="number"
          min="0"
          max="4294967295"
          step="1"
          required
          className="form-input"
          value={seed}
          onChange={(event) => setSeed(event.target.value)}
        />
        <p className="field-help">
          Use the same seed and sample size to repeat a result in the same mode.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Play size={15} />
            )}
            Run experiment
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ConnectModal({
  close,
  onConnect,
}: {
  close: () => void;
  onConnect: (url: string, key: string) => Promise<void>;
}) {
  const [base, setBase] = useState(window.location.origin);
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await onConnect(base, key);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Connection failed.");
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal
      title="Connect your Python API"
      subtitle="Use the same dashboard with the real worker and SQL database."
      close={close}
    >
      <form onSubmit={(event) => void submit(event)}>
        <label className="field-label" htmlFor="api-url">
          API base URL
        </label>
        <input
          id="api-url"
          type="url"
          required
          className="form-input"
          value={base}
          onChange={(event) => setBase(event.target.value)}
          placeholder="http://127.0.0.1:8000"
        />
        <label className="field-label" htmlFor="api-key">
          API key
        </label>
        <input
          id="api-key"
          type="password"
          required
          autoComplete="off"
          className="form-input"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="Your EJM_API_KEY"
        />
        <p className="field-help">
          Your key stays in memory for this connection. It is never saved in
          browser storage.
        </p>
        <div className="connection-note">
          <Link2 size={17} />
          <p>
            For a separate dashboard origin, add{" "}
            <code>{window.location.origin}</code> to the backend’s{" "}
            <code>EJM_CORS_ORIGINS</code>. An HTTPS page may require an HTTPS
            API.
          </p>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            Keep using demo
          </button>
          <button type="submit" className="button primary" disabled={pending}>
            {pending ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Link2 size={16} />
            )}
            Connect API
          </button>
        </div>
      </form>
    </Modal>
  );
}
