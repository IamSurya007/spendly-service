import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { User } from '../database/entities/user.entity';
import { Expense } from '../database/entities/expense.entity';
import { Loan } from '../database/entities/loan.entity';
import { Investment } from '../database/entities/investment.entity';
import { encrypt, decrypt } from '../utils/crypto';
import { ConnectSheetsDto } from './dto/connect-sheets.dto';

@Injectable()
export class SheetsService {
  private readonly logger = new Logger(SheetsService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Expense)
    private readonly expensesRepository: Repository<Expense>,
    @InjectRepository(Loan)
    private readonly loansRepository: Repository<Loan>,
    @InjectRepository(Investment)
    private readonly investmentsRepository: Repository<Investment>,
    private readonly config: ConfigService,
  ) {}

  private getCryptoSecret(): string {
    return this.config.get<string>('FIREBASE_PROJECT_ID') || 'default-spendly-secret-key';
  }

  async connect(userId: string, dto: ConnectSheetsDto): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const secret = this.getCryptoSecret();
    const encryptedToken = encrypt(dto.sheetsToken, secret);

    user.sheetsConnected = true;
    user.sheetsId = dto.sheetsId;
    user.sheetsToken = encryptedToken;

    return this.usersRepository.save(user);
  }

  async disconnect(userId: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    user.sheetsConnected = false;
    user.sheetsId = null;
    user.sheetsToken = null;

    return this.usersRepository.save(user);
  }

  async getStatus(userId: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    return {
      connected: user.sheetsConnected,
      sheetsId: user.sheetsId,
      lastSyncedAt: user.lastSyncedAt,
    };
  }

  private async refreshAccessToken(refreshToken: string): Promise<string> {
    const clientId = this.config.get<string>('GOOGLE_SHEETS_CLIENT_ID');
    const clientSecret = this.config.get<string>('GOOGLE_SHEETS_CLIENT_SECRET');

    try {
      const response = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      });

      return response.data.access_token;
    } catch (error) {
      this.logger.error(`Failed to refresh Google OAuth token: ${error.response?.data?.error || error.message}`);
      throw new BadRequestException('Google Sheets authorization failed (unable to refresh token)');
    }
  }

  async sync(userId: string): Promise<void> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user || !user.sheetsConnected || !user.sheetsId || !user.sheetsToken) {
      throw new BadRequestException('Google Sheets not connected');
    }

    const secret = this.getCryptoSecret();
    const decryptedToken = decrypt(user.sheetsToken, secret);
    
    // Refresh token to get active access token
    const accessToken = await this.refreshAccessToken(decryptedToken);
    const spreadsheetId = user.sheetsId;

    // Fetch user data
    const expenses = await this.expensesRepository.find({
      where: { userId },
      order: { date: 'DESC' },
    });

    const loans = await this.loansRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    const investments = await this.investmentsRepository.find({
      where: { userId },
      order: { startDate: 'DESC' },
    });

    // Ensure required tabs exist
    await this.ensureSheetTabsExist(spreadsheetId, accessToken);

    // Prepare tab data
    const expensesData = [
      ['Date', 'Category', 'Amount', 'Note', 'Method', 'Merchant'],
      ...expenses.map(e => [
        e.date.toISOString().substring(0, 10),
        e.category,
        e.amount,
        e.note || '',
        e.method,
        e.merchant || '',
      ]),
    ];

    const loansData = [
      ['Type', 'Name', 'Principal', 'Total', 'Repayment Date', 'Status'],
      ...loans.map(l => [
        l.type,
        l.name,
        l.principal,
        l.total,
        l.repaymentDate ? l.repaymentDate.toISOString().substring(0, 10) : '',
        l.status,
      ]),
    ];

    const investmentsData = [
      ['Name', 'Type', 'Monthly Amount', 'Principal', 'Maturity Amount', 'Duration', 'Maturity Date', 'Institution'],
      ...investments.map(i => [
        i.name,
        i.type,
        i.monthlyAmount,
        i.principal,
        i.maturityAmount,
        i.durationMonths,
        i.maturityDate.toISOString().substring(0, 10),
        i.institution || '',
      ]),
    ];

    const summaryData = await this.getSummaryData(userId);

    // Clear worksheets
    await axios.post(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchClear`,
      {
        ranges: [
          'Expenses!A1:Z10000',
          'Loans!A1:Z10000',
          'Investments!A1:Z10000',
          'Summary!A1:Z10000',
        ],
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    // Batch update new data
    await axios.post(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
      {
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: 'Expenses!A1', values: expensesData },
          { range: 'Loans!A1', values: loansData },
          { range: 'Investments!A1', values: investmentsData },
          { range: 'Summary!A1', values: summaryData },
        ],
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    user.lastSyncedAt = new Date();
    await this.usersRepository.save(user);
  }

  private async ensureSheetTabsExist(spreadsheetId: string, accessToken: string): Promise<void> {
    try {
      const response = await axios.get(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      const existingSheets = response.data.sheets.map((s: any) => s.properties.title);
      const requiredSheets = ['Expenses', 'Loans', 'Investments', 'Summary'];
      const requests: any[] = [];

      for (const sheet of requiredSheets) {
        if (!existingSheets.includes(sheet)) {
          requests.push({
            addSheet: {
              properties: { title: sheet },
            },
          });
        }
      }

      if (requests.length > 0) {
        await axios.post(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
          { requests },
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
      }
    } catch (error) {
      this.logger.error(`Failed to verify or create sheet tabs: ${error.response?.data?.error || error.message}`);
      throw new BadRequestException('Google Sheets tab verification failed');
    }
  }

  private async getSummaryData(userId: string): Promise<any[][]> {
    const today = new Date();
    const summaryRows: any[][] = [['Month', 'Income', 'Expenses', 'Balance']];

    // Compute last 12 months summary
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const monthStr = d.toISOString().substring(0, 7); // "YYYY-MM"

      const startDate = new Date(d.getFullYear(), d.getMonth(), 1);
      const endDate = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

      const expenses = await this.expensesRepository.find({
        where: {
          userId,
          date: Between(startDate, endDate),
        },
      });

      const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
      const totalIncome = 0; // default as there's no Income table
      const balance = totalIncome - totalExpenses;

      summaryRows.push([monthStr, totalIncome, totalExpenses, balance]);
    }

    return summaryRows;
  }
}
