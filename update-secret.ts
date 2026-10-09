import fs from 'fs';
import { execSync } from 'child_process';

const transcriptPath = '/Users/hitmac/.gemini/antigravity-ide/brain/7ff0570d-eed6-4b83-bae9-172608654d6e/.system_generated/logs/transcript.jsonl';
const transcript = fs.readFileSync(transcriptPath, 'utf8');

let groqKey = '';
const lines = transcript.split('\n');
for (let i = lines.length - 1; i >= 0; i--) {
  const line = lines[i];
  if (!line) continue;
  try {
    const parsed = JSON.parse(line);
    if (parsed.type === 'USER_INPUT') {
      const match = parsed.content.match(/gsk_[a-zA-Z0-9]+/);
      if (match) {
        groqKey = match[0];
        break;
      }
    }
  } catch (e) {}
}

if (!groqKey) {
  console.error("Could not find groq key in transcript!");
  process.exit(1);
}

const b64Key = Buffer.from(groqKey).toString('base64');
const patch = JSON.stringify({
  data: {
    LLM_API_KEY: b64Key
  }
});

fs.writeFileSync('/tmp/patch.json', patch);
try {
  execSync('kubectl patch secret urumi-secrets -n urumi -p "$(cat /tmp/patch.json)"');
  console.log("Successfully patched secret.");
} catch (e) {
  console.error("Error patching secret:", e);
}
fs.unlinkSync('/tmp/patch.json');
