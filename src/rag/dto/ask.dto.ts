import { IsString, MinLength, MaxLength, IsOptional, IsArray } from 'class-validator';

export class AskDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  question: string;

  @IsOptional()
  @IsArray()
  categoryFilter?: string[]; // e.g. ["budgeting", "loans", "investments"]
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
}
