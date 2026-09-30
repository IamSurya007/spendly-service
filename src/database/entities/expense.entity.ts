import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index, BeforeInsert } from 'typeorm';
import { User } from './user.entity';
import { PaymentMethod, ExpenseSource } from '../enums';
import { randomUUID } from 'crypto';

@Entity('expenses')
@Index(['userId', 'date'])
@Index(['userId', 'category'])
export class Expense {
  @PrimaryColumn('varchar')
  id: string;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = randomUUID();
    }
  }

  @Column()
  userId: string;

  @Column('float')
  amount: number;

  /** Display name of the parent category (kept for older clients / Sheets). */
  @Column()
  category: string;

  /** Parent category id, e.g. `food` (see src/categories/taxonomy.generated.ts). */
  @Column({ type: 'varchar', nullable: true })
  @Index()
  categoryId: string | null;

  /** Subcategory id, e.g. `food.delivery`. */
  @Column({ type: 'varchar', nullable: true })
  subcategoryId: string | null;

  /** Display name of the subcategory. */
  @Column({ type: 'varchar', nullable: true })
  subcategory: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'timestamp with time zone' })
  date: Date;

  @Column({
    type: 'varchar',
    default: PaymentMethod.UPI,
  })
  method: PaymentMethod;

  @Column({
    type: 'varchar',
    default: ExpenseSource.MANUAL,
  })
  source: ExpenseSource;

  @Column({ type: 'varchar', nullable: true })
  merchant: string | null;

  @Column({ type: 'varchar', default: 'default_bank' })
  @Index()
  accountId: string;

  @Column({ type: 'boolean', default: true })
  isCountedAsSpend: boolean;

  @Column({ type: 'varchar', nullable: true })
  @Index()
  clientId: string | null;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ type: 'boolean', default: false })
  isDeleted: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => User, (user) => user.expenses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
