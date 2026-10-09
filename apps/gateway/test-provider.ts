import { GeminiProvider } from './src/services/llm.js';
import * as dotenv from 'dotenv';
dotenv.config();

async function test() {
  const provider = new GeminiProvider();

  const messages = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Please use the get_weather tool to find the weather in Paris." }
  ];

  const tools = [
    {
      namespacedName: "get_weather",
      description: "Get weather for a location",
      inputSchema: {
        type: "object",
        properties: {
          location: { type: "string" }
        }
      }
    }
  ];

  try {
    const response = await provider.chat(messages as any, tools);
    console.log(JSON.stringify(response, null, 2));
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

test();
