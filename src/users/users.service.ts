import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../database/entities/user.entity';
import { Expense } from '../database/entities/expense.entity';
import { Budget } from '../database/entities/budget.entity';
import { Loan } from '../database/entities/loan.entity';
import { Investment } from '../database/entities/investment.entity';
import { UpsertUserDto } from './dto/upsert-user.dto';
import * as admin from 'firebase-admin';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Expense)
    private expensesRepository: Repository<Expense>,
    @InjectRepository(Budget)
    private budgetsRepository: Repository<Budget>,
    @InjectRepository(Loan)
    private loansRepository: Repository<Loan>,
    @InjectRepository(Investment)
    private investmentsRepository: Repository<Investment>,
  ) {}

  async upsert(id: string, dto: UpsertUserDto): Promise<User> {
    let user = await this.usersRepository.findOne({ where: { id } });
    if (user) {
      user.name = dto.name;
      user.email = dto.email;
      if (dto.photoUrl !== undefined) {
        user.photoUrl = dto.photoUrl;
      }
    } else {
      user = this.usersRepository.create({
        id,
        name: dto.name,
        email: dto.email,
        photoUrl: dto.photoUrl,
      });
    }
    return this.usersRepository.save(user);
  }

  async findOrCreateFromFirebase(decodedToken: any): Promise<User> {
    const { uid, email, name, picture } = decodedToken;

    // 1. Try to find the user
    let user = await this.usersRepository.findOne({ where: { id: uid } });
    if (user) {
      return user;
    }

    // 2. If not found, create a new user profile
    const newUser = this.usersRepository.create({
      id: uid,
      name: name || email?.split('@')[0] || 'Firebase User',
      email: email || `${uid}@firebase.com`,
      photoUrl: picture || null,
    });

    try {
      return await this.usersRepository.save(newUser);
    } catch (err: any) {
      // Handle Postgres unique constraint / duplicate key violation (code 23505)
      if (
        err.code === '23505' ||
        err.message?.includes('duplicate key') ||
        err.message?.includes('unique constraint')
      ) {
        const existingUser = await this.usersRepository.findOne({ where: { id: uid } });
        if (existingUser) {
          return existingUser;
        }
      }
      throw err;
    }
  }

  async findOne(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async updateFcm(id: string, fcmToken: string): Promise<User> {
    const user = await this.findOne(id);
    user.fcmToken = fcmToken;
    return this.usersRepository.save(user);
  }

  async delete(id: string): Promise<void> {
    const user = await this.findOne(id);
    await this.usersRepository.remove(user);
  }

  private async getFirestoreCollection(collectionName: string, userId: string): Promise<any[]> {
    const db = admin.firestore();
    const list: any[] = [];

    // 1. Try Subcollection structure: users/{userId}/{collectionName}
    try {
      const subColRef = db.collection('users').doc(userId).collection(collectionName);
      const subSnapshot = await subColRef.get();
      subSnapshot.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() });
      });
    } catch (e) {
      console.warn(`Failed to read subcollection ${collectionName} for user ${userId}:`, e.message);
    }

    // 2. Try Root Collection structure: {collectionName} where userId == {userId}
    if (list.length === 0) {
      try {
        const rootColRef = db.collection(collectionName).where('userId', '==', userId);
        const rootSnapshot = await rootColRef.get();
        rootSnapshot.forEach(doc => {
          list.push({ id: doc.id, ...doc.data() });
        });
      } catch (e) {
        console.warn(`Failed to read root collection ${collectionName} for user ${userId}:`, e.message);
      }
    }

    return list;
  }

  async migrateFirestore(userId: string): Promise<any> {
    // 1. Ensure user profile exists in PostgreSQL
    let userObj = await this.usersRepository.findOne({ where: { id: userId } });
    if (!userObj) {
      try {
        const decodedUser = await admin.auth().getUser(userId);
        userObj = this.usersRepository.create({
          id: userId,
          name: decodedUser.displayName || 'Firebase User',
          email: decodedUser.email || 'user@firebase.com',
          photoUrl: decodedUser.photoURL || null,
        });
        await this.usersRepository.save(userObj);
      } catch (authError) {
        userObj = this.usersRepository.create({
          id: userId,
          name: 'Migrated User',
          email: 'user@migrated.com',
        });
        await this.usersRepository.save(userObj);
      }
    }

    // 2. Migrate Expenses
    const firestoreExpenses = await this.getFirestoreCollection('expenses', userId);
    const expensesToSave: Expense[] = [];
    for (const fe of firestoreExpenses) {
      const parseDate = (val: any): Date => {
        if (!val) return new Date();
        if (val.toDate && typeof val.toDate === 'function') return val.toDate();
        return new Date(val);
      };

      const expense = this.expensesRepository.create({
        id: fe.id || undefined,
        userId,
        amount: parseFloat(fe.amount) || 0,
        category: fe.category || 'Other',
        note: fe.note || fe.notes || null,
        date: parseDate(fe.date || fe.createdAt),
        method: fe.method ? fe.method.toUpperCase() : 'UPI',
        source: fe.source ? fe.source.toUpperCase() : 'MANUAL',
        merchant: fe.merchant || null,
      });
      expensesToSave.push(expense);
    }
    if (expensesToSave.length > 0) {
      await this.expensesRepository.save(expensesToSave);
    }

    // 3. Migrate Budgets
    const firestoreBudgets = await this.getFirestoreCollection('budgets', userId);
    const budgetsToSave: Budget[] = [];
    for (const fb of firestoreBudgets) {
      const budget = this.budgetsRepository.create({
        id: fb.id || undefined,
        userId,
        month: fb.month || new Date().toISOString().substring(0, 7),
        category: fb.category || 'Other',
        limit: parseFloat(fb.limit) || 0,
      });
      budgetsToSave.push(budget);
    }
    for (const b of budgetsToSave) {
      try {
        await this.budgetsRepository.save(b);
      } catch (e) {
        // ignore duplicate category limit errors during migration
      }
    }

    // 4. Migrate Loans
    const firestoreLoans = await this.getFirestoreCollection('loans', userId);
    const loansToSave: Loan[] = [];
    for (const fl of firestoreLoans) {
      const parseDate = (val: any): Date | null => {
        if (!val) return null;
        if (val.toDate && typeof val.toDate === 'function') return val.toDate();
        return new Date(val);
      };

      const loan = this.loansRepository.create({
        id: fl.id || undefined,
        userId,
        type: fl.type ? fl.type.toUpperCase() : 'TAKEN',
        name: fl.name || 'Friend',
        principal: parseFloat(fl.principal) || 0,
        total: parseFloat(fl.total) || 0,
        repaymentDate: parseDate(fl.repaymentDate),
        status: fl.status ? fl.status.toUpperCase() : 'ACTIVE',
        notes: fl.notes || null,
        reminderSent: !!fl.reminderSent,
      });
      loansToSave.push(loan);
    }
    if (loansToSave.length > 0) {
      await this.loansRepository.save(loansToSave);
    }

    // 5. Migrate Investments
    const firestoreInvestments = await this.getFirestoreCollection('investments', userId);
    const investmentsToSave: Investment[] = [];
    for (const fi of firestoreInvestments) {
      const parseDate = (val: any): Date => {
        if (!val) return new Date();
        if (val.toDate && typeof val.toDate === 'function') return val.toDate();
        return new Date(val);
      };

      const investment = this.investmentsRepository.create({
        id: fi.id || undefined,
        userId,
        type: fi.type ? fi.type.toUpperCase() : 'RD',
        name: fi.name || 'Investment',
        monthlyAmount: parseFloat(fi.monthlyAmount) || 0,
        principal: parseFloat(fi.principal) || 0,
        maturityAmount: parseFloat(fi.maturityAmount) || 0,
        durationMonths: parseInt(fi.durationMonths, 10) || 12,
        startDate: parseDate(fi.startDate),
        maturityDate: parseDate(fi.maturityDate),
        institution: fi.institution || null,
      });
      investmentsToSave.push(investment);
    }
    if (investmentsToSave.length > 0) {
      await this.investmentsRepository.save(investmentsToSave);
    }

    return {
      success: true,
      migrated: {
        expenses: expensesToSave.length,
        budgets: budgetsToSave.length,
        loans: loansToSave.length,
        investments: investmentsToSave.length,
      },
    };
  }
}
