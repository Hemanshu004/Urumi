import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import Chat from './Chat';
import { api } from '../services/api';
import { ChatContext, type Conversation } from '../context/ChatContext';

vi.mock('../services/api', () => ({
  api: {
    chat: vi.fn(),
  }
}));

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

describe('Chat Component Regression Tests', () => {
  let mockConversations: Conversation[];
  let activeId: string;
  let addMessageMock: any;
  let createConversationMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConversations = [
      {
        id: 'conv-1',
        title: 'New Chat',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: []
      }
    ];
    activeId = 'conv-1';
    addMessageMock = vi.fn((convId: string, msg: any) => {
      const conv = mockConversations.find(c => c.id === convId);
      if (conv) {
        conv.messages.push(msg);
      }
    });
    createConversationMock = vi.fn(() => 'conv-1');
  });

  afterEach(() => {
    cleanup();
  });

  const renderChat = (conversations = mockConversations, activeConversationId = activeId) => {
    const activeConv = conversations.find(c => c.id === activeConversationId) || null;
    return render(
      <ChatContext.Provider
        value={{
          conversations,
          activeConversationId,
          activeConversation: activeConv,
          setActiveConversationId: vi.fn(),
          createConversation: createConversationMock,
          addMessage: addMessageMock,
          renameConversation: vi.fn(),
          deleteConversation: vi.fn(),
        }}
      >
        <Chat />
      </ChatContext.Provider>
    );
  };

  it('renders all four suggested prompt buttons on empty chat', () => {
    renderChat();

    expect(screen.getByText('Show me my previous orders')).toBeDefined();
    expect(screen.getByText('List my WooCommerce products')).toBeDefined();
    expect(screen.getByText("What's the weather in Ahmedabad?")).toBeDefined();
    expect(screen.getByText('Show open GitHub issues')).toBeDefined();
  });

  it('clicking a suggested prompt immediately submits the exact prompt to api.chat without polluting input', async () => {
    (api.chat as any).mockResolvedValueOnce({
      message: 'Here are the products.',
      toolCalls: [
        {
          tool: 'woocommerce__list_products',
          status: 'success',
          durationMs: 120,
          args: {},
          result: [{ id: 1, name: 'Product A' }]
        }
      ]
    });

    renderChat();

    const promptBtn = screen.getByText('List my WooCommerce products');
    fireEvent.click(promptBtn);

    // Verify api.chat was called with exact prompt
    await waitFor(() => {
      expect(api.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'List my WooCommerce products',
          conversationHistory: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'List my WooCommerce products' })
          ])
        })
      );
    });

    // Verify input textarea remains empty
    const textarea = screen.getByPlaceholderText('Ask Urumi Agent anything...') as HTMLTextAreaElement;
    expect(textarea.value).toBe('');

    // Verify message added to conversation
    expect(addMessageMock).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      role: 'user',
      content: 'List my WooCommerce products'
    }));
  });

  it('sending "hiii how are you" produces a conversational response without product tools', async () => {
    (api.chat as any).mockResolvedValueOnce({
      message: "I'm doing well, thank you! How can I assist you today?",
      toolCalls: []
    });

    renderChat();

    const textarea = screen.getByPlaceholderText('Ask Urumi Agent anything...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hiii how are you' } });

    fireEvent.submit(textarea.closest('form')!);

    await waitFor(() => {
      expect(api.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'hiii how are you',
        })
      );
    });

    await waitFor(() => {
      expect(addMessageMock).toHaveBeenCalledWith('conv-1', expect.objectContaining({
        role: 'assistant',
        content: "I'm doing well, thank you! How can I assist you today?",
        toolCalls: []
      }));
    });
  });

  it('consecutive prompts send independent requests and do not reuse previous tool results', async () => {
    // 1st turn: list products
    (api.chat as any).mockResolvedValueOnce({
      message: 'Here are the products.',
      toolCalls: [
        {
          tool: 'woocommerce__list_products',
          status: 'success',
          durationMs: 120,
          result: [{ id: 1, name: 'Product A' }]
        }
      ]
    });

    const { rerender } = renderChat();

    // Click suggested prompt
    fireEvent.click(screen.getByText('List my WooCommerce products'));

    await waitFor(() => {
      expect(api.chat).toHaveBeenCalledTimes(1);
    });

    // Update conversation state to reflect turn 1
    mockConversations[0].messages = [
      { id: 'm1', role: 'user', content: 'List my WooCommerce products', timestamp: new Date().toISOString() },
      { id: 'm2', role: 'assistant', content: 'Here are the products.', toolCalls: [{ tool: 'woocommerce__list_products', status: 'success' }], timestamp: new Date().toISOString() }
    ];

    rerender(
      <ChatContext.Provider
        value={{
          conversations: mockConversations,
          activeConversationId: 'conv-1',
          activeConversation: mockConversations[0],
          setActiveConversationId: vi.fn(),
          createConversation: createConversationMock,
          addMessage: addMessageMock,
          renameConversation: vi.fn(),
          deleteConversation: vi.fn(),
        }}
      >
        <Chat />
      </ChatContext.Provider>
    );

    // 2nd turn: ask weather
    (api.chat as any).mockResolvedValueOnce({
      message: 'Weather is 32C.',
      toolCalls: [
        {
          tool: 'weather__get_weather',
          status: 'success',
          durationMs: 80,
          result: { temp: 32 }
        }
      ]
    });

    const textarea = screen.getByPlaceholderText('Ask Urumi Agent anything...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "What's the weather in Ahmedabad?" } });
    fireEvent.submit(textarea.closest('form')!);

    await waitFor(() => {
      expect(api.chat).toHaveBeenCalledTimes(2);
      expect(api.chat).toHaveBeenLastCalledWith(
        expect.objectContaining({
          message: "What's the weather in Ahmedabad?",
          conversationHistory: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'List my WooCommerce products' }),
            expect.objectContaining({ role: 'assistant', content: 'Here are the products.' }),
            expect.objectContaining({ role: 'user', content: "What's the weather in Ahmedabad?" })
          ])
        })
      );
    });

    await waitFor(() => {
      // 2nd assistant message has its own toolCalls, not the first turn's products
      expect(addMessageMock).toHaveBeenLastCalledWith('conv-1', expect.objectContaining({
        role: 'assistant',
        content: 'Weather is 32C.',
        toolCalls: [
          expect.objectContaining({ tool: 'weather__get_weather' })
        ]
      }));
    });
  });
});
