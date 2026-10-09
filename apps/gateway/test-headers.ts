import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
const t = new StreamableHTTPClientTransport(new URL("http://localhost"), { headers: { Authorization: "Bearer xyz" } });
