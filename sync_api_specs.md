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
For each operation in the batch:
1. **Find Existing Record**: Look up the record by its `clientId` under the authenticated user (`uid`).
2. **Handle CREATE**:
   - If the record does not exist:
     - Save the record with the payload.
     - Set `version = 1`, `isDeleted = false`, `updatedAt = current_time()`.
     - Return status `applied` with the `serverId`, `serverVersion = 1`, and `serverUpdatedAt`.
   - If the record already exists:
     - Treat it as an update conflict or update validation check.
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
  - `entityType`: The model collection. (e.g. `expense`, `loan`, `investment`, `budget`, `category_rule`).
* **Query Parameters**:
  - `since` (Optional): A cursor representing the timestamp or token from the last successful sync pull. In Spendly, this maps to the server's `updatedAt` timestamp of the last pulled record. (Format: ISO 8601 string, e.g., `2026-07-15T09:48:25.000Z`).
  - `limit` (Optional, Default: 200): Maximum number of records to return.
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
    "nextCursor": "2026-07-18T00:15:00.000Z"
  }
  ```
  *Note*: The fields can either be nested inside a payload key or flattened at the root of each item in `records` since the client fallback reads `item['payload'] ?? item`.

### Backend Processing Logic for Pull:
1. Fetch all records of `<entityType>` for the authenticated `uid`.
2. Filter for records where `updatedAt > since` (if `since` cursor is provided).
3. Sort results by `updatedAt` ascending.
4. Separate the results:
   - Active/Updated records: Items where `isDeleted = false` go to `records`.
   - Deleted records (Tombstones): Items where `isDeleted = true` go to the `tombstones` array (only their `clientId` is required).
5. Set `nextCursor` to the `updatedAt` timestamp of the latest record processed in this batch, or the current server time if no records are found.

## 6. Entity Schemas
Each sync endpoint's payload contains the JSON representation of the entity. The structures for all 5 entities are specified below.

### 6.1. Expense (`expense`)
Represents individual transactions or financial expenses.

| Field | Type | Required | Format / Enum Values | Description |
|---|---|---|---|---|
| `amount` | double | Yes | Decimal number | The transaction amount. |
| `category` | string | Yes | E.g. "Food", "Travel" | Category of the expense. |
| `note` | string | Yes | Text string | Additional description/memo. |
| `date` | string | Yes | ISO 8601 UTC timestamp | The date the expense occurred. |
| `method` | string | Yes | `CASH`, `UPI`, `CARD`, `NETBANKING` | Mode of payment (Uppercase). |
| `source` | string | Yes | `MANUAL`, `SMS`, `OCR` | Origin of the expense log (Uppercase). |
| `merchant` | string | Yes | Text string | Merchant/Recipient name. |
| `createdAt` | string | Yes | ISO 8601 UTC timestamp | The timestamp when the expense was logged. |

**Example Payload**:
```json
{
  "amount": 250.50,
  "category": "Food & Dining",
  "note": "Dinner with team",
  "date": "2026-07-18T20:30:00.000Z",
  "method": "UPI",
  "source": "MANUAL",
  "merchant": "Absolute Barbecues",
  "createdAt": "2026-07-18T20:32:15.000Z"
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
Represents category spending limits set for specific months.

| Field | Type | Required | Format / Enum Values | Description |
|---|---|---|---|---|
| `month` | string | Yes | `YYYY-MM` | Target budget month. |
| `category` | string | Yes | Text string | The target category (e.g. "Shopping"). |
| `limit` | double | Yes | Decimal number | Maximum allowed expenditure. |

**Example Payload**:
```json
{
  "month": "2026-07",
  "category": "Shopping",
  "limit": 15000.00
}
```

### 6.5. Category Rule (`category_rule`)
A rule maps SMS transaction text merchants to specific expense categories automatically.

| Field | Type | Required | Format / Enum Values | Description |
|---|---|---|---|---|
| `merchant` | string | Yes | Text string | Match pattern or exact merchant name. |
| `category` | string | Yes | Text string | The auto-assigned category. |

**Example Payload**:
```json
{
  "merchant": "uber trip",
  "category": "Transport"
}
```

## 7. Conflict Resolution Guidelines
In case the client receives a status conflict during a batch push, it uses a state-driven conflict resolver to decide the winning version.

1. **Delete Priority**: If either side (local or remote) flags the record as deleted (`isDeleted = true`), the deletion wins, and the record is marked deleted.
2. **Non-Dirty Checks**: If the client is fetching a remote update and its local version is not modified (not dirty), the remote server record simply overwrites the local record.
3. **Optimistic Version Wins**: If the client is dirty but `server.version <= local.version`, the client version wins (it is updated on top of what the client has already seen).
4. **Loan Safety Checks**: For loan entities, if the loan status (e.g. `PAID` vs `OVERDUE`) has diverged concurrently on both sides, the client marks this as a strict manual conflict (displays a conflict card to the user).
5. **Last-Write-Wins fallback**: In any other concurrently edited scenario, the record with the newer `updatedAt` timestamp wins.
