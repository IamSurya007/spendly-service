import { IsString, IsIn, MinLength } from 'class-validator';

export class IngestDocumentDto {
  @IsString()
  @MinLength(1)
  title: string;

  @IsString()
  @IsIn(['budgeting', 'loans', 'investments', 'general'])
  category: string;

  @IsString()
  @MinLength(20)
  content: string; // markdown or plain text of the curated doc

  @IsString()
  sourceId: string; // stable id you control, e.g. "budgeting-101" — used for re-ingestion/versioning
}
