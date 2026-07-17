import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { Expense } from './expense.entity';
import { Budget } from './budget.entity';
import { Loan } from './loan.entity';
import { Investment } from './investment.entity';
import { CategoryRule } from './category-rule.entity';

@Entity('users')
export class User {
  @PrimaryColumn()
  id: string; // Firebase UID

  @Column({ unique: true })
  email: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', nullable: true })
  photoUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  fcmToken: string | null;

  @Column({ default: false })
  sheetsConnected: boolean;

  @Column({ type: 'varchar', nullable: true })
  sheetsId: string | null;

  @Column({ type: 'text', nullable: true })
  sheetsToken: string | null; // Encrypted OAuth token

  @Column({ type: 'timestamp with time zone', nullable: true })
  lastSyncedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Expense, (expense) => expense.user, { cascade: true })
  expenses: Expense[];

  @OneToMany(() => Budget, (budget) => budget.user, { cascade: true })
  budgets: Budget[];

  @OneToMany(() => Loan, (loan) => loan.user, { cascade: true })
  loans: Loan[];

  @OneToMany(() => Investment, (investment) => investment.user, { cascade: true })
  investments: Investment[];

  @OneToMany(() => CategoryRule, (rule) => rule.user, { cascade: true })
  categoryRules: CategoryRule[];
}
