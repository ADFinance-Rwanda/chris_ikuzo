# Technical Assessment: Multi-Tenant Project & Task Management Platform

## Candidate name: Nkwaya Chris Ikuzo

## Senior Software Engineer Assessment

**Timebox:** 3-4 days\
**Submission:** GitHub repository\
**Primary Goal:** Evaluate software engineering ability across
architecture, security, backend design, database engineering,
reliability, testing, DevOps, and technical judgment.

------------------------------------------------------------------------

## 1. Assessment Overview

Build a **production-oriented, Dockerized, secure multi-tenant Project &
Task Management Platform**.

This assessment intentionally goes beyond basic CRUD. We are evaluating
how you design and implement a system that could realistically be
operated in production.

The solution should demonstrate:

-   Strong software architecture
-   Secure authentication and authorization
-   Strict multi-tenant data isolation
-   PostgreSQL database design
-   Redis usage and cache invalidation
-   Concurrency handling
-   Reliable background processing
-   API design
-   Automated testing
-   Docker and deployment practices
-   Observability and operational readiness
-   Backup and recovery thinking
-   Clear technical documentation
-   Good engineering judgment when using AI-assisted development

> **Important:** You do not need to implement every optional feature. We
> are more interested in the quality of the architecture, security,
> correctness, testing, and engineering decisions than in the number of
> screens or endpoints delivered.

------------------------------------------------------------------------

# 2. Business Scenario

A company operates multiple organizations using a shared Project & Task
Management platform.

Each organization can have multiple projects and users. Users can
create, assign, update, and monitor tasks.

The platform must support multiple organizations while ensuring that:

> **A user from Organization A must never be able to access or modify
> data belonging to Organization B.**

The platform will eventually support thousands of organizations and
potentially millions of tasks.

The application must therefore be designed with scalability, security,
reliability, and maintainability in mind.

------------------------------------------------------------------------

# 3. Required Technology Stack

The following components are mandatory:

### Frontend

Use one modern frontend framework:

-   React
-   Next.js
-   Vue
-   Angular

### Backend

Use one modern backend framework/runtime:

-   Node.js / TypeScript
-   Python
-   Java
-   Go
-   .NET

### Authentication

**Keycloak** is mandatory.

The application must authenticate users using Keycloak/OIDC/OAuth2.

### Database

**PostgreSQL** is mandatory.

### Cache / Supporting Infrastructure

**Redis** is mandatory.

### Containerization

**Docker + Docker Compose** are mandatory.

------------------------------------------------------------------------

# 4. Required Architecture

At minimum, the solution should contain:

``` text
                    ┌─────────────┐
                    │   Keycloak  │
                    └──────┬──────┘
                           │
                           ▼
┌─────────────┐      ┌─────────────┐
│  Frontend   │ ───► │ Backend API │
└─────────────┘      └──────┬──────┘
                            │
                 ┌──────────┴──────────┐
                 ▼                     ▼
          ┌─────────────┐       ┌─────────────┐
          │ PostgreSQL  │       │    Redis    │
          └─────────────┘       └─────────────┘
                                      │
                                      ▼
                               ┌─────────────┐
                               │   Worker    │
                               └─────────────┘
```

You may introduce additional services if justified.

Do not introduce unnecessary microservices simply to make the
architecture look complex.

We are interested in **appropriate architecture**, not maximum
architecture.

------------------------------------------------------------------------

# 5. Core Domain Model

The minimum business hierarchy should be:

``` text
Organization
    │
    ├── Users
    │
    └── Projects
          │
          └── Tasks
```

You may extend the model where useful.

## Organization

Suggested fields:

-   id
-   name
-   status
-   created_at
-   updated_at

## Project

Suggested fields:

-   id
-   organization_id
-   name
-   description
-   status
-   created_at
-   updated_at

## Task

Minimum fields:

-   id
-   organization_id
-   project_id
-   title
-   description
-   status
-   priority
-   owner_id / assignee_id
-   due_date
-   created_at
-   updated_at
-   version

Task status:

``` text
TODO
IN_PROGRESS
DONE
```

Priority:

``` text
LOW
MEDIUM
HIGH
CRITICAL
```

You may add additional fields where justified.

------------------------------------------------------------------------

# 6. Multi-Tenancy

Multi-tenancy is a **mandatory requirement**.

Every organization must operate as an isolated tenant.

The backend must determine the organization/tenant from the
authenticated user's identity and authorization context.

### Important Security Rule

Do **not** trust the frontend to provide a tenant ID as the source of
authorization.

For example, the following request must not allow a user to access
another organization simply by changing the value:

``` http
GET /api/tasks?organization_id=OTHER_ORGANIZATION
```

The server must enforce tenant isolation.

### Expected behavior

If a user belongs to:

``` text
Organization A
```

they must not be able to:

-   Read Organization B tasks
-   Modify Organization B tasks
-   Delete Organization B tasks
-   Read Organization B projects
-   Access Organization B analytics
-   Manipulate Organization B users

Cross-tenant access attempts should return an appropriate authorization
response such as:

``` http
403 Forbidden
```

or

``` http
404 Not Found
```

depending on the API's security design.

------------------------------------------------------------------------

# 7. Role-Based Access Control

RBAC is mandatory.

At minimum implement:

``` text
SUPER_ADMIN
ORG_ADMIN
PROJECT_MANAGER
MEMBER
```

You may refine the permission model.

Example:

| Action                        | SUPER_ADMIN | ORG_ADMIN | PROJECT_MANAGER | MEMBER  |
|-------------------------------|:-----------:|:---------:|:---------------:|:-------:|
| Manage organizations          | ✓           |           |                 |         |
| Manage organization users     | ✓           | ✓         |                 |         |
| Create projects               | ✓           | ✓         | ✓               |         |
| Manage project tasks          | ✓           | ✓         | ✓               |         |
| Create own tasks              | ✓           | ✓         | ✓               | ✓       |
| Update permitted tasks        | ✓           | ✓         | ✓               | ✓       |
| Delete permitted tasks        | ✓           | ✓         | ✓               |         |
| View organization analytics   | ✓           | ✓         | ✓               | Limited |


------------------------------------------------------------------------

# 8. Authentication

Keycloak must be used for authentication.

The application must:

-   Authenticate users through Keycloak
-   Validate access tokens on protected API endpoints
-   Identify the authenticated user
-   Enforce authorization based on roles
-   Prevent unauthorized access to API resources
-   Provide logout functionality
-   Provide a user/profile endpoint

Example:

``` http
GET /api/me
```

Expected response should contain information about the authenticated
user and relevant authorization context.

------------------------------------------------------------------------

# 9. Task Management

Implement secure CRUD functionality.

### Required APIs

``` http
GET    /api/tasks
POST   /api/tasks
GET    /api/tasks/:id
PUT    /api/tasks/:id
DELETE /api/tasks/:id
```

Support useful filtering such as:

``` text
status
priority
assignee
project
due date
search
```

Pagination should be implemented for collection endpoints.

Avoid returning unlimited records.

------------------------------------------------------------------------

# 10. Optimistic Concurrency Control

Task updates must support concurrent editing.

Add a version field:

``` text
version
```

Example:

``` text
Task version = 7
```

A client attempts to update version 7.

If another user has already changed the task and the current version is
now 8, the update must fail.

Example:

``` http
409 Conflict
```

The API should communicate that the resource has changed and the client
should reload the latest version.

The implementation may use:

-   Version column
-   Conditional SQL update
-   ETag / If-Match
-   Equivalent concurrency mechanism

Document your approach.

------------------------------------------------------------------------

# 11. Idempotent Task Creation

Task creation should support idempotency.

Example:

``` http
POST /api/tasks
Idempotency-Key: 4e7c...
```

If the same request is submitted multiple times with the same
idempotency key, the system should not create duplicate tasks.

Document:

-   Where the idempotency key is stored
-   How duplicate requests are detected
-   How long keys are retained
-   What happens if Redis is unavailable
-   How concurrent duplicate requests are handled

------------------------------------------------------------------------

# 12. Audit Logging

Important business actions must be auditable.

Create an audit log containing information such as:

-   id
-   organization_id
-   user_id
-   action
-   entity_type
-   entity_id
-   timestamp
-   IP address where appropriate
-   metadata / before-and-after information where appropriate

Examples:

``` text
TASK_CREATED
TASK_UPDATED
TASK_DELETED
PROJECT_CREATED
USER_ROLE_CHANGED
```

Audit logs should be treated as **append-only**.

A normal user must not be able to modify or delete audit records.

Document how audit logging is implemented.

------------------------------------------------------------------------

# 13. Redis Requirements

Redis must be used for at least:

1.  Dashboard/analytics caching
2.  Rate limiting

You may also use Redis for:

-   Session-related data
-   Idempotency keys
-   Background job coordination
-   Temporary locks
-   Profile caching

## Dashboard Cache

For example:

``` text
dashboard:{organization_id}:{user_id}
```

Use a reasonable TTL such as:

``` text
60 seconds
```

The application should invalidate or refresh relevant cache entries when
underlying task data changes.

## Redis Failure

Document what happens if Redis becomes unavailable.

The application should degrade gracefully where practical.

For example:

-   Task CRUD should continue if Redis is only being used for caching
-   Rate limiting behavior should be explicitly defined
-   Idempotency behavior should be safe and documented

------------------------------------------------------------------------

# 14. Rate Limiting

Implement API rate limiting.

At minimum protect sensitive endpoints such as:

``` text
POST /api/tasks
PUT /api/tasks/:id
DELETE /api/tasks/:id
```

You may implement rate limiting using:

-   Redis
-   Token bucket
-   Sliding window
-   Fixed window
-   Equivalent approach

Document:

-   Limit
-   Window
-   Key used for rate limiting
-   Behavior when the limit is exceeded

Example:

``` http
429 Too Many Requests
```

------------------------------------------------------------------------

# 15. Background Worker

Implement or demonstrate a background processing mechanism.

Suitable use cases include:

-   Notifications
-   Task reminders
-   Analytics aggregation
-   Audit processing
-   Email simulation
-   Report generation

Example:

``` text
API
 │
 └──► Queue
        │
        ▼
      Worker
        │
        └──► Notification / Processing
```

The worker should demonstrate:

-   Retry handling
-   Failure handling
-   Idempotency
-   Appropriate logging

You may use Redis-backed queues or another appropriate technology.

------------------------------------------------------------------------

# 16. PostgreSQL Requirements

PostgreSQL should be treated as a production database.

Requirements:

-   Database migrations
-   Foreign keys
-   Appropriate constraints
-   Appropriate indexes
-   Transactions where required
-   Avoid N+1 queries
-   Appropriate data types
-   Proper pagination
-   Referential integrity

At minimum, think about indexes for:

``` text
organization_id
project_id
assignee_id
status
due_date
created_at
```

Do not blindly index every column.

Explain important indexing decisions.

------------------------------------------------------------------------

# 17. Database Performance

Provide at least one example of database performance analysis.

For example:

``` sql
EXPLAIN ANALYZE
SELECT ...
```

Demonstrate how you identified and addressed a potentially expensive
query.

Document:

-   Query
-   Initial problem
-   Index or query improvement
-   Result

------------------------------------------------------------------------

# 18. Analytics Dashboard

Create a dashboard showing useful project/task information.

At minimum:

### Tasks by Status

``` text
TODO
IN_PROGRESS
DONE
```

### Tasks by Priority

``` text
LOW
MEDIUM
HIGH
CRITICAL
```

### Productivity

Show useful information such as:

-   Total tasks
-   Completed tasks
-   Pending tasks
-   Completion rate
-   Overdue tasks

### Time-Based View

Show task creation/completion trends over time.

The dashboard must respect organization and user authorization.

------------------------------------------------------------------------

# 19. Frontend

The frontend should provide at minimum:

### Authentication

-   Login
-   Logout
-   Current user information

### Organization/Project

-   Project list
-   Project details
-   Appropriate project creation/editing controls

### Tasks

-   Task list
-   Task creation
-   Task details
-   Task editing
-   Task deletion
-   Filtering
-   Pagination
-   Status/priority display

### Dashboard

-   Analytics
-   Charts or useful visualizations
-   Appropriate loading states
-   Error states
-   Empty states

The UI does not need to be visually complex.

Prioritize:

-   Usability
-   Correctness
-   Security
-   Clear information architecture

------------------------------------------------------------------------

# 20. API Security

The API must address common security concerns.

At minimum consider:

-   JWT validation
-   Token issuer validation
-   Token audience validation where applicable
-   Role/permission enforcement
-   Tenant isolation
-   Input validation
-   SQL injection protection
-   Secure error responses
-   CORS configuration
-   Rate limiting
-   Authorization on every protected resource
-   Avoiding sensitive information in logs
-   Secure handling of secrets

Never rely solely on frontend authorization.

------------------------------------------------------------------------

# 21. Validation and Error Handling

APIs should return consistent error responses.

Example:

``` json
{
  "error": "VALIDATION_ERROR",
  "message": "Invalid task data",
  "details": {
    "title": "Title is required"
  }
}
```

Handle common conditions such as:

``` text
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
422 Unprocessable Entity
429 Too Many Requests
500 Internal Server Error
```

The exact structure is part of your API design.

------------------------------------------------------------------------

# 22. Testing

Automated testing is **mandatory**.

At minimum provide tests for:

### Authentication / Authorization

-   Unauthenticated API request rejected
-   Authenticated user accepted
-   Unauthorized role rejected

### Multi-Tenancy

This is especially important.

Test that:

``` text
User A → Organization A → Task A
```

cannot access:

``` text
User A → Organization B → Task B
```

Test:

-   Read
-   Update
-   Delete

### Task CRUD

Test:

-   Create
-   Read
-   Update
-   Delete
-   Validation

### Concurrency

Test stale task version handling.

### Idempotency

Test duplicate requests with the same idempotency key.

### Redis

Test the relevant cache/rate-limit behavior.

Unit tests alone are not sufficient.

Include integration/API tests for important security boundaries.

------------------------------------------------------------------------

# 23. Health and Readiness

Implement operational endpoints such as:

``` http
GET /health
GET /ready
```

Example distinction:

### `/health`

Indicates whether the process is alive.

### `/ready`

Indicates whether the application is ready to serve requests,
potentially checking dependencies such as:

-   PostgreSQL
-   Redis
-   Required services

Document your design.

------------------------------------------------------------------------

# 24. Observability

Provide reasonable application observability.

At minimum:

-   Structured logs
-   Request ID / correlation ID
-   Useful error logs
-   Authentication/authorization failure logging
-   Worker logs
-   Database error logging
-   Redis error logging

Avoid logging:

-   Passwords
-   Access tokens
-   Client secrets
-   Sensitive personal information unnecessarily

------------------------------------------------------------------------

# 25. Docker Requirements

The application must run using Docker Compose.

Example:

``` bash
docker compose up --build
```

Required services should include:

``` text
frontend
backend
postgres
redis
keycloak
```

If a worker is implemented:

``` text
worker
```

should also be included.

Provide:

-   Health checks
-   Persistent PostgreSQL volume
-   Environment-based configuration
-   Docker networks where appropriate
-   Reasonable container configuration
-   No hard-coded production secrets

Where practical, services should run as non-root users.

------------------------------------------------------------------------

# 26. Environment Configuration

Provide:

``` text
.env.example
```

Do not commit real secrets.

Example:

``` env
DATABASE_URL=
REDIS_URL=
KEYCLOAK_URL=
KEYCLOAK_REALM=
KEYCLOAK_CLIENT_ID=
KEYCLOAK_CLIENT_SECRET=
```

The exact variables depend on your implementation.

------------------------------------------------------------------------

# 27. Database Backup and Restore

Provide scripts for PostgreSQL backup and restore.

Example:

``` bash
./scripts/backup.sh
./scripts/restore.sh
```

The backup may use:

``` bash
pg_dump
```

Demonstrate:

1.  Creating a backup
2.  Restoring the database
3.  Verifying restored data

Document:

-   Backup format
-   Backup location
-   Restore procedure
-   What happens if a backup fails
-   Basic RPO/RTO considerations

------------------------------------------------------------------------

# 28. Disaster Recovery Thinking

You are not required to build a full production disaster recovery
platform.

However, document how you would handle:

### PostgreSQL Failure

-   Database becomes unavailable
-   Data recovery
-   Backup restoration
-   Application behavior

### Redis Failure

-   Cache unavailable
-   Rate limiter unavailable
-   Idempotency storage unavailable

### Worker Failure

-   Jobs pending
-   Failed jobs
-   Retries
-   Duplicate processing

### Application Failure

-   Restart
-   Health checks
-   Container recovery

Include a short section describing your proposed production architecture
for these scenarios.

------------------------------------------------------------------------

# 29. Documentation

The repository must contain:

``` text
README.md
ARCHITECTURE.md
SECURITY.md
DATABASE.md
DISASTER_RECOVERY.md
AI_USAGE.md
```

At minimum:

### README.md

Include:

-   Project overview
-   Architecture
-   Technology stack
-   Prerequisites
-   Installation
-   Docker startup
-   Keycloak setup
-   Test users
-   Environment variables
-   API documentation
-   Testing
-   Backup/restore
-   Known limitations

### ARCHITECTURE.md

Explain:

-   Major components
-   Data flow
-   Authentication flow
-   Request flow
-   Redis usage
-   Worker architecture
-   Scaling considerations

### SECURITY.md

Explain:

-   Authentication
-   Authorization
-   Multi-tenancy
-   RBAC
-   Input validation
-   Rate limiting
-   Secret management
-   Audit logging
-   Security assumptions

### DATABASE.md

Explain:

-   Entity relationships
-   Important tables
-   Indexes
-   Constraints
-   Transactions
-   Performance considerations

### DISASTER_RECOVERY.md

Explain:

-   Backup
-   Restore
-   RPO
-   RTO
-   PostgreSQL failure
-   Redis failure
-   Worker failure
-   Application recovery

------------------------------------------------------------------------

# 30. AI Usage

AI-assisted development is allowed.

However, we want to evaluate your engineering judgment, not simply your
ability to generate code.

Create:

``` text
AI_USAGE.md
```

Include:

### Tools Used

For example:

``` text
ChatGPT
GitHub Copilot
Claude
Cursor
Other
```

### Where AI Was Used

Explain which parts were AI-assisted.

### At Least 3 Real Prompts

Include real prompts you used.

### AI Code You Rejected

Provide at least one example where:

1.  AI suggested an implementation
2.  You rejected or changed it
3.  Explain why

Examples could include:

-   Security issue
-   Incorrect tenant isolation
-   Bad database query
-   Race condition
-   Incorrect Redis behavior
-   Poor error handling

### Verification

Explain how you verified AI-generated code.

------------------------------------------------------------------------

# 31. Architecture Decision Records

Provide at least **three important engineering decisions**.

For example:

``` text
ADR-001: Multi-tenancy strategy
ADR-002: Redis caching strategy
ADR-003: Optimistic concurrency strategy
```

Each decision should explain:

-   Problem
-   Options considered
-   Decision
-   Why
-   Trade-offs

------------------------------------------------------------------------

# 32. API Documentation

Provide API documentation using one of:

-   OpenAPI / Swagger
-   Well-structured API documentation in Markdown

Document:

-   Authentication
-   Endpoints
-   Request bodies
-   Responses
-   Errors
-   Authorization requirements
-   Example requests

Swagger/OpenAPI is preferred.

------------------------------------------------------------------------

# 33. Expected Repository Structure

A suggested structure:

``` text
.
├── frontend/
├── backend/
├── worker/
├── database/
├── keycloak/
├── scripts/
│   ├── backup.sh
│   └── restore.sh
├── docs/
│   ├── ARCHITECTURE.md
│   ├── SECURITY.md
│   ├── DATABASE.md
│   ├── DISASTER_RECOVERY.md
│   └── ADR/
├── docker-compose.yml
├── .env.example
├── README.md
└── AI_USAGE.md
```

You may use a different structure if it is well justified.

------------------------------------------------------------------------

# 34. Minimum Acceptance Criteria

The submission should:

-   Start using Docker Compose
-   Authenticate through Keycloak
-   Provide protected APIs
-   Enforce RBAC
-   Enforce tenant isolation
-   Provide task CRUD
-   Provide project management
-   Implement PostgreSQL persistence
-   Use Redis
-   Implement rate limiting
-   Implement dashboard caching
-   Handle concurrent task updates
-   Provide audit logging
-   Provide automated tests
-   Provide health/readiness endpoints
-   Provide backup/restore scripts
-   Provide meaningful documentation

------------------------------------------------------------------------

# 35. Senior-Level Engineering Expectations

We are specifically evaluating the following behaviors.

## Architecture

Can you design a system that remains maintainable as usage grows?

## Security

Do you understand that authentication is not the same as authorization?

Can you enforce tenant isolation on the server?

## Database Engineering

Can you design proper relational models, constraints, indexes, and
transactions?

## Concurrency

Can you identify and handle race conditions?

## Reliability

What happens when Redis, PostgreSQL, a worker, or an external dependency
fails?

## Scalability

What changes when the system grows from:

``` text
1,000 users
```

to:

``` text
1,000,000 users
```

## Engineering Judgment

Can you avoid overengineering while still solving the real problem?

## Code Quality

Is the code:

-   Maintainable
-   Testable
-   Understandable
-   Consistent
-   Modular

------------------------------------------------------------------------

# 36. Submission Requirements

Submit the solution through a GitHub repository.

The repository should contain:

-   Source code
-   Docker configuration
-   Database migrations
-   Tests
-   Documentation
-   Backup/restore scripts
-   AI_USAGE.md
-   Architecture documentation
-   Environment example

Do not commit:

-   Passwords
-   API keys
-   Access tokens
-   Private keys
-   Production credentials
-   `.env` files containing secrets

------------------------------------------------------------------------

# 37. Walkthrough

Provide a short walkthrough demonstrating:

1.  Keycloak login
2.  User roles
3.  Organization/project structure
4.  Task CRUD
5.  Tenant isolation
6.  Dashboard
7.  Redis usage
8.  Rate limiting
9.  Concurrent update handling
10. Audit logging
11. Background worker
12. Automated tests
13. PostgreSQL backup
14. PostgreSQL restore
15. Docker deployment

The walkthrough should focus on important engineering decisions rather
than simply showing UI screens.

------------------------------------------------------------------------

# 38. Evaluation Rubric

Total: **100 points**

  Area                                   Points
  ----------------------------------- ---------
  Architecture & Design                      15
  Security & Multi-Tenant Isolation          20
  Backend/API Engineering                    15
  PostgreSQL & Database Engineering          10
  Redis, Caching & Concurrency               10
  Frontend                                    5
  Automated Testing                          10
  Docker / DevOps                             5
  Observability & Reliability                 5
  Documentation                               3
  AI Engineering Judgment                     2
  **Total**                             **100**

------------------------------------------------------------------------

# 39. Bonus Points

Up to **20 bonus points** may be awarded.

### +5 CI/CD

GitHub Actions or equivalent pipeline including:

-   Build
-   Test
-   Lint
-   Docker build

### +5 Advanced Worker / Reliability

Production-quality:

-   Queue
-   Retry
-   Dead-letter handling
-   Idempotency
-   Failure recovery

### +3 Advanced Testing

Strong integration/e2e test coverage and meaningful test scenarios.

### +2 OpenAPI / Swagger

Complete API documentation.

### +2 Monitoring

Prometheus/Grafana or equivalent monitoring approach.

### +2 Database Performance

Meaningful query optimization backed by measurement.

### +1 Architecture Diagram

Clear architecture and data-flow diagrams.

------------------------------------------------------------------------

# 40. What We Will Look For

A strong senior-level submission will typically demonstrate:

-   Simple but well-thought-out architecture
-   Strong tenant isolation
-   Proper authorization
-   Good PostgreSQL modeling
-   Correct transaction boundaries
-   Thoughtful indexes
-   Correct concurrency handling
-   Safe Redis usage
-   Graceful failure behavior
-   Meaningful automated tests
-   Good Docker practices
-   Clear documentation
-   Good logging and observability
-   Awareness of production trade-offs

A visually impressive application with weak security or poor
architecture will **not** receive a strong score.

------------------------------------------------------------------------

# 41. Important Evaluation Principle

This assessment is not about completing the largest number of features.

We value:

> **Correctness \> Security \> Architecture \> Reliability \>
> Maintainability \> Feature Count**

If you cannot implement something completely within the timebox,
document:

-   What you implemented
-   What remains
-   How you would complete it
-   Why you prioritized other areas

Clear engineering decisions are part of the assessment.

------------------------------------------------------------------------

# 42. Final Senior Engineering Discussion

After submission, the candidate may be asked to participate in a
**45--60 minute technical discussion**.

Potential discussion topics include:

### Multi-Tenancy

> How would you guarantee that a tenant ID supplied by a malicious
> client cannot bypass authorization?

### Database

> What indexes would you add for a system containing 100 million tasks,
> and why?

### Redis

> What happens if Redis becomes unavailable?

### Concurrency

> Two users edit the same task at exactly the same time. What happens?

### Scaling

> How would you scale the application to 1 million users?

### PostgreSQL Failure

> What happens if PostgreSQL becomes unavailable for 10 minutes?

### Worker

> How do you prevent a notification job from being processed twice?

### Security

> What are the biggest security risks in your implementation?

### AI

> Show us one piece of AI-generated code that you changed or rejected
> and explain why.

### Architecture

> If you had two additional weeks, what would you improve and why?

------------------------------------------------------------------------

# 43. Final Note to Candidate

Build the system as if another engineering team will maintain it after
you leave.

We are not expecting a perfect production system within 2--3 days.

We are looking for evidence that you can:

-   Think beyond CRUD
-   Design secure systems
-   Make sound technical decisions
-   Understand failure modes
-   Write maintainable code
-   Test critical behavior
-   Explain trade-offs
-   Build with production awareness

**Good luck!**