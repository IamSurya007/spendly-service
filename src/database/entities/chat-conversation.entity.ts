import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn, Index, BeforeInsert } from 'typeorm';
import { User } from './user.entity';
import { ChatMessage } from './chat-message.entity';
import { randomUUID } from 'crypto';

/** One AI assistant chat thread. */
@Entity('chat_conversations')
@Index(['userId', 'lastMessageAt'])
export class ChatConversation {
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

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'timestamp with time zone' })
  lastMessageAt: Date;

  @Column({ type: 'boolean', default: false })
  isDeleted: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @OneToMany(() => ChatMessage, (m) => m.conversation)
  messages: ChatMessage[];
}
