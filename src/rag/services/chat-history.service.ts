import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { ChatConversation } from '../../database/entities/chat-conversation.entity';
import { ChatMessage, ChatRole } from '../../database/entities/chat-message.entity';
import { SourceRef } from '../dto/ask.dto';

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

/** Messages of history sent to the model with a follow-up question. */
export const HISTORY_TURNS = 6;
/** Oldest conversations beyond this are removed. */
export const MAX_CONVERSATIONS_PER_USER = 100;

@Injectable()
export class ChatHistoryService {
  constructor(
    @InjectRepository(ChatConversation)
    private readonly conversations: Repository<ChatConversation>,
    @InjectRepository(ChatMessage)
    private readonly messages: Repository<ChatMessage>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async getOwned(userId: string, id: string): Promise<ChatConversation> {
    const conversation = await this.conversations.findOne({ where: { id } });
    if (!conversation || conversation.isDeleted) {
      throw new NotFoundException('Conversation not found');
    }
    if (conversation.userId !== userId) {
      throw new ForbiddenException("You cannot access another user's conversation");
    }
    return conversation;
  }

  /** The last [limit] messages, oldest first. */
  async recentTurns(conversationId: string, limit = HISTORY_TURNS): Promise<ChatTurn[]> {
    const rows = await this.messages.find({
      where: { conversationId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return rows.reverse().map((m) => ({ role: m.role, content: m.content }));
  }

  /**
   * Stores a question and its answer. Creates the conversation (titled after
   * the first question) when [conversation] is null.
   */
  async appendExchange(
    userId: string,
    conversation: ChatConversation | null,
    question: string,
    answer: { text: string; sources: SourceRef[]; grounded: boolean },
  ): Promise<{ conversation: ChatConversation; userMessageId: string; assistantMessageId: string }> {
    const result = await this.dataSource.transaction(async (manager) => {
      const now = new Date();
      let conv = conversation;
      if (!conv) {
        conv = manager.create(ChatConversation, {
          userId,
          title: ChatHistoryService.titleFrom(question),
          lastMessageAt: now,
        });
      }
      conv.lastMessageAt = now;
      conv = await manager.save(conv);

      const userMsg = await manager.save(
        manager.create(ChatMessage, {
          conversationId: conv.id,
          userId,
          role: 'user' as ChatRole,
          content: question,
          grounded: false,
          createdAt: now,
        }),
      );
      // One millisecond later so ordering by createdAt is stable.
      const assistantMsg = await manager.save(
        manager.create(ChatMessage, {
          conversationId: conv.id,
          userId,
          role: 'assistant' as ChatRole,
          content: answer.text,
          sources: answer.sources,
          grounded: answer.grounded,
          createdAt: new Date(now.getTime() + 1),
        }),
      );
      return { conversation: conv, userMessageId: userMsg.id, assistantMessageId: assistantMsg.id };
    });

    if (!conversation) {
      await this.pruneOldConversations(userId);
    }
    return result;
  }

  static titleFrom(question: string): string {
    const clean = question.replace(/\s+/g, ' ').trim();
    return clean.length <= 60 ? clean : `${clean.slice(0, 57).trimEnd()}…`;
  }

  async list(userId: string, cursor?: string, limit = 30) {
    const take = Math.min(Math.max(limit, 1), 50);
    const where: any = { userId, isDeleted: false };
    if (cursor) {
      const before = new Date(cursor);
      if (!isNaN(before.getTime())) where.lastMessageAt = LessThan(before);
    }
    const rows = await this.conversations.find({
      where,
      order: { lastMessageAt: 'DESC' },
      take: take + 1,
    });
    const page = rows.slice(0, take);

    // Last message of each conversation, for a one-line preview.
    const previews = new Map<string, string>();
    if (page.length > 0) {
      const latest: { conversationId: string; content: string }[] = await this.messages
        .createQueryBuilder('m')
        .select(['m.conversationId AS "conversationId"', 'm.content AS "content"'])
        .distinctOn(['m.conversationId'])
        .where('m.conversationId IN (:...ids)', { ids: page.map((c) => c.id) })
        .orderBy('m.conversationId')
        .addOrderBy('m.createdAt', 'DESC')
        .getRawMany();
      for (const row of latest) previews.set(row.conversationId, row.content);
    }

    return {
      items: page.map((c) => ({
        id: c.id,
        title: c.title,
        lastMessageAt: c.lastMessageAt.toISOString(),
        createdAt: c.createdAt.toISOString(),
        preview: (previews.get(c.id) ?? '').replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120),
      })),
      nextCursor: rows.length > take ? page[page.length - 1].lastMessageAt.toISOString() : null,
    };
  }

  async getMessages(userId: string, id: string) {
    const conversation = await this.getOwned(userId, id);
    const rows = await this.messages.find({
      where: { conversationId: id },
      order: { createdAt: 'ASC' },
    });
    return {
      id: conversation.id,
      title: conversation.title,
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      messages: rows.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        sources: m.sources ?? [],
        grounded: m.grounded,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async rename(userId: string, id: string, title: string) {
    const conversation = await this.getOwned(userId, id);
    conversation.title = ChatHistoryService.titleFrom(title) || conversation.title;
    await this.conversations.save(conversation);
    return { id: conversation.id, title: conversation.title };
  }

  async remove(userId: string, id: string): Promise<void> {
    const conversation = await this.getOwned(userId, id);
    // Messages go with the conversation (ON DELETE CASCADE); nothing to sync.
    await this.conversations.remove(conversation);
  }

  private async pruneOldConversations(userId: string) {
    const stale = await this.conversations.find({
      where: { userId },
      order: { lastMessageAt: 'DESC' },
      skip: MAX_CONVERSATIONS_PER_USER,
      take: 50,
      select: { id: true },
    });
    if (stale.length > 0) {
      await this.conversations.delete(stale.map((c) => c.id));
    }
  }
}
