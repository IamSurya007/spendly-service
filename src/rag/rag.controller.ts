import { Body, Controller, Post, UseGuards, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AskDto, AskResponseDto } from './dto/ask.dto';
import { IngestDocumentDto } from './dto/ingest-document.dto';
import { RetrievalService } from './services/retrieval.service';
import { GenerationService } from './services/generation.service';
import { IngestionService } from './services/ingestion.service';
import { ChatHistoryService } from './services/chat-history.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('rag')
export class RagController {
  constructor(
    private readonly retrieval: RetrievalService,
    private readonly generation: GenerationService,
    private readonly ingestion: IngestionService,
    private readonly chatHistory: ChatHistoryService,
  ) {}

  @Post('ask')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async ask(@Body() dto: AskDto, @Req() req: any): Promise<AskResponseDto> {
    const userId: string = req.user?.uid || req.user?.id;

    const conversation = dto.conversationId
      ? await this.chatHistory.getOwned(userId, dto.conversationId)
      : null;
    const history = conversation ? await this.chatHistory.recentTurns(conversation.id) : [];

    // A follow-up like "and the second one?" retrieves nothing on its own;
    // include the previous question in the knowledge-base search.
    const lastUserQuestion = [...history].reverse().find((t) => t.role === 'user')?.content;
    const searchQuery = lastUserQuestion ? `${lastUserQuestion}\n${dto.question}` : dto.question;

    const hits = await this.retrieval.retrieve(searchQuery, dto.categoryFilter);
    const { fallback, ...response } = await this.generation.generate(dto.question, hits, userId, history);

    // Degraded answers (AI provider down, quota hit) are not kept in history.
    if (fallback || !userId) {
      return { ...response, conversationId: conversation?.id };
    }

    const saved = await this.chatHistory.appendExchange(userId, conversation, dto.question, {
      text: response.answer,
      sources: response.sources,
      grounded: response.grounded,
    });
    return {
      ...response,
      conversationId: saved.conversation.id,
      conversationTitle: saved.conversation.title,
      userMessageId: saved.userMessageId,
      messageId: saved.assistantMessageId,
    };
  }

  @Post('ingest')
  @UseGuards(AuthGuard)
  async ingest(@Body() dto: IngestDocumentDto) {
    return this.ingestion.ingest(dto);
  }
}
