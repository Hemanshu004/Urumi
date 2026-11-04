import { describe, it, expect, vi, afterEach } from 'vitest';
import dns from 'dns';
import { validateUrlForSSRF } from './ssrf.js';

describe('SSRF Validation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should block non-http protocols', async () => {
    await expect(validateUrlForSSRF('file:///etc/passwd')).rejects.toThrow('URL must use http or https protocol');
  });

  it('should block localhost and loopback', async () => {
    await expect(validateUrlForSSRF('http://localhost:3000')).rejects.toThrow('loopback');
    await expect(validateUrlForSSRF('http://127.0.0.1:8080')).rejects.toThrow('loopback');
  });

  it('should block cloud metadata IPs', async () => {
    await expect(validateUrlForSSRF('http://169.254.169.254/latest/meta-data/')).rejects.toThrow('linkLocal');
  });

  it('should block private IP ranges by default', async () => {
    // 10.x.x.x is private
    // Note: since this does DNS lookup, we'll mock dns in real environments, but 10.0.0.1 parses as private.
    await expect(validateUrlForSSRF('http://10.0.0.1:8080')).rejects.toThrow('Legitimate internal destinations must be added to the allowlist');
  });

  it('should allow explicitly allowlisted Kubernetes internal hostnames when resolving to private IP', async () => {
    vi.spyOn(dns.promises, 'lookup').mockImplementation(async (hostname: string) => {
      if (hostname === 'woo-mcp.urumi.svc.cluster.local' || hostname === 'woo-mcp') {
        return [{ address: '10.244.0.15', family: 4 }] as any;
      }
      if (hostname === 'weather-mcp.urumi.svc.cluster.local' || hostname === 'weather-mcp') {
        return [{ address: '10.244.0.16', family: 4 }] as any;
      }
      if (hostname === 'github-mcp.urumi.svc.cluster.local' || hostname === 'github-mcp') {
        return [{ address: '10.244.0.17', family: 4 }] as any;
      }
      throw new Error(`ENOTFOUND ${hostname}`);
    });

    const urlFqdn = 'http://woo-mcp.urumi.svc.cluster.local:3001/mcp';
    const resultFqdn = await validateUrlForSSRF(urlFqdn);
    expect(resultFqdn).toBe(urlFqdn);

    const urlShort = 'http://woo-mcp:3001/mcp';
    const resultShort = await validateUrlForSSRF(urlShort);
    expect(resultShort).toBe(urlShort);
  });

  it('should reject hostnames outside the allowlist even when resolving to private IP', async () => {
    vi.spyOn(dns.promises, 'lookup').mockImplementation(async () => {
      return [{ address: '10.244.0.25', family: 4 }] as any;
    });

    const unauthorizedFqdn = 'http://unauthorized-service.urumi.svc.cluster.local:8080/api';
    await expect(validateUrlForSSRF(unauthorizedFqdn)).rejects.toThrow(
      'SSRF Prevention: URL resolves to restricted IP range (private). Legitimate internal destinations must be added to the allowlist.'
    );

    const unauthorizedPrivate = 'http://internal-database.local:5432';
    await expect(validateUrlForSSRF(unauthorizedPrivate)).rejects.toThrow(
      'SSRF Prevention: URL resolves to restricted IP range (private). Legitimate internal destinations must be added to the allowlist.'
    );
  });

  it('should allow public URLs resolving to public IP addresses', async () => {
    vi.spyOn(dns.promises, 'lookup').mockImplementation(async () => {
      return [{ address: '93.184.216.34', family: 4 }] as any;
    });

    const publicUrl = 'https://api.external-service.com/mcp';
    const result = await validateUrlForSSRF(publicUrl);
    expect(result).toBe(publicUrl);
  });
});
