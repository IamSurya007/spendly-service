import { IsString, MinLength, MaxLength, IsOptional, IsArray, IsUUID } from 'class-validator';

export class AskDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  question: string;

  @IsOptional()
  @IsArray()
  categoryFilter?: string[]; // e.g. ["budgeting", "loans", "investments"]

  /**
   * Continue an existing conversation: its recent messages are sent to the
   * model so follow-up questions work. Omit to start a new conversation.
   */
  @IsOptional()
  @IsUUID()
  conversationId?: string;
}

export class SourceRef {
  docId: string;
  title: string;
  category: string;
  score: number;
}

export class AskResponseDto {
  answer: string;
  sources: SourceRef[];
  grounded: boolean; // false if we fell back to "insufficient context"
  /** Set when the exchange was saved to history. */
  conversationId?: string;
  conversationTitle?: string;
  userMessageId?: string;
  messageId?: string;
}

export class RenameConversationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;
}
