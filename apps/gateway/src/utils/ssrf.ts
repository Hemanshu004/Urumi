import { URL } from "url";
import dns from "dns";
import ipaddr from "ipaddr.js";
import { promisify } from "util";

const resolve4 = promisify(dns.resolve4);
const resolve6 = promisify(dns.resolve6);

// Allowlist of legitimate internal Kubernetes service names
const ALLOWED_INTERNAL_HOSTS = new Set([
  "woo-mcp",
  "github-mcp",
  "weather-mcp",
  "woo-mcp.urumi.svc.cluster.local",
  "github-mcp.urumi.svc.cluster.local",
  "weather-mcp.urumi.svc.cluster.local"
]);

function isAllowedInternalHost(hostname: string): boolean {
  return ALLOWED_INTERNAL_HOSTS.has(hostname.toLowerCase());
}

export async function validateUrlForSSRF(urlString: string): Promise<string> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlString);
  } catch (err) {
    throw new Error("Invalid URL format");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("URL must use http or https protocol");
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  
  if (hostname === "localhost") {
    throw new Error("SSRF Prevention: URL resolves to restricted IP range (loopback)");
  }
  
  let addresses: string[] = [];
  if (ipaddr.isValid(hostname)) {
    addresses = [hostname];
  } else {
    try {
      const results = await dns.promises.lookup(hostname, { all: true });
      addresses = results.map((r: any) => r.address);
      if (addresses.length === 0) {
         throw new Error(`Failed to resolve hostname: ${hostname}`);
      }
    } catch (err: any) {
      throw new Error(`Failed to resolve hostname: ${hostname} (${err.message})`);
    }
  }

  for (const address of addresses) {
    try {
      const ip = ipaddr.parse(address);
      const range = ip.range();

      // Blocked ranges according to requirements
      const blockedRanges = [
        "unspecified",
        "broadcast",
        "multicast",
        "linkLocal",
        "loopback",
        "carrierGradeNat", // Usually 100.64.0.0/10, not private but not public
      ];

      if (blockedRanges.includes(range)) {
        throw new Error(`SSRF Prevention: URL resolves to restricted IP range (${range})`);
      }

      // Explicit Cloud Metadata checks (some are link-local, but just to be sure)
      if (address === "169.254.169.254" || address === "169.254.169.253" || address === "100.100.100.200") {
        throw new Error("SSRF Prevention: URL resolves to cloud metadata address");
      }

      // Handle private RFC1918 addresses
      // Private IP = DENY by default
      // Legitimate Kubernetes MCP destination = explicit ALLOW
      if (range === "private") {
        if (!isAllowedInternalHost(hostname)) {
          throw new Error("SSRF Prevention: URL resolves to restricted IP range (private). Legitimate internal destinations must be added to the allowlist.");
        }
      }

    } catch (err: any) {
      if (err.message.startsWith("SSRF")) {
        throw err;
      }
      throw new Error(`Invalid IP address resolved: ${address}`);
    }
  }

  return urlString;
}
