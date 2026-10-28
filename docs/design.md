# Design decisions

## Separate the API from execution

The API validates and persists a request before acknowledging it. A separate
worker process performs CPU work. API restarts therefore do not discard queued
requests, and a slow experiment does not occupy an HTTP request handler.
FastAPI's in-process background tasks are useful for small response-adjacent
work; this project needs persistent state and recovery across worker processes.

## Use SQL as the first queue

A single database stores jobs and their state-transition events. This keeps the
first milestone inspectable without a separate broker. PostgreSQL is the
multi-process deployment target; SQLite makes the local walkthrough simple.
Polling and optimistic claims have throughput limits. A larger deployment could
use `SKIP LOCKED`, a notification channel or a broker, supported by measurements.

Workers select a candidate, then conditionally update it only if it is still
queued. One matching update wins. The claim and its `running` event commit in the
same transaction. A competing worker whose update affects zero rows tries again.
The implementation does not promise strict FIFO ordering under contention.

## Distinguish submission idempotency from execution

A unique idempotency key and a hash of the canonical validated request prevent
duplicate submissions. Concurrent inserts are resolved by the database unique
constraint. The losing request loads the existing row and compares the hash.
Keys persist with the job; there is no expiry policy in the first milestone.

This does not make execution exactly once. A process can crash after computing
a result but before committing it. The workload may then be executed again.
The supplied workload is deterministic for its input seed and has no external
side effects. A future workload that writes to another system needs its own
idempotency strategy.

## Fence stale workers

Every claim creates a new random lease token. Progress renewals and completion
writes require the matching token, `running` status, and an unexpired lease.
Cancellation clears the token. Recovery requeues an expired job or marks it
failed when its attempt budget is exhausted. A late worker cannot overwrite
a cancellation, retry or replacement worker's result.

The bounded experiment checks ownership every 10,000 samples. A lost lease raises
a cooperative stop signal. The default lease is 30 seconds, far longer than a
normal batch. Independent worker hosts would need sufficiently synchronised
clocks, or a database-side time source, before distributed deployment.

## Keep the first authentication model explicit

One configured API key protects job routes. This represents one operator, not
multiple users with separate data ownership. Keys are compared in constant time
and are not persisted in job records. A public multi-user deployment would need
accounts, authorisation, quotas and an appropriate transport/deployment setup.

## Verification

Tests exercise actual SQL transactions and the HTTP boundary. They include
competing claims, simultaneous idempotent submissions, cancellation during work,
stale-token rejection, lease expiry at its exact boundary, exhausted attempts,
manual retries, schema migrations and a worker launched as a separate process.
The CI pipeline repeats the suite on PostgreSQL and runs the container stack
through a real HTTP submit/retrieve cycle.
