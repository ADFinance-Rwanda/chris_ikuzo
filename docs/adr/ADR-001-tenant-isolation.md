# ADR-001: Tenant isolation

- Status: Accepted
- Decision: Derive one organization scope from a signed Keycloak `org_id` claim, include it in every repository query, and add composite `(organization_id, id)` foreign keys for tenant-owned references.
- Context: Client-selected tenant IDs can be changed by an attacker. Query scoping alone also leaves integrity gaps when project/user references are created.
- Alternatives: Database-per-tenant (higher operational cost), schema-per-tenant (migration and pooling complexity), or relying only on route checks (weak database integrity).
- Trade-offs: Single-tenant membership per token is simple and auditable; users belonging to several organizations need a trusted tenant-switching claim/flow before production expansion.
