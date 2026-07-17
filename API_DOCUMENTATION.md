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
      { "category": "Food", "limit": 5000 },
      { "category": "Rent", "limit": 15000 },
      { "category": "Entertainment", "limit": 2000 }
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
* **Description**: Get the progress of category limits vs. actual expenses for the month.
* **URL Parameter**: `month` (`YYYY-MM`)
* **Response**:
  ```json
  {
    "month": "2026-07",
    "budgets": [
      {
        "category": "Food",
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
    "category": "Food",
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
  * `category` (Optional, string)
  * `source` (Optional, enum: `MANUAL`, `SMS`, `OCR`)
  * `limit` (Optional, number, default: 50)
  * `cursor` (Optional, string representing the ID of the last expense in the previous page for cursor pagination)
* **Response**: List of expense objects ordered by date (descending).

#### `GET /expenses/summary`
* **Description**: Get total expenses, total income (default 0), net balance, and categories breakdown for a month.
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
        "category": "Food",
        "total": 4250.50,
        "count": 12
      },
      {
        "category": "Rent",
        "total": 14000.00,
        "count": 1
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
* **Description**: Delete an expense.
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
    "interestRate": 7.1,           // Optional (default: 6.5)
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
* **Description**: Delete an investment record.
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
* **Description**: Delete a loan record.
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
