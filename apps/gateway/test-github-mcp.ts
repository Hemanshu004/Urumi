import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

async function run() {
  const transport = new SSEClientTransport(new URL("http://localhost:3002/sse"));
  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  
  await client.connect(transport);
  
  const res = await client.callTool({
    name: "search_repositories",
    arguments: { query: "Urumi" }
  });
  
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}

run().catch(console.error);
