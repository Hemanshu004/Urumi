import { URL } from "url";
import dns from "dns";
import ipaddr from "ipaddr.js";
import { promisify } from "util";

const resolve = promisify(dns.resolve4);

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

  const hostname = parsedUrl.hostname;
  
  // Try parsing as IP directly
  let addresses: string[] = [];
  if (ipaddr.isValid(hostname)) {
    addresses = [hostname];
  } else {
    // Resolve DNS
    try {
      addresses = await resolve(hostname);
    } catch (err) {
      throw new Error(`Failed to resolve hostname: ${hostname}`);
    }
  }

  for (const address of addresses) {
    try {
      const ip = ipaddr.parse(address);
      const range = ip.range();

      // Block all non-public IPv4
      const blockedRanges = [
        "unspecified",
        "broadcast",
        "multicast",
        "linkLocal",
        "loopback",
        "private",
        "carrierGradeNat",
        "reserved"
      ];

      if (blockedRanges.includes(range)) {
        throw new Error(`SSRF Prevention: URL resolves to restricted IP range (${range})`);
      }

      // Check cloud metadata services explicitly
      if (address === "169.254.169.254" || address === "169.254.169.253" || address === "100.100.100.200") {
        throw new Error("SSRF Prevention: URL resolves to cloud metadata address");
      }
    } catch (err: any) {
      if (err.message.startsWith("SSRF")) throw err;
      throw new Error(`Invalid IP address resolved: ${address}`);
    }
  }

  // To prevent DNS rebinding bypass where practical, we can return the IP-based URL
  // but MCP often requires proper hostnames for SNI and TLS, so we return the original URL if it passes.
  return urlString;
}
