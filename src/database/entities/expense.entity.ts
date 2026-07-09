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

  @Column()
  category: string;

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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => User, (user) => user.expenses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
