import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { ChatHistoryService } from './services/chat-history.service';
import { RenameConversationDto } from './dto/ask.dto';

/** Saved AI assistant conversations. New messages are added via POST /rag/ask. */
@ApiTags('rag')
@ApiBearerAuth('bearer')
@Controller('rag/conversations')
export class ChatHistoryController {
  constructor(private readonly chatHistory: ChatHistoryService) {}

  @Get()
  @ApiOperation({ summary: 'List conversations, most recent first' })
  async list(
    @CurrentUser('uid') userId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.chatHistory.list(userId, cursor, limit ? parseInt(limit, 10) || 30 : 30);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'All messages of a conversation, oldest first' })
  async messages(@CurrentUser('uid') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.chatHistory.getMessages(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a conversation' })
  async rename(
    @CurrentUser('uid') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameConversationDto,
  ) {
    return this.chatHistory.rename(userId, id, dto.title);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a conversation and its messages' })
  async remove(@CurrentUser('uid') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.chatHistory.remove(userId, id);
  }
}
