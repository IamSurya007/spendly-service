import { RagController } from './rag.controller';
import { ChatHistoryService } from './services/chat-history.service';

describe('RagController.ask', () => {
  const retrieval = { retrieve: jest.fn().mockResolvedValue([]) };
  const generation = { generate: jest.fn() };
  const chatHistory = {
    getOwned: jest.fn(),
    recentTurns: jest.fn(),
    appendExchange: jest.fn(),
  };
  const controller = new RagController(retrieval as any, generation as any, {} as any, chatHistory as any);
  const req = { user: { uid: 'user-1' } };

  beforeEach(() => jest.clearAllMocks());

  it('starts a new conversation and saves the exchange', async () => {
    generation.generate.mockResolvedValue({ answer: 'A', sources: [], grounded: true });
    chatHistory.appendExchange.mockResolvedValue({
      conversation: { id: 'conv-1', title: 'How much?' },
      userMessageId: 'm1',
      assistantMessageId: 'm2',
    });

    const res = await controller.ask({ question: 'How much?' }, req);

    expect(generation.generate).toHaveBeenCalledWith('How much?', [], 'user-1', []);
    expect(chatHistory.appendExchange).toHaveBeenCalledWith('user-1', null, 'How much?', {
      text: 'A',
      sources: [],
      grounded: true,
    });
    expect(res).toMatchObject({ conversationId: 'conv-1', messageId: 'm2', answer: 'A' });
    expect((res as any).fallback).toBeUndefined();
  });

  it('sends earlier turns for a follow-up and searches with the previous question', async () => {
    const conv = { id: 'conv-1' };
    chatHistory.getOwned.mockResolvedValue(conv);
    const history = [
      { role: 'user', content: 'When is my HDFC loan due?' },
      { role: 'assistant', content: 'On 10 Oct.' },
    ];
    chatHistory.recentTurns.mockResolvedValue(history);
    generation.generate.mockResolvedValue({ answer: 'B', sources: [], grounded: true });
    chatHistory.appendExchange.mockResolvedValue({ conversation: conv, userMessageId: 'm3', assistantMessageId: 'm4' });

    await controller.ask({ question: 'And the interest?', conversationId: 'conv-1' }, req);

    expect(chatHistory.getOwned).toHaveBeenCalledWith('user-1', 'conv-1');
    expect(retrieval.retrieve).toHaveBeenCalledWith('When is my HDFC loan due?\nAnd the interest?', undefined);
    expect(generation.generate).toHaveBeenCalledWith('And the interest?', [], 'user-1', history);
    expect(chatHistory.appendExchange).toHaveBeenCalledWith('user-1', conv, 'And the interest?', expect.anything());
  });

  it('does not store degraded fallback answers', async () => {
    generation.generate.mockResolvedValue({ answer: 'quota hit', sources: [], grounded: false, fallback: true });

    const res = await controller.ask({ question: 'How much?' }, req);

    expect(chatHistory.appendExchange).not.toHaveBeenCalled();
    expect(res.conversationId).toBeUndefined();
    expect((res as any).fallback).toBeUndefined();
  });
});

describe('ChatHistoryService.titleFrom', () => {
  it('uses the question, trimmed to 60 characters', () => {
    expect(ChatHistoryService.titleFrom('  How  much did I spend?  ')).toBe('How much did I spend?');
    const long = 'x'.repeat(100);
    expect(ChatHistoryService.titleFrom(long).length).toBe(58);
    expect(ChatHistoryService.titleFrom(long).endsWith('…')).toBe(true);
  });
});
