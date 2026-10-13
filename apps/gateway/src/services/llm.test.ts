import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getLLMProvider, GeminiProvider, OpenAILikeProvider } from './llm.js';

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    models = {
      generateContent: mockGenerateContent
    };
  }
  return {
    GoogleGenAI: MockGoogleGenAI
  };
});

describe('LLMProvider Factory', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.LLM_API_KEY = 'test-key';
  });

  it('returns OpenAILikeProvider by default', () => {
    delete process.env.LLM_PROVIDER;
    const provider = getLLMProvider();
    expect(provider).toBeInstanceOf(OpenAILikeProvider);
  });

  it('returns OpenAILikeProvider when set to openai', () => {
    process.env.LLM_PROVIDER = 'openai';
    const provider = getLLMProvider();
    expect(provider).toBeInstanceOf(OpenAILikeProvider);
  });

  it('returns GeminiProvider when set to gemini', () => {
    process.env.LLM_PROVIDER = 'gemini';
    const provider = getLLMProvider();
    expect(provider).toBeInstanceOf(GeminiProvider);
  });
});

describe('GeminiProvider', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
    mockGenerateContent.mockClear();
  });

  it('formats messages and tools correctly for Gemini', async () => {
    const provider = new GeminiProvider();
    
    mockGenerateContent.mockResolvedValue({
      text: 'Hello from Gemini',
      functionCalls: []
    });

    const messages = [
      { role: 'system', content: 'You are an AI' },
      { role: 'user', content: 'Hello' }
    ];

    const tools = [
      {
        namespacedName: 'test_tool',
        description: 'A test tool',
        inputSchema: { type: 'object', properties: {} }
      }
    ];

    const response = await provider.chat(messages as any, tools);

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const args = mockGenerateContent.mock.calls[0][0];
    
    expect(args.systemInstruction.parts[0].text).toBe('You are an AI');
    expect(args.contents[0].role).toBe('user');
    expect(args.contents[0].parts[0].text).toBe('Hello');
    expect(args.tools[0].functionDeclarations[0].name).toBe('test_tool');

    expect(response.choices[0].message.content).toBe('Hello from Gemini');
  });

  it('handles multiple tool calls and sequential tool calls', async () => {
    const provider = new GeminiProvider();
    
    mockGenerateContent.mockResolvedValue({
      text: null,
      functionCalls: [
        { name: 'tool1', args: { a: 1 } },
        { name: 'tool2', args: { b: 2 } }
      ]
    });

    const messages = [
      { role: 'user', content: 'Do things' },
      { 
        role: 'assistant', 
        tool_calls: [
           { id: '1', function: { name: 'tool1', arguments: '{"a":1}' } }
        ] 
      },
      {
        role: 'tool',
        tool_call_id: '1',
        content: '{"result": "ok"}'
      }
    ];

    const response = await provider.chat(messages as any, []);
    
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const args = mockGenerateContent.mock.calls[0][0];

    expect(args.contents[0].role).toBe('user');
    expect(args.contents[0].parts[0].text).toBe('Do things');
    
    expect(args.contents[1].role).toBe('model');
    expect(args.contents[1].parts[0].functionCall.name).toBe('tool1');

    expect(args.contents[2].role).toBe('user');
    expect(args.contents[2].parts[0].functionResponse.name).toBe('tool1');

    expect(response.choices[0].message.tool_calls.length).toBe(2);
    expect(response.choices[0].message.tool_calls[0].function.name).toBe('tool1');
    expect(response.choices[0].message.tool_calls[1].function.name).toBe('tool2');
  });
  
  it('throws an error if API key is missing', () => {
    delete process.env.LLM_API_KEY;
    expect(() => new GeminiProvider()).toThrow('LLM_API_KEY is not set');
  });

  it('retries a 503 error and succeeds', async () => {
    const provider = new GeminiProvider();
    
    // Fail once with 503, then succeed
    mockGenerateContent.mockRejectedValueOnce(new Error('503 Service Unavailable'));
    mockGenerateContent.mockResolvedValueOnce({
      text: 'Success after retry',
      functionCalls: []
    });

    const messages = [{ role: 'user', content: 'Retry me' }];
    const response = await provider.chat(messages as any, []);

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(response.choices[0].message.content).toBe('Success after retry');
  });

  it('exhausts retries on repeated 503 errors and throws', async () => {
    const provider = new GeminiProvider();
    
    mockGenerateContent.mockRejectedValue(new Error('503 Service Unavailable'));

    const messages = [{ role: 'user', content: 'Fail me' }];
    await expect(provider.chat(messages as any, [])).rejects.toThrow('API request failed after 3 retries due to transient errors');
    
    expect(mockGenerateContent).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  }, 15000);

  it('does not retry non-retryable errors (e.g. 400 Bad Request)', async () => {
    const provider = new GeminiProvider();
    
    mockGenerateContent.mockRejectedValue(new Error('400 Bad Request'));

    const messages = [{ role: 'user', content: 'Bad request' }];
    await expect(provider.chat(messages as any, [])).rejects.toThrow('Gemini Provider Error: 400 Bad Request');
    
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });
});

describe('OpenAILikeProvider', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-openai-key';
    delete process.env.LLM_MAX_TOKENS;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('includes max_tokens in payload to bound completion reservation against TPM limits', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'Hello from OpenAI' } }]
      })
    });
    global.fetch = mockFetch as any;

    const provider = new OpenAILikeProvider();
    await provider.chat([{ role: 'user', content: 'Hi' }], []);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(1024);
  });

  it('respects custom LLM_MAX_TOKENS environment setting', async () => {
    process.env.LLM_MAX_TOKENS = '2048';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'Response' } }]
      })
    });
    global.fetch = mockFetch as any;

    const provider = new OpenAILikeProvider();
    await provider.chat([{ role: 'user', content: 'Hi' }], []);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(2048);
  });

  it('attaches HTTP status code (such as 413) to thrown error for graceful handling', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 413,
      text: async () => 'Request too large for model openai/gpt-oss-120b. TPM limit: 8000, requested: 11683 tokens.'
    });
    global.fetch = mockFetch as any;

    const provider = new OpenAILikeProvider();
    try {
      await provider.chat([{ role: 'user', content: 'Overflow request' }], []);
      expect.fail('Expected provider.chat to throw');
    } catch (err: any) {
      expect(err.status).toBe(413);
      expect(err.message).toContain('413');
      expect(err.message).toContain('TPM limit: 8000');
    }
  });
});
