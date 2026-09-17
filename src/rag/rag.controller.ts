import { Body, Controller, Post, UseGuards, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AskDto, AskResponseDto } from './dto/ask.dto';
import { IngestDocumentDto } from './dto/ingest-document.dto';
import { RetrievalService } from './services/retrieval.service';
import { GenerationService } from './services/generation.service';
import { IngestionService } from './services/ingestion.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('rag')
export class RagController {
  constructor(
    private readonly retrieval: RetrievalService,
    private readonly generation: GenerationService,
    private readonly ingestion: IngestionService,
  ) {}

  @Post('ask')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async ask(@Body() dto: AskDto, @Req() req: any): Promise<AskResponseDto> {
    const userId = req.user?.uid || req.user?.id;
    const hits = await this.retrieval.retrieve(dto.question, dto.categoryFilter);
    return this.generation.generate(dto.question, hits, userId);
  }

  @Post('ingest')
  @UseGuards(AuthGuard)
  async ingest(@Body() dto: IngestDocumentDto) {
    return this.ingestion.ingest(dto);
  }
}
