import { Entity, PrimaryColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index, BeforeInsert } from 'typeorm';
import { ChatConversation } from './chat-conversation.entity';
import { randomUUID } from 'crypto';

export type ChatRole = 'user' | 'assistant';

/** A single question or answer in a [ChatConversation]. */
@Entity('chat_messages')
@Index(['conversationId', 'createdAt'])
export class ChatMessage {
  @PrimaryColumn('varchar')
  id: string;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = randomUUID();
    }
  }

  @Column()
  conversationId: string;

  /** Denormalised for ownership checks without a join. */
  @Column()
  @Index()
  userId: string;

  @Column({ type: 'varchar', length: 16 })
  role: ChatRole;

  @Column({ type: 'text' })
  content: string;

  /** Knowledge-base sources cited by an assistant answer. */
  @Column({ type: 'jsonb', nullable: true })
  sources: { docId: string; title: string; category: string; score: number }[] | null;

  @Column({ type: 'boolean', default: false })
  grounded: boolean;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;

  @ManyToOne(() => ChatConversation, (c) => c.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversationId' })
  conversation: ChatConversation;
}
