import { describe, it, expect } from 'vitest';
import { mcpContext } from './context.js';

describe('mcpContext', () => {
  it('should maintain state across async boundaries', async () => {
    await mcpContext.run({ userId: 42, keyId: 10 }, async () => {
      const store = mcpContext.getStore();
      expect(store?.userId).toBe(42);
      expect(store?.keyId).toBe(10);
      
      // Simulate async boundary
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const storeAfter = mcpContext.getStore();
      expect(storeAfter?.userId).toBe(42);
    });
    
    // Outside context
    expect(mcpContext.getStore()).toBeUndefined();
  });
});
