# Spendly API Integration Guide for Flutter

This document provides a comprehensive guide to integrating the **Spendly NestJS Backend** into a Flutter application. It covers authentication, local development setup, endpoint contracts, Dart models, and helper classes for networking.

---

## 1. Authentication & Networking Setup

The Spendly NestJS backend enforces global authentication. Every API request (except where bypassed) must include a valid Firebase ID Token as a bearer token in the `Authorization` header.

### Authentication Flow in Flutter
1. Authenticate the user in your Flutter app using the [`firebase_auth`](https://pub.dev/packages/firebase_auth) package.
2. Retrieve the user's Firebase ID token:
   ```dart
   String? token = await FirebaseAuth.instance.currentUser?.getIdToken();
   ```
3. Attach this token to all outgoing HTTP requests:
   ```http
   Authorization: Bearer <Firebase_ID_Token>
   ```

### Network Client Configuration
For Flutter, we recommend using the [`dio`](https://pub.dev/packages/dio) package because it supports **Interceptors** that can automatically refresh and attach the Bearer token to every request.

#### Localhost Configuration Note
When testing your Flutter app on an emulator or physical device, `localhost` (or `127.0.0.1`) points to the device itself. Use the following addresses instead:
- **Android Emulator**: `http://10.0.2.2:3000`
- **iOS Simulator**: `http://localhost:3000` (runs on the host Mac)
- **Physical Device**: Use your computer's local IP address (e.g., `http://192.168.1.100:3000`). Ensure your computer and mobile device are connected to the same Wi-Fi network.

#### Swagger Docs
When running the NestJS server locally, the Swagger UI is available at:
`http://localhost:3000/api`

---

## 2. Common Data Types & Dart Enums

Below are the key backend enums translated into Dart. Define these in your Flutter codebase (e.g., `lib/models/enums.dart`).

```dart
enum PaymentMethod {
  CASH,
  UPI,
  CARD,
  NET_BANKING,
  CHEQUE;

  String toJson() => name;
  static PaymentMethod fromJson(String value) => 
      PaymentMethod.values.firstWhere((e) => e.name == value, orElse: () => PaymentMethod.CASH);
}

enum ExpenseSource {
  MANUAL,
  SMS,
  OCR;

  String toJson() => name;
  static ExpenseSource fromJson(String value) => 
      ExpenseSource.values.firstWhere((e) => e.name == value, orElse: () => ExpenseSource.MANUAL);
}

enum LoanType {
  TAKEN,
  GIVEN;

  String toJson() => name;
  static LoanType fromJson(String value) => 
      LoanType.values.firstWhere((e) => e.name == value, orElse: () => LoanType.TAKEN);
}

enum LoanStatus {
  ACTIVE,
  PAID,
  OVERDUE,
  PARTIAL;

  String toJson() => name;
  static LoanStatus fromJson(String value) => 
      LoanStatus.values.firstWhere((e) => e.name == value, orElse: () => LoanStatus.ACTIVE);
}

enum InvestmentType {
  RD,
  SIP,
  MF,
  FD,
  PPF,
  OTHER;

  String toJson() => name;
  static InvestmentType fromJson(String value) => 
      InvestmentType.values.firstWhere((e) => e.name == value, orElse: () => InvestmentType.OTHER);
}
```

---

## 3. Endpoints & API Reference

### 3.1. Users API (`/users`)
Manages user profiles, FCM notification registration, and Firestore data migrations.

#### `POST /users/me`
* **Description**: Create or update the user's profile information.
* **Request Body** (`UpsertUserDto`):
  ```json
  {
    "name": "John Doe",
    "email": "johndoe@example.com",
    "photoUrl": "https://example.com/photo.jpg" // Optional (must be a valid URL)
  }
  ```
* **Response**: Returns the updated user object.

#### `GET /users/me`
* **Description**: Retrieve the current user's profile.
* **Response**:
  ```json
  {
    "id": "firebase-uid-string",
    "name": "John Doe",
    "email": "johndoe@example.com",
    "photoUrl": "https://example.com/photo.jpg",
    "fcmToken": "fcm-token-string",
    "sheetsConnected": false,
    "sheetsId": null,
    "lastSyncedAt": null,
    "createdAt": "2026-07-09T12:00:00.000Z",
    "updatedAt": "2026-07-09T12:00:00.000Z"
  }
  ```

#### `PATCH /users/me/fcm`
* **Description**: Update the user's Firebase Cloud Messaging (FCM) token for push notifications.
* **Request Body** (`UpdateFcmDto`):
  ```json
  {
    "fcmToken": "fcm-token-string"
  }
  ```
* **Response**: Returns the updated user object.

#### `POST /users/me/migrate-firestore`
* **Description**: Trigger migration of user data from Firestore (useful for legacy data transition).
* **Response**: Migration operation status.

#### `DELETE /users/me`
* **Description**: Permenantly delete the user's account and all associated data.
* **Response**:
  ```json
  {
    "message": "Account deleted successfully"
  }
  ```

---

### 3.2. Budgets API (`/budgets`)
Configure monthly category limits and track budget safety thresholds (Warning at 80% usage, Exceeded at 100%).

> **Category keys**: a budget's `category` is a **parent category id** (e.g. `food`, or a custom category UUID); see [Categories API](#37-categories-api-categories). Legacy names sent by older clients ("Food", "Groceries") are converted to the matching parent id, and budgets that map to the same parent are merged (limits added). Removed budgets are soft-deleted so the mobile app receives a tombstone.

#### `GET /budgets/:month`
* **Description**: Retrieve all budgets set for a specific month.
* **URL Parameter**: `month` (Format: `YYYY-MM`, e.g., `2026-07`)
* **Response**: List of budgets.
  ```json
  [
    {
      "id": "budget-uuid-string",
      "userId": "firebase-uid-string",
      "month": "2026-07",
      "category": "Food",
      "limit": 5000.0,
      "createdAt": "2026-07-15T00:00:00.000Z"
    }
  ]
  ```

#### `PUT /budgets/:month`
* **Description**: Create or overwrite all budget categories for a month. Categories omitted from this list will be deleted.
* **URL Parameter**: `month` (Format: `YYYY-MM`)
* **Request Body** (`UpsertBudgetDto`):
  ```json
  {
    "budgets": [
      { "category": "food", "limit": 5000 },
      { "category": "housing", "limit": 15000 },
      { "category": "entertainment", "limit": 2000 }
    ]
  }
  ```
* **Response**: List of saved budgets.

#### `PATCH /budgets/:month/:category`
* **Description**: Set or update the budget limit for a single category in a specific month.
* **URL Parameters**: `month` (`YYYY-MM`), `category` (e.g. `Food`)
* **Request Body** (`UpdateBudgetLimitDto`):
  ```json
  {
    "limit": 6000
  }
  ```
* **Response**: The updated single budget object.

#### `GET /budgets/:month/status`
* **Description**: Get the progress of category limits vs. actual expenses for the month. Includes the month's own budgets plus the mobile app's every-month (`month: "all"`) limits for categories that have no month-specific budget. Spend counts debits marked as spend, grouped by the expense's parent `categoryId`.
* **URL Parameter**: `month` (`YYYY-MM`)
* **Response**:
  ```json
  {
    "month": "2026-07",
    "budgets": [
      {
        "category": "Food & Drinks",   // display name (custom renames applied)
        "categoryId": "food",
        "month": "all",                // "all" = limit set in the mobile app, applies every month
        "limit": 5000.0,
        "spent": 4200.0,
        "remaining": 800.0,
        "percentUsed": 84,
        "status": "WARNING" // Can be "OK", "WARNING" (>= 80%), or "EXCEEDED" (>= 100%)
      }
    ]
  }
  ```

---

### 3.3. Expenses API (`/expenses`)
Log transactional spending. Integrates with automated SMS parsing and OCR receipt scanning.

#### `POST /expenses`
* **Description**: Create a new expense.
* **Request Body** (`CreateExpenseDto`):
  ```json
  {
    "amount": 250.50,
    "category": "Food & Drinks",       // Display name of the parent category
    "categoryId": "food",              // Optional: derived from `category` when omitted
    "subcategoryId": "food.cafe",      // Optional
    "subcategory": "Coffee & Snacks",  // Optional display name
    "date": "2026-07-15T12:00:00.000Z", // Date string
    "note": "Lunch with team",         // Optional
    "method": "UPI",                   // Optional: "CASH" | "UPI" | "CARD" | "NET_BANKING" | "CHEQUE"
    "source": "MANUAL",                // Optional: "MANUAL" | "SMS" | "OCR"
    "merchant": "Chai Point"           // Optional
  }
  ```
* **Response**: Created expense object (containing auto-generated ID and userId).

#### `GET /expenses`
* **Description**: Retrieve expenses filtered and paginated.
* **Query Parameters** (`QueryExpenseDto`):
  * `month` (Required, format: `YYYY-MM`)
  * `categoryId` (Optional, string): a category **or** subcategory id; matches expenses at either level
  * `category` (Optional, string): legacy exact match on the category display name
  * `source` (Optional, enum: `MANUAL`, `SMS`, `OCR`)
  * `limit` (Optional, number, default: 50)
  * `cursor` (Optional, string representing the ID of the last expense in the previous page for cursor pagination)
* **Response**: List of expense objects ordered by date (descending). Deleted expenses are excluded.

#### `GET /expenses/summary`
* **Description**: Get total expenses, total income (default 0), net balance, and a breakdown by parent category (largest first), each with its subcategories.
* **Query Parameter**: `month` (Optional, format: `YYYY-MM`, defaults to the current month)
* **Response**:
  ```json
  {
    "month": "2026-07",
    "totalExpenses": 18250.50,
    "totalIncome": 0,
    "balance": -18250.50,
    "byCategory": [
      {
        "category": "Housing",
        "categoryId": "housing",
        "total": 14000.00,
        "count": 1,
        "subcategories": [
          { "subcategory": "Rent", "subcategoryId": "housing.rent", "total": 14000.00, "count": 1 }
        ]
      },
      {
        "category": "Food & Drinks",
        "categoryId": "food",
        "total": 4250.50,
        "count": 12,
        "subcategories": [
          { "subcategory": "Food Delivery", "subcategoryId": "food.delivery", "total": 3100.00, "count": 8 }
        ]
      }
    ]
  }
  ```

#### `GET /expenses/:id`
* **Description**: Retrieve a specific expense by ID.
* **Response**: Expense object.

#### `PATCH /expenses/:id`
* **Description**: Update fields of an existing expense.
* **Request Body** (`UpdateExpenseDto` - all fields are optional):
  ```json
  {
    "amount": 280.00,
    "category": "Food",
    "date": "2026-07-15T12:00:00.000Z",
    "note": "Updated lunch description",
    "method": "UPI",
    "source": "MANUAL",
    "merchant": "Chai Point"
  }
  ```
* **Response**: Updated expense object.

#### `DELETE /expenses/:id`
* **Description**: Delete an expense. This is a soft delete (`isDeleted = true`, version bumped) so the mobile app removes it on its next sync.
* **Response**:
  ```json
  {
    "message": "Expense deleted successfully"
  }
  ```

---

### 3.4. Investments API (`/investments`)
Track investments (FDs, RDs, SIPs, Mutual Funds). The system automatically calculates RD maturity values if they are not overridden.

#### `POST /investments`
* **Description**: Create a new investment record.
* **Request Body** (`CreateInvestmentDto`):
  ```json
  {
    "name": "HDFC Recurring Deposit",
    "type": "RD",                  // Optional: "RD" | "SIP" | "MF" | "FD" | "PPF" | "OTHER"
    "monthlyAmount": 5000,
    "principal": 60000,
    "durationMonths": 12,
    "startDate": "2026-07-01",
    "maturityDate": "2027-07-01",
    "institution": "HDFC Bank",    // Optional
    "interestRate": 7.1,           // Optional: stored, used for the RD maturity calculation (default 6.5) and shown to the AI assistant
    "maturityAmount": 62345        // Optional (auto-calculated for RD if left blank)
  }
  ```
* **Response**: Created investment object.

#### `GET /investments`
* **Description**: Get all investments for the logged-in user.
* **Response**: List of investment objects.

#### `GET /investments/summary`
* **Description**: Get overall stats and upcoming maturities.
* **Response**:
  ```json
  {
    "totalInvested": 120000,
    "totalMaturityValue": 135400,
    "upcomingMaturities": [
      {
        "id": "investment-uuid",
        "name": "HDFC Recurring Deposit",
        "maturityAmount": 62345,
        "maturityDate": "2027-07-01",
        "daysRemaining": 350,
        "type": "RD"
      }
    ]
  }
  ```

#### `GET /investments/:id`
* **Description**: Retrieve a specific investment by ID.
* **Response**: Investment details.

#### `PATCH /investments/:id`
* **Description**: Update investment details (auto-recalculates maturity if principal, duration, or interest rate changes and maturityAmount is not provided).
* **Request Body** (`UpdateInvestmentDto` - all fields optional):
  ```json
  {
    "name": "Updated RD Name",
    "monthlyAmount": 5500
  }
  ```
* **Response**: Updated investment details.

#### `DELETE /investments/:id`
* **Description**: Delete an investment record (soft delete; excluded from lists, summaries and the AI context).
* **Response**:
  ```json
  {
    "message": "Investment deleted successfully"
  }
  ```

---

### 3.5. Loans API (`/loans`)
Track money borrowed from (TAKEN) or lent to (GIVEN) individuals or entities.

#### `POST /loans`
* **Description**: Record a new loan.
* **Request Body** (`CreateLoanDto`):
  ```json
  {
    "type": "GIVEN",
    "name": "Amit Sharma",
    "principal": 5000.0,
    "total": 5000.0,                   // Total amount to be repaid (including any interest agreed)
    "interestRate": 12.0,              // Optional: annual %, shown to the AI assistant
    "repaymentDate": "2026-08-15",     // Optional
    "notes": "Lent for travel ticket"  // Optional
  }
  ```
* **Response**: Created loan object.

#### `GET /loans`
* **Description**: Retrieve loans.
* **Query Parameters** (Optional):
  * `type` (Enum: `TAKEN`, `GIVEN`)
  * `status` (Enum: `ACTIVE`, `PAID`, `OVERDUE`, `PARTIAL`)
* **Response**: List of loans.

#### `GET /loans/summary`
* **Description**: Get total debt stats.
* **Response**:
  ```json
  {
    "totalOwed": 2000.0,          // Money you need to repay (TAKEN)
    "totalToReceive": 5000.0,     // Money owed to you (GIVEN)
    "netPosition": 3000.0,        // Net value (totalToReceive - totalOwed)
    "upcomingRepayments": [
      {
        "id": "loan-uuid",
        "name": "Amit Sharma",
        "total": 5000.0,
        "repaymentDate": "2026-08-15",
        "daysRemaining": 31,
        "type": "GIVEN"
      }
    ]
  }
  ```

#### `GET /loans/:id`
* **Description**: Get details of a specific loan.
* **Response**: Loan object.

#### `PATCH /loans/:id`
* **Description**: Update details of a loan (e.g. changing status to `PAID` or `PARTIAL`).
* **Request Body** (`UpdateLoanDto` - all fields optional):
  ```json
  {
    "status": "PAID"
  }
  ```
* **Response**: Updated loan object.

#### `DELETE /loans/:id`
* **Description**: Delete a loan record (soft delete; excluded from lists, summaries and the AI context).
* **Response**:
  ```json
  {
    "message": "Loan deleted successfully"
  }
  ```

---

### 3.6. Google Sheets API (`/sheets`)
Export financial details directly into a Google Sheet spreadsheet.

#### `POST /sheets/connect`
* **Description**: Save spreadsheet ID and OAuth refresh token.
* **Request Body** (`ConnectSheetsDto`):
  ```json
  {
    "sheetsId": "google-sheet-id-from-url",
    "sheetsToken": "google-oauth-refresh-token"
  }
  ```
* **Response**: Returns the updated User object.

#### `POST /sheets/sync`
* **Description**: Force-sync all user data (Expenses, Loans, Investments, and a 12-month summary) into 4 distinct tabs in the connected Google Sheet.
* **Response**:
  ```json
  {
    "message": "Data synced to Google Sheets successfully"
  }
  ```

#### `GET /sheets/status`
* **Description**: Check if Google Sheets is connected.
* **Response**:
  ```json
  {
    "connected": true,
    "sheetsId": "google-sheet-id-from-url",
    "lastSyncedAt": "2026-07-15T09:12:00.000Z"
  }
  ```

#### `DELETE /sheets/disconnect`
* **Description**: Clear sheets connection credentials.
* **Response**: Updated User object.

---

### 3.7. Categories API (`/categories`)
Transaction categories are a two-level taxonomy (parent → subcategory) with Phosphor icons and colours, in the style of the Fold app. System categories are defined once in `shared/categories.json` and generated into the backend, the Flutter app and the web app with `node shared/generate-categories.mjs`. Users can add custom categories and rename, recolour, hide or reorder system ones; those rows sync through `/sync/category` (see `sync_api_specs.md`, section 6.6).

#### `GET /categories`
* **Description**: The effective categories for the current user: system taxonomy with the user's overrides applied, plus custom categories. Parents come first in `sortOrder`, each followed by its subcategories.
* **Response**:
  ```json
  {
    "categories": [
      { "id": "food", "name": "Food & Drinks", "icon": "fork-knife", "color": "#F97316", "kind": "expense", "parentId": null, "isSystem": true, "isHidden": false, "sortOrder": 0 },
      { "id": "food.delivery", "name": "Food Delivery", "icon": "moped", "color": "#F97316", "kind": "expense", "parentId": "food", "isSystem": true, "isHidden": false, "sortOrder": 2 },
      { "id": "7f1c…", "name": "Tiffin", "icon": "fork-knife", "color": "#F97316", "kind": "expense", "parentId": "food", "isSystem": false, "isHidden": false, "sortOrder": 5 }
    ],
    "defaults": { "debit": "misc", "credit": "income" },
    "iconPalette": ["fork-knife", "moped", "…"],
    "colorPalette": ["#F97316", "…"]
  }
  ```

**Migration**: on every start the server runs an idempotent backfill (`CategoriesService.backfill`). It sets `categoryId` / `subcategoryId` on expenses and merchant rules that only have a legacy name, and converts legacy budget names to parent ids, merging budgets that land on the same parent. It keeps the same surviving row the app picks.

---

### 3.8. AI Assistant API (`/rag`)
Answers questions using the user's live financial records plus a curated knowledge base (Qdrant vector search). Conversations are saved so they can be reopened and so follow-up questions work.

**What the assistant sees about the user** (built fresh from Postgres on every question, `PersonalContextService`):
* Spending for the last 3 months: totals, top categories and their top subcategories.
* **Every open loan**, numbered `L1, L2, …`: counterparty, direction (you owe / owed to you), principal, total, interest rate, repayment date with days left or overdue, status, notes. Paid loans are counted.
* **Every investment**, numbered `I1, I2, …`: type, institution, monthly amount and installments paid so far (RD/SIP) or amount invested, rate, expected maturity value, start date, time to maturity.
* Account balances (name, type, last 4 digits, credit limit).
* At most 25 loans and 25 investments are listed individually; the rest are summarised. Deleted records are never included.

#### `POST /rag/ask`
* **Description**: Ask a question. Omit `conversationId` to start a new conversation; pass it to continue one. The server then sends the last 6 messages to the model and also uses the previous question for knowledge-base search.
* **Request Body** (`AskDto`):
  ```json
  {
    "question": "And what interest am I paying on it?",
    "conversationId": "3b1f…",        // Optional
    "categoryFilter": ["loans"]         // Optional knowledge-base filter
  }
  ```
* **Response**:
  ```json
  {
    "answer": "Your HDFC Personal Loan (L1) is at 11.5% p.a. …",
    "sources": [ { "docId": "…", "title": "Debt repayment strategies", "category": "loans", "score": 0.71 } ],
    "grounded": true,
    "conversationId": "3b1f…",
    "conversationTitle": "When is my HDFC loan due?",
    "userMessageId": "…",
    "messageId": "…"
  }
  ```
  Degraded answers (AI provider unavailable or quota reached) are returned but **not** saved, and then carry no new `conversationId`.

#### `GET /rag/conversations`
* **Description**: Saved conversations, most recent first. At most 100 are kept per user; older ones are removed.
* **Query Parameters**: `cursor` (Optional, the `nextCursor` of the previous page), `limit` (Optional, default 30, max 50)
* **Response**:
  ```json
  {
    "items": [
      { "id": "3b1f…", "title": "When is my HDFC loan due?", "lastMessageAt": "2026-10-01T09:30:00.000Z", "createdAt": "2026-10-01T09:29:00.000Z", "preview": "Your HDFC Personal Loan (L1) is due on…" }
    ],
    "nextCursor": null
  }
  ```

#### `GET /rag/conversations/:id/messages`
* **Description**: All messages of a conversation, oldest first.
* **Response**:
  ```json
  {
    "id": "3b1f…",
    "title": "When is my HDFC loan due?",
    "lastMessageAt": "2026-10-01T09:30:00.000Z",
    "messages": [
      { "id": "…", "role": "user", "content": "When is my HDFC loan due?", "sources": [], "grounded": false, "createdAt": "…" },
      { "id": "…", "role": "assistant", "content": "On 10 Oct 2026 (in 9 days)…", "sources": [], "grounded": true, "createdAt": "…" }
    ]
  }
  ```

#### `PATCH /rag/conversations/:id`
* **Description**: Rename a conversation.
* **Request Body**: `{ "title": "HDFC loan questions" }`
* **Response**: `{ "id": "3b1f…", "title": "HDFC loan questions" }`

#### `DELETE /rag/conversations/:id`
* **Description**: Permanently delete a conversation and its messages.
* **Response**: `204 No Content`

All `/rag/conversations` routes return `404` for unknown ids and `403` for another user's conversation.

---

## 4. Flutter Integration Code Snippets

Here is a complete setup code utilizing the `dio` package, showcasing automatic Bearer token injection.

### `lib/services/api_client.dart`
```dart
import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';

class ApiClient {
  late final Dio dio;

  // Replace with your local machine's IP address when running on physical devices
  static const String baseUrl = 'http://10.0.2.2:3000'; 

  ApiClient() {
    dio = Dio(
      BaseOptions(
        baseUrl: baseUrl,
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 10),
        contentType: Headers.jsonContentType,
      ),
    );

    // Apply Firebase Auth Token Interceptor
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          try {
            // Get Firebase ID Token (forceRefresh: false avoids unnecessary network requests)
            final token = await FirebaseAuth.instance.currentUser?.getIdToken(false);
            
            if (token != null) {
              options.headers['Authorization'] = 'Bearer $token';
            }
          } catch (e) {
            print('ApiClient Interceptor error: $e');
          }
          return handler.next(options);
        },
        onError: (DioException e, handler) {
          if (e.response?.statusCode == 401) {
            print('Authentication token was expired or missing.');
            // Handle global logout or token refresh if needed
          }
          return handler.next(e);
        },
      ),
    );
  }
}
```

### Sample Dart Data Model for Expense
```dart
import 'enums.dart';

class ExpenseModel {
  final String? id;
  final double amount;
  final String category;
  final String date;
  final String? note;
  final PaymentMethod method;
  final ExpenseSource source;
  final String? merchant;

  ExpenseModel({
    this.id,
    required this.amount,
    required this.category,
    required this.date,
    this.note,
    this.method = PaymentMethod.CASH,
    this.source = ExpenseSource.MANUAL,
    this.merchant,
  });

  factory ExpenseModel.fromJson(Map<String, dynamic> json) {
    return ExpenseModel(
      id: json['id'] as String?,
      amount: (json['amount'] as num).toDouble(),
      category: json['category'] as String,
      date: json['date'] as String,
      note: json['note'] as String?,
      method: PaymentMethod.fromJson(json['method'] as String? ?? 'CASH'),
      source: ExpenseSource.fromJson(json['source'] as String? ?? 'MANUAL'),
      merchant: json['merchant'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      if (id != null) 'id': id,
      'amount': amount,
      'category': category,
      'date': date,
      if (note != null) 'note': note,
      'method': method.toJson(),
      'source': source.toJson(),
      if (merchant != null) 'merchant': merchant,
    };
  }
}
```

### Usage Example
```dart
final client = ApiClient();

// Fetch summary of current month's expenses
Future<Map<String, dynamic>> fetchExpensesSummary() async {
  try {
    final response = await client.dio.get('/expenses/summary');
    return response.data;
  } on DioException catch (e) {
    print('Failed to get expenses: ${e.message}');
    rethrow;
  }
}

// Log a new expense
Future<ExpenseModel> addExpense(ExpenseModel newExpense) async {
  try {
    final response = await client.dio.post(
      '/expenses',
      data: newExpense.toJson(),
    );
    return ExpenseModel.fromJson(response.data);
  } on DioException catch (e) {
    print('Failed to add expense: ${e.message}');
    rethrow;
  }
}
```
