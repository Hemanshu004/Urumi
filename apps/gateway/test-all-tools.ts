import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.LLM_API_KEY });

async function test() {
  const tools = [{
    functionDeclarations: [
      {
        name: "test",
        description: "test",
        parameters: { type: "OBJECT", properties: { a: { type: "STRING" } } }
      }
    ]
  }];
  try {
    const res = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      tools
    });
    console.log("Success:", res.text);
  } catch (e: any) {
    console.error("Error status:", e.status);
    console.error("Error message:", e.message);
  }
}
test();
