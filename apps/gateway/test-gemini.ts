import { GoogleGenAI, Type } from '@google/genai';
import * as dotenv from 'dotenv';
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.LLM_API_KEY });

async function test() {
  const tools = [{
    functionDeclarations: [{
      name: "get_weather",
      description: "Get weather for a location",
      parameters: {
        type: Type.OBJECT,
        properties: {
          location: { type: Type.STRING }
        }
      }
    }]
  }];

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: [{ role: "user", parts: [{ text: "What is the weather in Paris?" }] }],
      tools
    });
    console.log("Response:", response.text);
    console.log("Function Calls:", JSON.stringify(response.functionCalls, null, 2));
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

test();
