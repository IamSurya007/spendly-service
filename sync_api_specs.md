# Spendly Synchronization API Specification

This document provides a detailed specification of the REST APIs and data schemas used by the Spendly mobile client for offline-first synchronization. It outlines the endpoints, request/response payloads, entity types, and expected backend logic to facilitate backend implementation.

## 1. Authentication & Base URL
All requests from the Spendly client to the sync service must be authenticated.

* **Authentication Scheme**: Firebase Auth (JWT)
* **Header**: `Authorization: Bearer <Firebase_ID_Token>`
* **Content-Type**: `application/json`
* **Base URL**: The client is configured to connect to `https://spendly-service.onrender.com` (changeable in configuration).

On every request, the backend is expected to:
1. Verify the Firebase ID Token in the `Authorization` header.
2. Extract the authenticated user's ID (`uid`).
3. Scope all data queries, modifications, and synchronization scopes strictly to this `uid`.

## 2. User Profile Endpoint
Before synchronization starts, the client ensures the user profile is registered and up-to-date on the backend.

* **POST /users/me**
* **Description**: Registers or updates the user profile metadata on the backend using the current Firebase Authentication session.
* **Request Body**:
  ```json
  {
    "name": "John Doe",
    "email": "johndoe@example.com",
    "photoUrl": "https://lh3.googleusercontent.com/a/ALm5wu..."
  }
  ```
* **Expected Backend Action**:
  - Decode the JWT to obtain the Firebase user ID (`uid`).
  - If a user record with that `uid` does not exist, create it.
  - If it exists, update the `name`, `email`, and `photoUrl` if they differ from current values.
  - Return `200 OK` or `201 Created`.

## 3. Synchronization Architecture Overview
Spendly utilizes an offline-first outbox pattern with optimistic concurrency control (versioning).

* **Local ID (`clientId`)**: A client-generated UUID (v4) that uniquely identifies a record. This is persistent across syncs and acts as the primary key.
* **Server ID (`serverId` / `id`)**: A backend-generated identifier for the record. The client maps its local record to the `serverId` once the record is successfully synced.
* **Version (`version`)**: An integer counter incremented with every update to detect conflicts.
* **Updated Timestamp (`updatedAt`)**: The UTC timestamp when the record was last modified (used for Last-Write-Wins fallback).
* **Soft Deletes (`isDeleted`)**: Records are never hard-deleted on the server or on synced clients. Instead, a boolean tombstone flag `isDeleted = true` is set.

## 4. Push Batch Endpoint
The client batches pending local mutations (creates, updates, and deletes) from its outbox queue and pushes them to the server.

* **POST /sync/<entityType>/batch**
* **Path Parameters**:
  - `entityType`: The model collection being synchronized. Must be one of:
    - `expense`
    - `account`
    - `loan`
    - `investment`
    - `budget`
    - `category_rule`
* **Request Body**:
  ```json
  {
    "operations": [
      {
        "clientId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        "operationType": "CREATE",
        "clientVersion": 1,
        "payload": {
          // Entity-specific JSON data fields (see Section 6)
        }
      },
      {
        "clientId": "c2004245-568b-4a57-b089-a29bc01a76f2",
        "operationType": "UPDATE",
        "clientVersion": 2,
        "payload": {
          // Entity-specific JSON data fields (see Section 6)
        }
      },
      {
        "clientId": "a3b9845d-7521-4f10-9ccb-dbfa2478e123",
        "operationType": "DELETE",
        "clientVersion": 3,
        "payload": {} // Payload is empty for delete operations
      }
    ]
  }
  ```
* **Expected Response Schema**: The response can be a JSON array directly or an object containing a results array.
  ```json
  [
    {
      "clientId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "status": "applied",
      "serverId": "server-generated-db-id-1",
      "serverVersion": 1,
      "serverUpdatedAt": "2026-07-18T00:15:00.000Z"
    },
    {
      "clientId": "c2004245-568b-4a57-b089-a29bc01a76f2",
      "status": "conflict",
      "remotePayload": {
        // Current payload of the entity on the server database to let the client resolve
      }
    },
    {
      "clientId": "a3b9845d-7521-4f10-9ccb-dbfa2478e123",
      "status": "rejected" // If validation fails, or unauthorized
    }
  ]
  ```

### Backend Processing Logic for Push Batch:
Batches for the same user and entity type are serialised with a Postgres advisory lock (`pg_advisory_xact_lock`), so a retry racing the original request cannot insert the same `clientId` twice.

For each operation in the batch:
1. **Find Existing Record**: Look up the record by its `clientId` under the authenticated user (`uid`).
2. **Handle CREATE**:
   - If the record does not exist:
     - Save the record with the payload.
     - Set `version = 1`, `isDeleted = false`, `updatedAt = current_time()`.
     - Return status `applied` with the `serverId`, `serverVersion = 1`, and `serverUpdatedAt`.
   - If the record already exists and `clientVersion <= server_record.version`, the CREATE is a **replay** (a retried request, or the same record created again after a reinstall, e.g. an SMS re-import). It is idempotent:
     - Nothing is written. Return status `applied` with the server's `serverId` / `serverVersion` / `serverUpdatedAt`, plus:
       - `isDeleted: true` if the user had deleted the record (it is **not** resurrected; the client marks its copy deleted), or
       - `serverPayload`: the server's current fields, which the client applies over its local copy (server wins).
   - If the record exists and `clientVersion > server_record.version` (the client edited the record before its first push was acknowledged), apply the payload as an update.
3. **Handle UPDATE**:
   - If the record does not exist:
     - Upsert it, or return rejected/conflict depending on backend policy (usually it should be created if not exists, but setting correct version).
   - If the record exists:
     - Check if the incoming `clientVersion` is based on the current server version.
     - **Concurrency Check**: If `server_record.version >= incoming.clientVersion` and the incoming payload fields have diverged from the server, there is a conflict. Return status `conflict` and include the server's current representation in `remotePayload`.
     - Otherwise, apply the update. Increment the version to `server_record.version + 1` (or use `clientVersion`), update the fields, set `updatedAt = current_time()`, and return status `applied` with `serverVersion` and `serverUpdatedAt`.
4. **Handle DELETE**:
   - Set the record's `isDeleted = true`, increment version, and set `updatedAt = current_time()`.
   - Return status `applied` with updated details.

## 5. Pull Endpoint
The client queries the server to pull changes made to the user's data (by web interfaces or other client devices) since the client's last sync.

* **GET /sync/<entityType>**
* **Path Parameters**:
  - `entityType`: The model collection: `account`, `category`, `expense`, `loan`, `investment`, `budget`, `category_rule`. Clients pull `account` and `category` first because expenses reference them.
* **Query Parameters**:
  - `since` (Optional): The opaque `nextCursor` returned by the previous pull. Format `<ISO updatedAt>|<record id>` (e.g. `2026-07-15T09:48:25.123Z|3f2a…`). The id tie-breaker makes paging exact when many rows share one `updatedAt` (bulk imports). A bare ISO timestamp from older clients is still accepted.
  - `limit` (Optional, Default: 200, max 500): Maximum number of records to return.
* **Expected Response Schema**:
  ```json
  {
    "records": [
      {
        "id": "server-database-id-1",
        "clientId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        "version": 3,
        "updatedAt": "2026-07-18T00:15:00.000Z",
        "isDeleted": false,
        "payload": {
          // Entity-specific fields (see Section 6)
        }
      }
    ],
    "tombstones": [
      "clientId-of-deleted-record-1",
      "clientId-of-deleted-record-2"
    ],
    "nextCursor": "2026-07-18T00:15:00.000Z|server-database-id-1",
    "hasMore": false
  }
  ```
  *Note*: The fields can either be nested inside a payload key or flattened at the root of each item in `records` since the client fallback reads `item['payload'] ?? item`.

### Backend Processing Logic for Pull:
1. Fetch all records of `<entityType>` for the authenticated `uid`.
2. Filter for records after the cursor: `updatedAt > since` or (`updatedAt = since` and `id > sinceId`). `updatedAt` is compared truncated to milliseconds, matching the precision of JS dates and the cursor.
3. Sort results by (`updatedAt`, `id`) ascending and take `limit + 1` rows; `hasMore` is true when the extra row exists.
4. Separate the results:
   - Active/Updated records: Items where `isDeleted = false` go to `records`.
   - Deleted records (Tombstones): Items where `isDeleted = true` go to the `tombstones` array (only their `clientId` is required).
5. Set `nextCursor` to `<updatedAt>|<id>` of the last record in the page. With no records, the incoming cursor is returned unchanged.

### Client Pull Loop
The app keeps pulling pages while `hasMore` is true (older servers without `hasMore`: while a full page came back). The 30-second pull throttle only applies to the first page of a pull, never to the pages after it. Before an SMS inbox scan the app calls `SyncEngine.syncNow()`, which pushes pending changes and pulls every entity completely, so duplicate detection sees all transactions saved on the server (important right after a reinstall).

## 6. Entity Schemas
Each sync endpoint's payload contains the JSON representation of the entity. The structures for all 7 entities are specified below.

### 6.1. Expense (`expense`)
Represents individual transactions or financial expenses.

| Field | Type | Required | Format / Enum Values | Description |
|---|---|---|---|---|
| `amount` | double | Yes | Decimal number | The transaction amount (negative = credit/income). |
| `category` | string | Yes | E.g. "Food & Drinks" | Display name of the parent category when written. Older clients send only this; the server then derives the ids below from it. |
| `categoryId` | string | No | E.g. `food` | Parent category id (see "Category ids" below). |
| `subcategoryId` | string | No | E.g. `food.delivery` | Subcategory id, empty if only a parent is set. |
| `subcategory` | string | No | E.g. "Food Delivery" | Display name of the subcategory. |
| `note` | string | Yes | Text string | Additional description/memo. |
| `date` | string | Yes | ISO 8601 UTC timestamp | The date the expense occurred. |
| `method` | string | Yes | `CASH`, `UPI`, `CARD`, `NETBANKING` | Mode of payment (Uppercase). |
| `source` | string | Yes | `MANUAL`, `SMS`, `OCR` | Origin of the expense log (Uppercase). |
| `merchant` | string | Yes | Text string | Merchant/Recipient name. |
| `accountId` | string | No | String (default: `"default_bank"`) | The associated bank or card account ID. |
| `isCountedAsSpend` | boolean | No | `true`, `false` (default: `true`) | Indicates whether to include transaction in budget tracking & spend totals. |
| `createdAt` | string | Yes | ISO 8601 UTC timestamp | The timestamp when the expense was logged. |

**Example Payload**:
```json
{
  "id": "uuid-v4-string",
  "amount": 2500.00,
  "category": "Groceries",
  "categoryId": "groceries",
  "subcategoryId": "groceries.quick",
  "subcategory": "Quick Commerce",
  "note": "Weekly supermarket shopping",
  "date": "2026-09-17T14:00:00.000Z",
  "method": "UPI",
  "source": "SMS",
  "merchant": "Blinkit",
  "accountId": "acc_hdfc_1234",
  "isCountedAsSpend": true,
  "createdAt": "2026-09-17T14:05:00.000Z"
}
```

**SMS-derived expenses**: the `clientId` is a deterministic UUID v5 of `fiscora:sms:v2:<sender>|<sent time in seconds>|<normalised body>` (`SmsDedup.key` in the app). The same SMS always produces the same `clientId`, whether it was scanned from the inbox or captured live, and on any install, so the replay rule in Section 4 deduplicates re-imports. Rows imported by older builds used `fiscora:sms:<dateMs>_<amount>_<merchant>`; the app still recognises those.

### 6.2. Account (`account`)
Represents user bank accounts, credit cards, cash, and digital wallets.

| Field | Type | Required | Format / Enum Values | Description |
|---|---|---|---|---|
| `id` | string | Yes | UUID or string | Unique ID of the account. |
| `name` | string | Yes | E.g. "HDFC Salary Account" | Display name of the account. |
| `type` | string | Yes | `bank`, `credit_card`, `cash`, `wallet` | Account category. |
| `currentBalance` | double | Yes | Decimal number | Current available balance. |
| `creditLimit` | double | Yes | Decimal number | Credit limit for credit card accounts. |
| `accountNumberLast4` | string | No | String (e.g. "4321") | Last 4 digits of account or card number. |
| `colorValue` | integer | Yes | ARGB integer (e.g. 4280962800) | Color hex representation. |

**Example Payload**:
```json
{
  "id": "acc_hdfc_1234",
  "name": "HDFC Salary Account",
  "type": "bank",
  "currentBalance": 125000.50,
  "creditLimit": 0,
  "accountNumberLast4": "4321",
  "colorValue": 4280962800
}
```

### 6.2. Loan (`loan`)
Represents borrowed (taken) or lent (given) liabilities.

| Field | Type | Required | Format / Enum Values | Description |
|---|---|---|---|---|
| `type` | string | Yes | `TAKEN`, `GIVEN` | Whether it is a loan taken or given. |
| `name` | string | Yes | Text string | The counterparty's name. |
| `principal` | double | Yes | Decimal number | Initial borrowed or lent amount. |
| `total` | double | Yes | Decimal number | Total amount due (principal + interest). |
| `interestRate` | double | Yes | Decimal percentage | Annual interest rate (e.g. 12.0). |
| `repaymentDate` | string | No | `YYYY-MM-DD` | Target date to settle the loan. |
| `status` | string | Yes | `ACTIVE`, `PAID`, `OVERDUE`, `PARTIAL` | Status of the loan. |
| `notes` | string | Yes | Text string | Additional comments/memos. |
| `createdAt` | string | Yes | ISO 8601 UTC timestamp | When the loan was logged. |

**Example Payload**:
```json
{
  "type": "GIVEN",
  "name": "Alice Smith",
  "principal": 5000.0,
  "total": 5100.0,
  "interestRate": 2.0,
  "repaymentDate": "2026-10-15",
  "status": "ACTIVE",
  "notes": "Lent cash for home repairs",
  "createdAt": "2026-07-18T10:00:00.000Z"
}
```

### 6.3. Investment (`investment`)
Represents asset allocations and recurring deposits.

| Field | Type | Required | Format / Enum Values | Description |
|---|---|---|---|---|
| `type` | string | Yes | `RD`, `SIP`, `MF`, `FD`, `PPF`, `OTHER` | Type of investment (Recurring Deposit, Mutual Fund, etc.). |
| `name` | string | Yes | Text string | Name of the fund or deposit. |
| `monthlyAmount` | double | Yes | Decimal number | Recurring monthly payment (0 if lump sum). |
| `principal` | double | Yes | Decimal number | Total capital invested. |
| `maturityAmount` | double | Yes | Decimal number | Projected maturity value. |
| `durationMonths` | integer | Yes | Positive integer | Term of the investment. |
| `interestRate` | double | No | Decimal percentage | Annual rate. Omitted by the mobile app; when absent, the stored value is left unchanged. |
| `startDate` | string | Yes | `YYYY-MM-DD` | Start date of the investment. |
| `maturityDate` | string | Yes | `YYYY-MM-DD` | Final maturity date. |
| `institution` | string | Yes | Text string | E.g. "HDFC Bank", "Zerodha Coin". |

**Example Payload**:
```json
{
  "type": "SIP",
  "name": "Nifty 50 Index Fund",
  "monthlyAmount": 5000.0,
  "principal": 120000.0,
  "maturityAmount": 150000.0,
  "durationMonths": 24,
  "startDate": "2026-01-01",
  "maturityDate": "2027-12-31",
  "institution": "Zerodha Coin"
}
```

### 6.4. Budget (`budget`)
Represents category spending limits.

| Field | Type | Required | Format / Enum Values | Description |
|---|---|---|---|---|
| `month` | string | Yes | `YYYY-MM`, or `all` | Target budget month. The mobile app stores limits that apply to every month under `all`. |
| `category` | string | Yes | Parent category id | E.g. `shopping`, or a custom category UUID. Legacy names ("Shopping") sent by older clients are converted to the parent id. |
| `limit` | double | Yes | Decimal number | Maximum allowed expenditure. |

**Example Payload**:
```json
{
  "month": "all",
  "category": "shopping",
  "limit": 15000.00
}
```

### 6.5. Category Rule (`category_rule`)
A rule maps SMS transaction merchants to a category automatically. Rules are only stored when the user picks a category for a merchant; keyword guesses are not saved as rules.

| Field | Type | Required | Format / Enum Values | Description |
|---|---|---|---|---|
| `merchant` | string | Yes | Text string | Exact merchant name (matched case-insensitively). |
| `category` | string | Yes | Text string | Display name of the parent category. |
| `categoryId` | string | No | E.g. `transport` | Parent category id (derived from `category` if missing). |
| `subcategoryId` | string | No | E.g. `transport.cab` | Subcategory id. |

**Example Payload**:
```json
{
  "merchant": "uber trip",
  "category": "Transport",
  "categoryId": "transport",
  "subcategoryId": "transport.cab"
}
```

### 6.6. Category (`category`)
A user's custom category or subcategory, or the user's override of a system category. `clientId` is the category id: a UUID for custom categories, the system slug (e.g. `food`) for overrides. System categories themselves are never synced; every client ships the same generated taxonomy.

| Field | Type | Required | Format / Enum Values | Description |
|---|---|---|---|---|
| `name` | string | Yes | Max 64 chars | Display name. |
| `icon` | string | Yes | Phosphor icon key, e.g. `fork-knife` | Icon shown on the coloured tile. |
| `color` | string | Yes | `#RRGGBB` | Tile colour. |
| `kind` | string | Yes | `expense`, `income`, `transfer` | Which picker tab it appears under. |
| `parentId` | string | No | Category id, or `null` | Set for subcategories. |
| `isSystem` | boolean | Yes | | `true` for an override of a system category. |
| `isHidden` | boolean | Yes | | Hidden categories still resolve on old transactions but are not offered in pickers. |
| `sortOrder` | integer | Yes | | Display order (parents use steps of 100). |

**Example Payload**:
```json
{
  "name": "Tiffin",
  "icon": "fork-knife",
  "color": "#F97316",
  "kind": "expense",
  "parentId": "food",
  "isSystem": false,
  "isHidden": false,
  "sortOrder": 5
}
```

### Category ids
System category ids are stable slugs (`food`, `food.delivery`, …) defined in `shared/categories.json`. That file also holds the legacy-name mapping (e.g. "Coffee & Snacks" → `food` / `food.cafe`) that the server, the app and the web all apply to records written before ids existed. On startup the server backfills ids for existing expenses, rules and budgets (see `CategoriesService.backfill`).

## 7. Conflict Resolution Guidelines
In case the client receives a status conflict during a batch push, it uses a state-driven conflict resolver to decide the winning version.

1. **Delete Priority**: If either side (local or remote) flags the record as deleted (`isDeleted = true`), the deletion wins, and the record is marked deleted.
2. **Non-Dirty Checks**: If the client is fetching a remote update and its local version is not modified (not dirty), the remote server record simply overwrites the local record.
3. **Optimistic Version Wins**: If the client is dirty but `server.version <= local.version`, the client version wins (it is updated on top of what the client has already seen).
4. **Loan Safety Checks**: For loan entities, if the loan status (e.g. `PAID` vs `OVERDUE`) has diverged concurrently on both sides, the client marks this as a strict manual conflict (displays a conflict card to the user).
5. **Last-Write-Wins fallback**: In any other concurrently edited scenario, the record with the newer `updatedAt` timestamp wins.
