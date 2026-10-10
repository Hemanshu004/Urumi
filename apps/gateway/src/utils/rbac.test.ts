import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isToolAllowed } from './rbac.js';
import { db } from '../db/index.js';

vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([])
  }
}));

describe('RBAC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows admins access to everything', async () => {
    expect(await isToolAllowed('admin', 'unknown_tool')).toBe(true);
    expect(await isToolAllowed('admin', 'woocommerce__list_products')).toBe(true);
  });

  it('fails closed for unknown users/roles', async () => {
    expect(await isToolAllowed('unknown_role', 'woocommerce__list_products')).toBe(false);
  });

  it('dynamically loads permissions from db and allows explicitly approved tools for members', async () => {
    (db as any).where.mockResolvedValueOnce([
      { role: 'member', namespaced_tool: 'woocommerce__list_products' }
    ]);

    expect(await isToolAllowed('member', 'woocommerce__list_products')).toBe(true);
  });

  it('revocation takes effect immediately because it queries DB', async () => {
    (db as any).where.mockResolvedValueOnce([
      { role: 'member', namespaced_tool: 'woocommerce__list_products' }
    ]);
    expect(await isToolAllowed('member', 'woocommerce__list_products')).toBe(true);

    // Revoke
    (db as any).where.mockResolvedValueOnce([]);
    expect(await isToolAllowed('member', 'woocommerce__list_products')).toBe(false);
  });
});
