import { GoogleGenAI } from '@google/genai';

async function run() {
  const ai = new GoogleGenAI({ apiKey: process.env.LLM_API_KEY });
  try {
    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash', // Let's test with the actual model user requested, wait requested is gemini-3.8-flash
      contents: 'List my products',
      tools: [{
        functionDeclarations: [{
          name: 'list_products',
          description: 'Lists products',
          parameters: {
            type: 'object',
            properties: { limit: { type: 'number' } }
          }
        }]
      }]
    });
    console.log(JSON.stringify(res.functionCalls, null, 2));
  } catch(e) {
    console.error(e);
  }
}
run();
