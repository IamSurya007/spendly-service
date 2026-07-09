export enum PaymentMethod {
  CASH = 'CASH',
  UPI = 'UPI',
  CARD = 'CARD',
  NET_BANKING = 'NET_BANKING',
  CHEQUE = 'CHEQUE',
}

export enum ExpenseSource {
  MANUAL = 'MANUAL',
  SMS = 'SMS',
  OCR = 'OCR',
}

export enum LoanType {
  TAKEN = 'TAKEN',
  GIVEN = 'GIVEN',
}

export enum LoanStatus {
  ACTIVE = 'ACTIVE',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  PARTIAL = 'PARTIAL',
}

export enum InvestmentType {
  RD = 'RD',
  SIP = 'SIP',
  MF = 'MF',
  FD = 'FD',
  PPF = 'PPF',
  OTHER = 'OTHER',
}
