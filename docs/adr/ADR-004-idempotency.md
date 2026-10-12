# ADR-004: Database-backed idempotency

- Status: Accepted
- Decision: Enforce tenant-scoped idempotency in PostgreSQL using a unique key plus a digest of the request payload.
- Context: A Redis-only key can disappear or race under concurrent retries.
- Alternatives: Redis distributed lock (extra failure modes), no idempotency (duplicate task creation).
- Trade-offs: The key is retained with the task for its lifetime. Replaying a key with different content returns 409. This avoids Redis dependency for correctness.
