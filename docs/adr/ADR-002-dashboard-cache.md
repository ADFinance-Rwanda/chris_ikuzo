# ADR-002: Dashboard cache

- Status: Accepted
- Decision: Cache analytics in Redis for 60 seconds, scoped to an organization for elevated roles and additionally by user for member views. Invalidate after task/project changes.
- Context: Dashboard aggregation should not repeatedly scan task data on every page view.
- Alternatives: No cache (simpler and always fresh), or materialized aggregates (additional write/refresh path).
- Trade-offs: Redis failure causes logged PostgreSQL recomputation; failed invalidation can be stale for up to 60 seconds. Cache invalidation uses a bounded key pattern scan suitable for this reference scale; high-cardinality production needs versioned keys or a registry.
