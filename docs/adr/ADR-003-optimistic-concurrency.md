# ADR-003: Optimistic task concurrency

- Status: Accepted
- Decision: Require an integer task version in update requests and increment it in a conditional PostgreSQL update; stale updates return 409.
- Context: Concurrent edits must not silently overwrite a newer state.
- Alternatives: Pessimistic row locking (unnecessary contention for human-paced edits), ETags (equivalent but less explicit for the current JSON API).
- Trade-offs: Clients must retain and send the version received with a task; after conflict, reload and reconcile changes.
