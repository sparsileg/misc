# Offline-Capable Web + Tauri Application Architecture

**Status:** Proposed  
**Date:** 2026-08-26  
**Primary technologies:** Cloudflare Workers, Cloudflare D1, SQLite, Tauri, Rust, browser JavaScript/TypeScript

---

## 1. Executive Summary

This design uses **Cloudflare D1 as the authoritative cloud database** and **SQLite as the local database for Tauri installations**.

The application has two client types:

1. **Web client**
   
   - Runs in a browser.
   - Uses HTTPS to communicate with a Cloudflare Worker API.
   - Reads and writes data in D1 through the Worker.
   - Does not directly connect to D1.

2. **Tauri client**
   
   - Runs as a native desktop application.
   - Uses a local SQLite database for normal operation.
   - Works fully offline.
   - Uses the same HTTPS API as the web client when online.
   - Synchronizes local changes to D1 and downloads changes made elsewhere.

The important architectural principle is:

> **The Worker API is the only public interface to D1. D1 is the authoritative server database, while each Tauri installation maintains a local SQLite replica.**

This avoids exposing database credentials or arbitrary SQL access to clients and gives the application one stable API for browsers, Tauri applications, and future third-party clients.

Cloudflare documents this Worker-proxy pattern specifically for exposing D1 safely outside a Worker/Pages application. citeturn0search2turn0search5

---

# 2. High-Level Architecture

```text
                         Internet
                            │
                ┌───────────┴───────────┐
                │                       │
        Web Browser               Tauri Application
                │                       │
                │ HTTPS                 │ HTTPS
                ▼                       ▼
        ┌────────────────────────────────────┐
        │       Cloudflare Worker API        │
        │                                    │
        │  Authentication                    │
        │  Authorization                     │
        │  Validation                        │
        │  Business Logic                    │
        │  Sync API                          │
        │  Rate Limiting                     │
        └──────────────────┬─────────────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │   Cloudflare D1 │
                  │                 │
                  │ Authoritative   │
                  │ application DB  │
                  └─────────────────┘


        Tauri installation
        ──────────────────

        ┌──────────────────────────────────┐
        │ Local SQLite                     │
        │                                  │
        │ Application tables               │
        │ Sync metadata                    │
        │ Pending mutations                │
        │ Tombstones                       │
        └────────────────┬─────────────────┘
                         │
                    Sync Engine
                         │
                         ▼
                    Worker API
```

Cloudflare D1 provides SQLite-compatible SQL semantics and is designed to be queried from Workers/Pages applications. citeturn0search4turn0search6

---

# 3. Design Goals

## 3.1 Functional goals

- Web application works from any browser.
- Tauri application works without Internet access.
- Multiple Tauri installations can be used simultaneously.
- Multiple browser sessions can be used simultaneously.
- Changes made on one device eventually appear on other devices.
- The same API is used by web and Tauri clients.
- Third-party clients can optionally use the API.
- Local SQLite provides fast access and offline capability.
- Synchronization resumes automatically after reconnecting.
- Server-side data remains authoritative.
- Conflicting edits are detected rather than silently overwriting data.
- Deletes synchronize correctly.
- Schema changes can be migrated consistently.

## 3.2 Non-goals

This design does not attempt to provide:

- Direct public access to D1.
- Arbitrary SQL access by application clients.
- Multi-master database replication at the SQLite level.
- Real-time synchronization with zero latency.
- Automatic conflict resolution for every possible data type.

The synchronization system is an **application-level replication system**, not SQLite replication.

---

# 4. Why D1 Is the Cloud Database

D1 is a good fit because:

- It uses SQLite SQL semantics.
- It integrates directly with Cloudflare Workers.
- It is available from Cloudflare's infrastructure.
- The application is already hosted on Cloudflare.
- Database migrations can be versioned as SQL files.
- D1 supports prepared statements and batched operations.
- D1 supports local development through Wrangler.
- D1 supports backups/time-travel facilities.

Cloudflare's Worker Binding API provides prepared statements and batch operations. Batch operations can execute multiple statements as a transactional unit, which is useful for applying synchronization batches. citeturn0search1

D1 migrations are versioned SQL files and can be applied locally or remotely through Wrangler. citeturn0search0turn0search10

---

# 5. Public API Architecture

The application should **not expose D1's administrative REST API to application users**.

Instead:

```text
Client
  │
  │ HTTPS
  ▼
https://api.example.com/
  │
  ▼
Cloudflare Worker
  │
  │ D1 Worker Binding
  ▼
D1
```

Cloudflare's documentation explicitly recommends a Worker-based API when an application needs to access D1 externally, allowing the application to control which operations and tables are exposed. citeturn0search2

The Worker should expose **domain-oriented endpoints**, not SQL endpoints.

Good:

```text
GET    /api/v1/items
GET    /api/v1/items/{id}
POST   /api/v1/items
PATCH  /api/v1/items/{id}
DELETE /api/v1/items/{id}

GET    /api/v1/sync
POST   /api/v1/sync
```

Avoid:

```text
POST /api/query
POST /api/execute-sql
```

The latter effectively turns the Worker into a remote SQL server and creates unnecessary security and authorization problems.

---

# 6. API Versioning

All public endpoints should be versioned:

```text
/api/v1/...
```

For example:

```text
https://api.example.com/api/v1/items
```

A future incompatible API can then be introduced as:

```text
/api/v2/...
```

Existing desktop clients can continue using v1 while newer versions migrate to v2.

This is particularly important because Tauri installations may not all be upgraded simultaneously.

---

# 7. Authentication

The API should authenticate users independently of D1.

A typical flow is:

```text
Client
  │
  │ login
  ▼
Authentication service
  │
  ▼
access token
  │
  ▼
Client
  │
  │ Authorization: Bearer <token>
  ▼
Worker
```

The Worker validates the token and determines:

- user ID
- account/tenant ID
- permissions
- token expiration
- client/device identity where applicable

The application should never put a D1 credential in a browser or Tauri executable.

A desktop executable is not a trusted secret container; anything embedded in it can potentially be extracted.

---

# 8. User/Account Isolation

Every application row that belongs to a user or account should contain an ownership identifier, for example:

```sql
account_id TEXT NOT NULL
```

The Worker determines the authenticated account from the authentication token.

Clients should **not be allowed to choose an arbitrary account_id** and access it.

Instead:

```text
Authorization token
       │
       ▼
Worker determines account_id
       │
       ▼
SQL always scopes by account_id
```

For example:

```sql
SELECT *
FROM items
WHERE account_id = ?
  AND id = ?
```

This should be enforced in server-side business logic rather than relying on clients to behave correctly.

---

# 9. Database Schema Design

The database should use UUID/ULID-style application-generated IDs rather than relying exclusively on SQLite/D1 auto-increment IDs.

Example:

```sql
CREATE TABLE items (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at INTEGER
);

CREATE INDEX idx_items_account_updated
ON items(account_id, updated_at);

CREATE INDEX idx_items_account_id
ON items(account_id, id);
```

Recommended properties:

- `id` is globally unique.
- `account_id` identifies the owner.
- `created_at` records creation time.
- `updated_at` records the last server-side modification.
- `version` is a server-controlled revision number.
- `deleted_at` represents a tombstone when appropriate.

Avoid using client wall-clock time as the authoritative ordering mechanism.

---

# 10. Why IDs Should Be Client-Generated

Suppose a Tauri application creates an item while offline.

It must be possible to create:

```text
item_id = "01K..."
```

without contacting the server.

Therefore the client should generate the ID.

UUIDv4 or ULID are suitable choices.

A ULID is particularly attractive if sortable identifiers are useful:

```text
01K3...
```

The same ID is then used when the item eventually reaches D1.

This eliminates the need for:

```text
temporary local ID
        ↓
server assigns ID
        ↓
rewrite local references
```

and greatly simplifies synchronization.

---

# 11. Local SQLite Database

Each Tauri installation has its own SQLite database:

```text
Application
    │
    ├── application tables
    │
    ├── sync_state
    │
    └── pending_mutations
```

Example:

```sql
CREATE TABLE sync_state (
    account_id TEXT PRIMARY KEY,
    server_cursor TEXT,
    last_sync_at INTEGER,
    schema_version INTEGER NOT NULL
);
```

The local database should also contain a mutation queue:

```sql
CREATE TABLE pending_mutations (
    mutation_id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
);
```

The mutation queue is essential because a local write must be preserved even when there is no Internet connection.

---

# 12. Local Write Model

When the user edits data in Tauri:

```text
User changes item
       │
       ▼
SQLite transaction
       │
       ├── update application table
       │
       └── add pending_mutation
       │
       ▼
Commit
```

The two operations must occur in **one SQLite transaction**.

Example conceptually:

```sql
BEGIN;

UPDATE items
SET name = ?,
    updated_at = ?,
    version = version + 1
WHERE id = ?;

INSERT INTO pending_mutations (
    mutation_id,
    entity_type,
    entity_id,
    operation,
    payload,
    created_at
)
VALUES (?, ?, ?, ?, ?, ?);

COMMIT;
```

This guarantees that an application change cannot be committed locally without also being placed into the synchronization queue.

---

# 13. Synchronization Model

Synchronization should be **bidirectional**:

```text
                ┌─────────────┐
                │    D1       │
                │ authoritative│
                └──────┬──────┘
                       ▲
                 upload│download
                       │
                ┌──────┴──────┐
                │ Sync Engine │
                └──────┬──────┘
                       │
                ┌──────┴──────┐
                │   SQLite    │
                └─────────────┘
```

The sync engine performs two operations:

1. **Push local changes to the server.**
2. **Pull remote changes from the server.**

A synchronization cycle should normally do:

```text
1. Push pending mutations
2. Receive server acknowledgements
3. Pull changes since last cursor
4. Apply remote changes
5. Advance cursor
6. Repeat if necessary
```

---

# 14. Server Change Log

The most important addition to D1 for synchronization is a server-side change log.

Example:

```sql
CREATE TABLE change_log (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    mutation_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    entity_version INTEGER NOT NULL,
    changed_at INTEGER NOT NULL
);

CREATE INDEX idx_change_log_account_sequence
ON change_log(account_id, sequence);
```

Every successful server-side mutation creates a change-log record.

Example:

```text
sequence  entity     operation
--------  ---------  ---------
1001      item A     UPDATE
1002      item B     CREATE
1003      item A     DELETE
1004      item C     UPDATE
```

The sequence becomes the synchronization cursor.

---

# 15. Why a Change Log Is Better Than `updated_at`

A naive synchronization implementation might ask:

```sql
SELECT *
FROM items
WHERE updated_at > ?
```

This is problematic because timestamps are not a reliable synchronization cursor:

- timestamp precision can be insufficient
- clocks can differ
- multiple operations can have identical timestamps
- deletes disappear unless tombstones are retained
- pagination becomes difficult
- ordering can become ambiguous

A monotonically increasing server-side change sequence solves these problems.

The client stores:

```text
last_server_sequence = 1004
```

and requests:

```text
GET /api/v1/sync/changes?after=1004
```

The server can then return:

```text
1005 ...
1006 ...
1007 ...
```

---

# 16. Sync Push API

The Tauri client sends pending mutations in a batch.

Example:

```http
POST /api/v1/sync/push
Authorization: Bearer <token>
Content-Type: application/json
```

Request:

```json
{
  "mutations": [
    {
      "mutation_id": "01K...",
      "entity_type": "item",
      "entity_id": "01K...",
      "operation": "create",
      "base_version": 0,
      "data": {
        "name": "Example",
        "description": "..."
      }
    },
    {
      "mutation_id": "01K...",
      "entity_type": "item",
      "entity_id": "01K...",
      "operation": "update",
      "base_version": 4,
      "data": {
        "name": "Updated name"
      }
    }
  ]
}
```

The server processes the batch and returns a result for every mutation.

Example:

```json
{
  "results": [
    {
      "mutation_id": "01K...",
      "status": "accepted",
      "entity_version": 1,
      "sequence": 1005
    },
    {
      "mutation_id": "01K...",
      "status": "conflict",
      "entity_version": 7,
      "sequence": 1004
    }
  ]
}
```

---

# 17. Idempotency

Every mutation must have a unique `mutation_id`.

This is important because networks fail.

For example:

```text
Client
  │
  │ POST mutation
  ▼
Worker
  │
  │ mutation committed
  ▼
D1
  │
  X response lost
  │
Client thinks request failed
```

The client retries.

Without idempotency, the mutation could be applied twice.

With a unique mutation ID, the server recognizes:

```text
mutation_id already processed
```

and returns the original result.

A table can track processed mutations:

```sql
CREATE TABLE processed_mutations (
    mutation_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    processed_at INTEGER NOT NULL,
    result TEXT NOT NULL
);
```

The mutation ID should be unique at least within an account.

---

# 18. Optimistic Concurrency

Conflicts should be detected using a server-side entity version.

Suppose:

```text
Server:
item A version = 5
```

Tauri #1 downloads version 5.

Tauri #2 downloads version 5.

Then:

```text
Tauri #1 changes item A
       ↓
Server version 6
```

Tauri #2 later tries:

```text
update item A
base_version = 5
```

The server sees:

```text
current_version = 6
base_version    = 5
```

and reports a conflict.

This is much safer than silently allowing Tauri #2 to overwrite Tauri #1.

---

# 19. Conflict Response

A conflict response should contain enough information for the client to resolve it.

Example:

```json
{
  "mutation_id": "01K...",
  "status": "conflict",
  "entity_id": "01K...",
  "base_version": 5,
  "server_version": 6,
  "server_entity": {
    "id": "01K...",
    "name": "Server value",
    "description": "..."
  },
  "client_entity": {
    "id": "01K...",
    "name": "Local value",
    "description": "..."
  }
}
```

The application can then:

- automatically merge
- keep the server value
- keep the local value
- ask the user
- apply field-level conflict resolution

The correct strategy depends on the entity.

---

# 20. Recommended Conflict Strategy

Use different strategies depending on the data.

### Simple fields

For ordinary scalar fields:

```text
server version check
       ↓
conflict
       ↓
last-write-wins OR user resolution
```

### Structured data

For collections or lists, prefer operation-based changes rather than replacing the entire list.

### Important records

Require explicit user resolution.

The synchronization framework should report:

```text
CONFLICT
```

rather than silently destroying data.

---

# 21. Deletes

Deletes require special treatment.

If a client deletes:

```text
item A
```

and the row is physically removed from D1, another client cannot discover that it was deleted.

Therefore synchronization should use tombstones.

Instead of:

```sql
DELETE FROM items WHERE id = ?;
```

the server can do:

```sql
UPDATE items
SET deleted_at = ?,
    updated_at = ?,
    version = version + 1
WHERE id = ?;
```

The change log records:

```text
entity = item A
operation = delete
```

Clients receive the deletion and remove or mark the corresponding local row.

Tombstones must be retained long enough that all supported clients can synchronize.

A later garbage-collection mechanism can remove old tombstones after an appropriate retention period.

---

# 22. Pull API

The Tauri client asks for changes after its current cursor.

Example:

```http
GET /api/v1/sync/changes?after=1004&limit=500
Authorization: Bearer <token>
```

Response:

```json
{
  "changes": [
    {
      "sequence": 1005,
      "entity_type": "item",
      "entity_id": "01K...",
      "operation": "update",
      "version": 6,
      "data": {
        "id": "01K...",
        "name": "Example",
        "description": "..."
      }
    }
  ],
  "next_cursor": "1005",
  "has_more": false
}
```

The client stores `next_cursor` only after successfully applying the returned changes.

---

# 23. Atomic Cursor Advancement

A critical rule:

> **Never advance the synchronization cursor until the downloaded changes have been successfully committed to SQLite.**

For example:

```text
Download changes 1005-1010
        │
        ▼
SQLite transaction
        │
        ├── apply 1005
        ├── apply 1006
        ├── ...
        ├── apply 1010
        │
        └── update sync_state = 1010
        │
        ▼
COMMIT
```

If SQLite fails:

```text
ROLLBACK
```

The cursor remains at:

```text
1004
```

and the client can safely retry.

---

# 24. Recommended Complete Sync Cycle

```text
                    START SYNC
                        │
                        ▼
              ┌─────────────────┐
              │ Is authenticated│
              │ and online?     │
              └────────┬────────┘
                       │ yes
                       ▼
              ┌─────────────────┐
              │ Push mutations  │
              └────────┬────────┘
                       ▼
              ┌─────────────────┐
              │ Process server  │
              │ acknowledgements│
              └────────┬────────┘
                       ▼
              ┌─────────────────┐
              │ Pull changes    │
              │ after cursor    │
              └────────┬────────┘
                       ▼
              ┌─────────────────┐
              │ Apply changes   │
              │ transactionally │
              └────────┬────────┘
                       ▼
              ┌─────────────────┐
              │ Advance cursor  │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │ More changes?   │
              └──────┬─────┬────┘
                     │ no  │ yes
                     │     │
                     ▼     └───────────┐
                   DONE                │
                                       ▼
                                Pull next page
```

---

# 25. Handling Push/Pull Ordering

A useful rule is:

> **Push local changes before pulling remote changes.**

This makes the client's local changes known to the server before it processes the next remote state.

However, the implementation should not assume that push eliminates conflicts.

The server remains authoritative.

A push can result in:

```text
accepted
conflict
rejected
unauthorized
validation_error
already_processed
```

The sync engine handles each result independently.

---

# 26. Sync API Alternative: Combined Endpoint

Once the basic implementation is stable, the API can optionally provide a combined endpoint:

```http
POST /api/v1/sync
```

Request:

```json
{
  "cursor": "1004",
  "mutations": [
    ...
  ],
  "limit": 500
}
```

Response:

```json
{
  "mutation_results": [
    ...
  ],
  "changes": [
    ...
  ],
  "next_cursor": "1010",
  "has_more": false
}
```

This reduces HTTP round trips and is probably the preferred production API.

Internally, the Worker should still conceptually treat the operation as:

```text
push
pull
```

rather than treating the database as a generic replicated SQLite database.

---

# 27. Batch Operations

D1 supports batching multiple prepared statements in a single database call. This is useful when applying a synchronization batch. citeturn0search1

For example, a server-side mutation may require:

```text
BEGIN
    update entity
    insert change_log
    insert processed_mutation
COMMIT
```

These operations should succeed or fail together.

The Worker should use prepared statements rather than constructing SQL from client-provided strings.

Cloudflare's D1 API supports prepared statements and parameter binding. citeturn0search5

---

# 28. API Endpoint Summary

Recommended initial API:

| Method   | Endpoint             | Purpose                  |
| -------- | -------------------- | ------------------------ |
| `GET`    | `/api/v1/items`      | List items               |
| `GET`    | `/api/v1/items/{id}` | Retrieve item            |
| `POST`   | `/api/v1/items`      | Create item              |
| `PATCH`  | `/api/v1/items/{id}` | Update item              |
| `DELETE` | `/api/v1/items/{id}` | Delete item              |
| `POST`   | `/api/v1/sync`       | Synchronize Tauri client |
| `GET`    | `/api/v1/me`         | Current user/account     |
| `GET`    | `/api/v1/status`     | API/service status       |

The normal CRUD endpoints are useful for the web application and third-party clients.

The `/sync` endpoint is optimized for Tauri synchronization and should not necessarily expose the same semantics as ordinary CRUD.

---

# 29. Example Normal API Usage

Create an item:

```http
POST /api/v1/items
Authorization: Bearer <token>
Content-Type: application/json

{
  "id": "01K...",
  "name": "Example item",
  "description": "Example"
}
```

The Worker:

1. authenticates the user
2. validates the request
3. determines the account ID
4. validates the supplied ID
5. inserts the row into D1
6. creates a change-log entry
7. returns the resulting entity/version

Response:

```json
{
  "id": "01K...",
  "version": 1,
  "data": {
    "name": "Example item",
    "description": "Example"
  }
}
```

---

# 30. Web Application Behavior

The web application does not need its own synchronization system.

Its normal architecture is:

```text
Browser
   │
   ├── GET /api/v1/items
   ├── POST /api/v1/items
   ├── PATCH /api/v1/items/{id}
   └── DELETE /api/v1/items/{id}
          │
          ▼
       Worker
          │
          ▼
         D1
```

The web application may optionally cache data in browser storage for performance, but that is independent of the authoritative D1 synchronization system.

---

# 31. Tauri Application Behavior

The Tauri application should treat local SQLite as its normal data source.

```text
UI
 │
 ▼
Tauri application layer
 │
 ▼
SQLite
```

When online, a background sync service operates independently:

```text
SQLite
  │
  ▼
Sync engine
  │
  ▼
HTTPS API
  │
  ▼
Worker
  │
  ▼
D1
```

The user should not need to explicitly press "Sync" in normal operation.

The sync engine can run:

- at application startup
- when network connectivity returns
- periodically
- after a local mutation
- when the application becomes idle
- when the user explicitly requests synchronization

---

# 32. Offline Behavior

When offline:

```text
User edits data
       │
       ▼
SQLite transaction
       │
       ├── application change
       └── pending mutation
```

The application behaves normally.

The UI can optionally show:

```text
Offline
12 changes waiting to sync
```

When connectivity returns:

```text
network available
       │
       ▼
sync engine wakes
       │
       ▼
push pending changes
       │
       ▼
pull remote changes
       │
       ▼
SQLite updated
```

---

# 33. Multiple Tauri Installations

Suppose the user has:

```text
Desktop A
Laptop B
Desktop C
Browser D
```

All use the same account.

A change made on Desktop A:

```text
Desktop A SQLite
      │
      ▼
     D1
      │
      ├──> Desktop B
      ├──> Desktop C
      └──> Browser D
```

Each Tauri installation maintains its own cursor.

Example:

```text
Desktop A: cursor 1200
Desktop B: cursor 1187
Desktop C: cursor 1199
```

They do not need to be synchronized with each other directly.

They all synchronize through D1.

This is an important simplification:

> **There is no peer-to-peer synchronization. D1 is the synchronization hub.**

---

# 34. New Tauri Installation

When the user installs the application on a new machine:

```text
New Tauri
    │
    ▼
authenticate
    │
    ▼
initial synchronization
    │
    ▼
download account data
    │
    ▼
populate SQLite
    │
    ▼
set sync cursor
```

For a large database, the API should support paginated initial synchronization rather than returning the entire database in one response.

---

# 35. Initial Synchronization

A new client can use:

```text
cursor = null
```

The server responds with the first page:

```json
{
  "changes": [...],
  "next_cursor": "500",
  "has_more": true
}
```

The client repeats until:

```text
has_more = false
```

Then:

```text
local cursor = final server cursor
```

From that point onward, normal incremental synchronization begins.

---

# 36. Sync Cursor Retention

The server must retain enough change-log history for clients to catch up.

For example, if a client has been offline for 90 days, the server should ideally still have the changes it needs.

There are two possible policies.

### Policy A — long retention

Keep change-log records indefinitely.

Advantages:

- simple
- reliable
- clients can remain offline for long periods

Disadvantage:

- change log grows indefinitely

### Policy B — bounded retention

Keep the change log for a defined period.

If a client falls behind beyond the retention window:

```text
client cursor too old
       │
       ▼
HTTP 409 / SYNC_RESET_REQUIRED
       │
       ▼
client performs full resynchronization
```

For most personal collection/productivity applications, bounded retention plus a reliable full-resync mechanism is a reasonable design.

---

# 37. Full Resynchronization

The application should support:

```text
POST /api/v1/sync/reset
```

or equivalent behavior through the sync endpoint.

A reset means:

```text
delete local replica
       │
       ▼
download current server state
       │
       ▼
rebuild SQLite
```

Before doing this automatically, unsynchronized local changes must be preserved or resolved.

A safer approach is:

```text
pending local mutations
        │
        ▼
try to upload them
        │
        ▼
if impossible:
        │
        ▼
report conflict/error
```

Never silently delete unsynchronized local work.

---

# 38. Schema Versioning

D1 and local SQLite must have compatible schemas.

Maintain migrations as versioned SQL files:

```text
migrations/
    0001_initial.sql
    0002_add_description.sql
    0003_add_tags.sql
    0004_add_change_log.sql
```

Cloudflare D1 supports versioned migration files and records applied migrations in a migration table. citeturn0search0

The Tauri application should use the same conceptual migration history for its local SQLite database.

However, D1-specific migration execution and Tauri local SQLite migration execution may use different migration runners.

The important invariant is:

```text
schema version N
```

must represent the same logical schema in both environments.

---

# 39. Migration Compatibility

A new application version may encounter an older local database.

Startup should perform:

```text
open SQLite
    │
    ▼
read schema version
    │
    ▼
apply pending local migrations
    │
    ▼
open application
```

The server schema is migrated separately during deployment.

Avoid deploying an application version that requires a server schema change before that schema change has been deployed.

A safe deployment sequence is generally:

```text
1. Deploy backward-compatible database migration
2. Deploy Worker API
3. Deploy web application
4. Release new Tauri application
```

---

# 40. Security Model

The Worker is the security boundary.

Clients are untrusted.

The Worker must perform:

- authentication
- authorization
- input validation
- account isolation
- resource ownership checks
- rate limiting
- payload size limits
- mutation validation
- concurrency checks
- idempotency checks

Do not rely on:

```text
browser JavaScript
Tauri Rust code
```

to enforce security rules.

Both can be modified by an attacker.

---

# 41. API Keys for Third-Party Applications

If the application eventually supports external API consumers, provide separate API credentials.

For example:

```text
User account
    │
    ├── Web session
    ├── Tauri device token
    └── Personal API token
```

An API token should be:

- randomly generated
- stored hashed on the server
- revocable
- optionally scoped
- optionally expiration-limited
- associated with an account

Example:

```http
Authorization: Bearer <personal-api-token>
```

API tokens should never be the same as Cloudflare API tokens.

A Cloudflare API token is an administrative credential for Cloudflare services; it should never be distributed to application users.

Cloudflare's own D1 REST API uses Cloudflare API tokens and is intended for administrative/API-level access, whereas the application should use its own Worker API. citeturn0search2turn0search12

---

# 42. Third-Party API Design

Third-party applications should interact with:

```text
https://api.example.com/api/v1/
```

not:

```text
https://api.cloudflare.com/...
```

The API should expose application concepts:

```text
/items
/collections
/tags
/media
/users
```

rather than database concepts:

```text
/tables/items
/sql
/execute
```

This allows the underlying database schema to change without breaking API consumers.

---

# 43. Rate Limiting

Rate limits should be applied at the Worker/API layer.

Different limits can be used for:

- normal CRUD
- synchronization
- bulk operations
- authentication
- third-party API access

For example:

```text
Normal API:
100 requests/minute

Sync:
larger request size but fewer requests

Authentication:
strict rate limit
```

Exact limits should be determined after measuring application behavior.

---

# 44. Error Model

Use consistent JSON errors.

Example:

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "The item was modified by another client.",
    "request_id": "..."
  }
}
```

Suggested error codes:

```text
AUTHENTICATION_REQUIRED
FORBIDDEN
NOT_FOUND
VALIDATION_ERROR
CONFLICT
ALREADY_PROCESSED
RATE_LIMITED
SYNC_CURSOR_EXPIRED
SYNC_RESET_REQUIRED
SERVER_ERROR
```

A request ID should be returned for troubleshooting.

---

# 45. Observability

The Worker should log:

- request ID
- authenticated account ID
- endpoint
- HTTP status
- latency
- mutation ID where applicable
- sync batch size
- number of conflicts
- D1 operation failures

Do not log:

- passwords
- authentication tokens
- full private application data
- API credentials

The Tauri application should provide local diagnostics such as:

```text
Last successful sync: 2026-08-26 22:17
Pending mutations: 4
Last sync error: none
Server cursor: 18291
```

---

# 46. API and Sync Libraries

The client applications should share an API model where practical.

For example:

```text
shared/
    api-types
    entity-types
    validation
```

The web client can use a TypeScript API client.

The Tauri application can have a Rust API client.

The wire protocol remains identical.

Example:

```text
POST /api/v1/sync
```

is the same operation regardless of whether the caller is:

```text
browser JavaScript
Rust/Tauri
third-party application
```

---

# 47. Tauri Internal Architecture

A recommended Tauri structure:

```text
┌─────────────────────────────────────────────┐
│ Svelte/JavaScript UI                        │
└─────────────────────┬───────────────────────┘
                      │ Tauri commands
                      ▼
┌─────────────────────────────────────────────┐
│ Rust application layer                      │
│                                             │
│ Repository                                  │
│ Sync engine                                 │
│ Authentication                              │
│ Network client                              │
└───────────────┬─────────────────┬───────────┘
                │                 │
                ▼                 ▼
        ┌──────────────┐   ┌───────────────┐
        │ SQLite       │   │ HTTP API      │
        │ local DB     │   │ client        │
        └──────────────┘   └───────┬───────┘
                                   │
                                   ▼
                              Cloudflare
                                Worker
                                   │
                                   ▼
                                  D1
```

The UI should generally not implement synchronization logic itself.

The Rust layer should own:

- SQLite transactions
- pending mutation queue
- network synchronization
- conflict handling
- authentication token storage
- sync state

---

# 48. Recommended Repository Structure

A possible project structure:

```text
project/
├── api/
│   ├── src/
│   │   ├── auth/
│   │   ├── routes/
│   │   ├── sync/
│   │   ├── db/
│   │   └── validation/
│   └── wrangler.toml
│
├── migrations/
│   ├── 0001_initial.sql
│   ├── 0002_items.sql
│   └── 0003_sync.sql
│
├── web/
│   └── ...
│
├── tauri/
│   ├── src/
│   │   ├── db/
│   │   ├── sync/
│   │   ├── api/
│   │   └── commands/
│   └── ...
│
├── shared/
│   ├── api-schema/
│   └── domain-model/
│
└── docs/
    └── architecture.md
```

---

# 49. API Contract

The API contract should be defined independently of the Worker implementation.

OpenAPI is a good choice:

```text
openapi.yaml
```

The contract describes:

- endpoints
- request schemas
- response schemas
- authentication
- error responses
- pagination
- synchronization protocol

This allows API clients to be generated or validated against a common specification.

---

# 50. Recommended Technology Choices

| Component           | Recommendation                          |
| ------------------- | --------------------------------------- |
| Cloud database      | Cloudflare D1                           |
| Cloud API           | Cloudflare Worker                       |
| Web hosting         | Cloudflare Pages/Workers                |
| Desktop framework   | Tauri                                   |
| Desktop backend     | Rust                                    |
| Local database      | SQLite                                  |
| Public API          | REST/JSON over HTTPS                    |
| API versioning      | `/api/v1`                               |
| Authentication      | Application-level tokens/session system |
| IDs                 | UUIDv4 or ULID                          |
| Sync cursor         | Monotonic server-side sequence          |
| Change tracking     | D1 change-log table                     |
| Offline queue       | Local SQLite mutation table             |
| Conflict detection  | Entity version / optimistic concurrency |
| Deletes             | Tombstones                              |
| Database migrations | Versioned SQL migrations                |
| API specification   | OpenAPI                                 |

---

# 51. Important Architectural Decision

The system should **not attempt to synchronize SQLite files directly**.

Do not do this:

```text
SQLite A
    │
    ├── copy database file ──> cloud
    │
    └── copy database file ──> SQLite B
```

Instead:

```text
SQLite A
    │
    │ logical changes
    ▼
Sync API
    │
    ▼
D1
    │
    │ logical changes
    ▼
SQLite B
```

The replicated unit is the **logical application change**, not the SQLite database file.

This makes synchronization:

- database-format independent
- auditable
- conflict-aware
- compatible with the web application
- compatible with future clients

---

# 52. Failure Scenarios

## Network failure during upload

```text
Client sends mutation
Server commits it
Network connection fails
Client retries
```

`mutation_id` makes the operation idempotent.

---

## Network failure during download

```text
Client downloads changes
SQLite transaction fails
```

The cursor is not advanced.

The client retries safely.

---

## Client crashes during synchronization

Because local database updates and cursor updates are transactional:

```text
crash before commit
    → retry

crash after commit
    → cursor already advanced
```

No partially applied batch should remain.

---

## Two clients edit the same record

Optimistic concurrency detects the conflict.

No silent last-write-wins should occur unless explicitly chosen for that entity.

---

## Client is offline for a long time

If its cursor remains within retention:

```text
incremental synchronization
```

If its cursor has expired:

```text
full resynchronization
```

---

# 53. Data Integrity Rules

The server must be authoritative for:

- entity versions
- change-log sequence
- timestamps used for synchronization
- ownership/account ID
- authorization
- mutation acceptance

The client is authoritative only for:

- its local UI state
- locally generated IDs
- pending mutation queue
- local cache

This distinction prevents local clients from manufacturing server synchronization state.

---

# 54. Recommended First Implementation

Do not implement the entire synchronization system at once.

A good implementation sequence is:

### Phase 1 — D1 and Worker

1. Create D1 database.
2. Define schema.
3. Create migrations.
4. Create Worker.
5. Bind D1 to Worker.
6. Implement authentication.
7. Implement CRUD API.
8. Add OpenAPI specification.

### Phase 2 — Web client

1. Connect web client to API.
2. Implement authentication.
3. Implement CRUD.
4. Test multiple browsers.
5. Test concurrent modifications.

### Phase 3 — Tauri local database

1. Add SQLite.
2. Run the same logical schema locally.
3. Implement repository/data-access layer.
4. Move Tauri UI to SQLite.
5. Verify completely offline operation.

### Phase 4 — Synchronization

1. Add `change_log`.
2. Add `pending_mutations`.
3. Add `sync_state`.
4. Add mutation IDs.
5. Implement push.
6. Implement pull.
7. Implement atomic cursor advancement.
8. Implement conflict detection.
9. Implement tombstones.

### Phase 5 — Hardening

1. Add retries.
2. Add exponential backoff.
3. Add rate limiting.
4. Add diagnostics.
5. Add full-resync support.
6. Add telemetry/logging.
7. Test crash recovery.
8. Test network interruption.
9. Test simultaneous edits.
10. Test very old clients.

---

# 55. Testing Requirements

The synchronization system should have automated tests for at least:

```text
Create offline
Update offline
Delete offline

Upload after reconnect
Download remote change
Multiple pending changes

Duplicate mutation
Lost HTTP response
HTTP timeout
Worker failure

Concurrent update
Concurrent delete
Update-vs-delete

Client crash during push
Client crash during pull

Expired cursor
Full resynchronization

Schema migration
Old client + new server
New client + existing data
```

The most important tests are failure tests. A synchronization system that works only when the network behaves perfectly is not actually an offline synchronization system.

---

# 56. Example End-to-End Scenario

Assume:

```text
Desktop A
Desktop B
Browser C
```

All belong to the same account.

### Initial state

```text
D1 sequence = 100
A cursor = 100
B cursor = 100
```

### Desktop A goes offline

User creates:

```text
Item X
```

SQLite:

```text
items:
    X

pending_mutations:
    CREATE X
```

D1 remains unchanged.

### Desktop B changes Item Y

B is online:

```text
B → Worker → D1
```

D1:

```text
sequence = 101
Item Y updated
```

### Desktop A reconnects

A pushes:

```text
CREATE X
```

D1 creates:

```text
Item X
sequence = 102
```

A then pulls:

```text
101
102
```

A's local database now contains both changes.

### Browser C opens

C reads from the normal API and sees:

```text
Item X
Item Y
```

No special browser synchronization mechanism is required.

---

# 57. Final Architecture

The resulting system is:

```text
                         ┌───────────────────┐
                         │   Web Browser     │
                         │                   │
                         │ HTTP API client   │
                         └─────────┬─────────┘
                                   │
                                   │ HTTPS
                                   ▼
                         ┌───────────────────┐
                         │ Cloudflare Worker │
                         │                   │
                         │ Auth              │
                         │ Authorization     │
                         │ Validation        │
                         │ CRUD API           │
                         │ Sync API           │
                         └─────────┬─────────┘
                                   │
                                   │ D1 Binding
                                   ▼
                         ┌───────────────────┐
                         │ Cloudflare D1     │
                         │                   │
                         │ Application data  │
                         │ Change log        │
                         │ Mutation records  │
                         └───────────────────┘
                                   ▲
                                   │
                                   │ HTTPS
                                   │
                         ┌─────────┴─────────┐
                         │ Tauri Application │
                         │                   │
                         │ Rust              │
                         │ Sync Engine       │
                         │ API Client        │
                         └─────────┬─────────┘
                                   │
                                   ▼
                         ┌───────────────────┐
                         │ Local SQLite      │
                         │                   │
                         │ Application data  │
                         │ Pending mutations │
                         │ Sync cursor       │
                         └───────────────────┘
```

The central architectural rule is:

> **D1 is the authoritative cloud database; the Worker is the only public database interface; Tauri SQLite databases are offline-capable local replicas synchronized through a versioned, idempotent, cursor-based application protocol.**

This provides a clean separation between the three concerns:

```text
D1       = authoritative shared state
Worker   = secure API + synchronization authority
SQLite   = local/offline state
```

It also leaves room for future clients—mobile applications, scripts, integrations, or third-party applications—without changing the underlying synchronization architecture.

## References

- Cloudflare D1 overview and application integration: citeturn0search4
- D1 Worker Binding API: citeturn0search5
- Cloudflare's recommended Worker API/proxy pattern for external D1 access: citeturn0search2
- D1 batch/transaction behavior: citeturn0search1
- D1 migrations and versioning: citeturn0search0
- D1 local development: citeturn0search10
