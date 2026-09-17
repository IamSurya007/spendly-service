import { Injectable } from '@nestjs/common';

export interface Chunk {
  text: string;
  chunkIndex: number;
}

const TARGET_CHUNK_WORDS = 220; // ≈ 300 tokens, a good recall/precision tradeoff for short-answer RAG
const OVERLAP_WORDS = 40; // preserves context across a chunk boundary mid-explanation

@Injectable()
export class ChunkingService {
  /**
   * Splits on paragraph boundaries first (curated docs are structured markdown),
   * then packs paragraphs into ~TARGET_CHUNK_WORDS chunks with a sliding overlap
   * so a sentence split across chunks isn't lost to either one.
   */
  chunk(content: string): Chunk[] {
    const paragraphs = content
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);

    const chunks: Chunk[] = [];
    let buffer: string[] = [];
    let wordCount = 0;

    const flush = () => {
      if (buffer.length === 0) return;
      chunks.push({ text: buffer.join('\n\n'), chunkIndex: chunks.length });
    };

    for (const para of paragraphs) {
      const paraWords = para.split(/\s+/).length;

      if (wordCount + paraWords > TARGET_CHUNK_WORDS && buffer.length > 0) {
        flush();
        // carry the tail of the previous buffer forward as overlap
        const carry = buffer.join(' ').split(/\s+/).slice(-OVERLAP_WORDS).join(' ');
        buffer = carry ? [carry] : [];
        wordCount = carry ? carry.split(/\s+/).length : 0;
      }

      buffer.push(para);
      wordCount += paraWords;
    }
    flush();

    return chunks;
  }
}
