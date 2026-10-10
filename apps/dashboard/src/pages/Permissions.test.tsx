import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import Permissions from './Permissions';
import { api } from '../services/api';

vi.mock('../services/api', () => ({
  api: {
    getServers: vi.fn(),
    getPermissions: vi.fn(),
    grantPermission: vi.fn(),
    revokePermission: vi.fn()
  }
}));

describe('Permissions Page', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (api.getServers as any).mockResolvedValue({
      servers: [
        {
          id: 1,
          name: 'woocommerce',
          status: 'connected',
          tools: [
            { name: 'woocommerce__list_products', description: 'List products' },
            { name: 'woocommerce__delete_product', description: 'Delete products' }
          ]
        }
      ]
    });
    (api.getPermissions as any).mockResolvedValue({
      role: 'member',
      permissions: [
        { id: 1, namespacedTool: 'woocommerce__list_products' }
      ]
    });
  });

  it('renders servers and tools', async () => {
    render(<Permissions />);
    
    expect(screen.getByText('Loading...')).toBeDefined();

    await waitFor(() => {
      expect(screen.queryByText('Loading...')).toBeNull();
    });

    expect(screen.getByText('woocommerce')).toBeDefined();
    expect(screen.getByText('woocommerce__list_products')).toBeDefined();
    expect(screen.getByText('woocommerce__delete_product')).toBeDefined();

    // Check statuses based on mock
    expect(screen.getByText('Allowed')).toBeDefined();
    expect(screen.getByText('Unclassified')).toBeDefined();
  });

  it('calls grant API when Grant button is clicked', async () => {
    (api.grantPermission as any).mockResolvedValue({});
    
    render(<Permissions />);
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).toBeNull();
    });

    const grantBtn = screen.getByText('Grant');
    fireEvent.click(grantBtn);

    expect(api.grantPermission).toHaveBeenCalledWith('member', 'woocommerce__delete_product');
  });

  it('calls revoke API when Revoke button is clicked', async () => {
    (api.revokePermission as any).mockResolvedValue({});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    
    render(<Permissions />);
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).toBeNull();
    });

    const revokeBtn = screen.getByText('Revoke');
    fireEvent.click(revokeBtn);

    expect(api.revokePermission).toHaveBeenCalledWith('member', 'woocommerce__list_products');
  });
});
