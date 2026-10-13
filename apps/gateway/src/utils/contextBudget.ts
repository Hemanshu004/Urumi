import { ChatMessage } from "../services/llm.js";

export const DEFAULT_MAX_TOOL_RESULT_CHARS = 2500;
export const DEFAULT_MAX_HISTORY_TURNS = 6;
export const DEFAULT_MAX_HISTORY_CHARS = 10000;
export const DEFAULT_MAX_REPO_ITEMS = 5;

/**
 * Extracts payload from MCP tool results or raw structures.
 */
export function extractPayload(rawContent: any): any {
  if (rawContent === undefined || rawContent === null) return "";

  // MCP content array format: [{ type: "text", text: "..." }]
  if (Array.isArray(rawContent) && rawContent.length > 0) {
    if (rawContent[0]?.type === "text" && typeof rawContent[0].text === "string") {
      try {
        return JSON.parse(rawContent[0].text);
      } catch {
        return rawContent[0].text;
      }
    }
  }

  // Wrapped CallToolResult format: { content: [...] }
  if (rawContent.content && Array.isArray(rawContent.content) && rawContent.content.length > 0) {
    if (rawContent.content[0]?.type === "text" && typeof rawContent.content[0].text === "string") {
      try {
        return JSON.parse(rawContent.content[0].text);
      } catch {
        return rawContent.content[0].text;
      }
    }
    return rawContent.content;
  }

  // String format (attempt JSON parse)
  if (typeof rawContent === "string") {
    try {
      return JSON.parse(rawContent);
    } catch {
      return rawContent;
    }
  }

  return rawContent;
}

/**
 * Prunes a single GitHub repository object to essential fields needed for display and LLM summary.
 */
function pruneGithubRepo(repo: any) {
  if (!repo || typeof repo !== "object") return repo;
  const desc = repo.description;
  const truncatedDesc = desc
    ? (desc.length > 150 ? desc.slice(0, 147) + "..." : desc)
    : null;

  return {
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name || repo.name,
    description: truncatedDesc,
    html_url: repo.html_url,
    stargazers_count: repo.stargazers_count ?? 0,
    language: repo.language ?? null,
    forks_count: repo.forks_count ?? 0,
    open_issues_count: repo.open_issues_count ?? 0
  };
}

/**
 * Formats and bounds tool output safely.
 * - Extracts inner text/JSON
 * - Prunes GitHub repository searches to essential fields & top 5 items
 * - Ensures valid JSON is always produced for structured data
 * - Truncates strings with clear markers when context budget is exceeded
 */
export function formatAndBoundToolResult(
  toolName: string,
  rawContent: any,
  maxChars = DEFAULT_MAX_TOOL_RESULT_CHARS
): { llmContent: string; displayResult: any } {
  const payload = extractPayload(rawContent);

  // 1. Tool-specific handling: GitHub Repository Search
  if (toolName === "github__search_repositories") {
    const rawItems = Array.isArray(payload)
      ? payload
      : (payload?.items || payload?.data || []);

    if (Array.isArray(rawItems)) {
      const isTruncated = rawItems.length > DEFAULT_MAX_REPO_ITEMS;
      const prunedItems = rawItems
        .slice(0, DEFAULT_MAX_REPO_ITEMS)
        .map(pruneGithubRepo);

      const llmData = isTruncated
        ? {
            items: prunedItems,
            _truncated: true,
            _total_found: rawItems.length,
            _note: `Showing top ${DEFAULT_MAX_REPO_ITEMS} of ${rawItems.length} repositories to fit context budget.`
          }
        : prunedItems;

      return {
        llmContent: JSON.stringify(llmData),
        displayResult: prunedItems
      };
    }
  }

  // 2. Generic Structured Array Handling
  if (Array.isArray(payload)) {
    const initialJson = JSON.stringify(payload);
    if (initialJson.length <= maxChars) {
      return {
        llmContent: initialJson,
        displayResult: payload
      };
    }

    // Safely reduce array items to fit within budget
    const keptItems: any[] = [];
    for (let i = 0; i < payload.length; i++) {
      keptItems.push(payload[i]);
      const currentJson = JSON.stringify(keptItems);
      if (currentJson.length > maxChars && keptItems.length > 1) {
        keptItems.pop(); // Revert last item that breached budget
        break;
      }
    }

    const truncatedResult: any[] = [...keptItems];
    truncatedResult.push({
      _truncated: true,
      _total_items: payload.length,
      _returned_items: keptItems.length,
      _note: `Results truncated to fit context budget.`
    });

    return {
      llmContent: JSON.stringify(truncatedResult),
      displayResult: keptItems
    };
  }

  // 3. Generic Structured Object Handling
  if (payload && typeof payload === "object") {
    const initialJson = JSON.stringify(payload);
    if (initialJson.length <= maxChars) {
      return {
        llmContent: initialJson,
        displayResult: payload
      };
    }

    // Check if object contains a list property to prune
    const listKey = Object.keys(payload).find(
      key => Array.isArray(payload[key]) && payload[key].length > 0
    );

    if (listKey) {
      const originalList = payload[listKey];
      const cloned = { ...payload };
      const keptItems: any[] = [];

      for (let i = 0; i < originalList.length; i++) {
        keptItems.push(originalList[i]);
        cloned[listKey] = keptItems;
        if (JSON.stringify(cloned).length > maxChars && keptItems.length > 1) {
          keptItems.pop();
          break;
        }
      }

      cloned[listKey] = keptItems;
      cloned._truncated = true;
      cloned._total_items = originalList.length;
      cloned._returned_items = keptItems.length;

      return {
        llmContent: JSON.stringify(cloned),
        displayResult: cloned
      };
    }

    // Prune long string values in the object to stay within budget
    const prunedObj: Record<string, any> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (typeof v === "string" && v.length > 150) {
        prunedObj[k] = v.slice(0, 147) + "...";
      } else {
        prunedObj[k] = v;
      }
    }

    prunedObj._truncated = true;
    const prunedJson = JSON.stringify(prunedObj);
    return {
      llmContent: prunedJson,
      displayResult: prunedObj
    };
  }

  // 4. Plain String / Text Handling
  const str = String(payload ?? "");
  if (str.length <= maxChars) {
    return {
      llmContent: str,
      displayResult: str
    };
  }

  const truncatedStr =
    str.slice(0, maxChars - 60) + "\n[... Output truncated to fit context budget]";
  return {
    llmContent: truncatedStr,
    displayResult: truncatedStr
  };
}

/**
 * Dialogue block structure grouping a user turn with all subsequent tool calls, tool responses,
 * and assistant replies to preserve protocol integrity during pruning.
 */
export interface DialogueBlock {
  messages: ChatMessage[];
  charLength: number;
}

/**
 * Calculates character length of a message block for token budgeting.
 */
function calculateBlockChars(messages: ChatMessage[]): number {
  let count = 0;
  for (const m of messages) {
    count += (m.content || "").length;
    if (m.tool_calls) {
      count += JSON.stringify(m.tool_calls).length;
    }
  }
  return count;
}

/**
 * Groups a message history array into atomic dialogue blocks.
 */
export function groupConversationIntoBlocks(history: any[]): DialogueBlock[] {
  const blocks: DialogueBlock[] = [];
  let currentBlock: ChatMessage[] = [];

  for (let i = 0; i < history.length; i++) {
    const raw = history[i];
    if (!raw || !raw.role) continue;
    if (
      raw.role !== "user" &&
      raw.role !== "assistant" &&
      raw.role !== "system" &&
      raw.role !== "tool"
    ) {
      continue;
    }

    const m: ChatMessage = {
      role: raw.role,
      content: raw.content ?? ""
    };
    if (raw.tool_calls) m.tool_calls = raw.tool_calls;
    if (raw.tool_call_id) m.tool_call_id = raw.tool_call_id;

    // A user message starts a new atomic block
    if (m.role === "user" && currentBlock.length > 0) {
      blocks.push({
        messages: currentBlock,
        charLength: calculateBlockChars(currentBlock)
      });
      currentBlock = [];
    }

    currentBlock.push(m);
  }

  if (currentBlock.length > 0) {
    blocks.push({
      messages: currentBlock,
      charLength: calculateBlockChars(currentBlock)
    });
  }

  return blocks;
}

/**
 * Sanitizes message sequences to guarantee strict OpenAI/Groq tool-call pairing:
 * - Every assistant message with tool_calls must be followed by matching tool responses
 * - Any orphaned tool message without matching prior tool_call is dropped
 * - Caps long historical tool message contents to keep context compact
 */
export function sanitizeMessageSequence(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];

    if (m.role === "tool") {
      // Must have an assistant message with matching tool_call_id preceding it
      const prevAssistant = result
        .slice()
        .reverse()
        .find(p => p.role === "assistant" && p.tool_calls && p.tool_calls.length > 0);

      const hasMatchingCall = prevAssistant?.tool_calls?.some(
        tc => tc.id === m.tool_call_id
      );

      if (!hasMatchingCall) {
        // Orphaned tool response: discard to avoid provider 400 Bad Request
        continue;
      }

      // Bound historical tool result length to 1500 chars so old turns don't inflate context
      const content = m.content || "";
      const boundedContent =
        content.length > 1500
          ? content.slice(0, 1440) + "\n[... Past tool result truncated]"
          : content;

      result.push({
        ...m,
        content: boundedContent
      });
    } else if (m.role === "assistant") {
      if (m.tool_calls && m.tool_calls.length > 0) {
        // Verify tool responses exist in subsequent messages
        const validCalls = m.tool_calls.filter(tc =>
          messages
            .slice(i + 1)
            .some(next => next.role === "tool" && next.tool_call_id === tc.id)
        );

        if (validCalls.length > 0) {
          result.push({
            ...m,
            tool_calls: validCalls
          });
        } else if (m.content) {
          // Keep assistant text content if present, but remove unanswered tool_calls
          const copy = { ...m };
          delete copy.tool_calls;
          result.push(copy);
        }
      } else {
        result.push(m);
      }
    } else {
      result.push(m);
    }
  }

  return result;
}

/**
 * Bounds conversation history safely within context and turn limits.
 * - Preserves assistant tool-call and tool-response pairs intact
 * - Prunes oldest atomic turns first
 * - Enforces character and turn limits
 */
export function boundConversationHistory(
  history: any[],
  options?: { maxTurns?: number; maxChars?: number }
): ChatMessage[] {
  if (!history || !Array.isArray(history) || history.length === 0) {
    return [];
  }

  const maxTurns = options?.maxTurns ?? DEFAULT_MAX_HISTORY_TURNS;
  const maxChars = options?.maxChars ?? DEFAULT_MAX_HISTORY_CHARS;

  const blocks = groupConversationIntoBlocks(history);
  if (blocks.length === 0) return [];

  // Traverse from newest block backwards, accumulating blocks within budget
  const keptBlocks: DialogueBlock[] = [];
  let accumulatedChars = 0;

  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (keptBlocks.length >= maxTurns) break;
    if (accumulatedChars + block.charLength > maxChars && keptBlocks.length > 0) {
      break;
    }

    keptBlocks.unshift(block);
    accumulatedChars += block.charLength;
  }

  // Flatten preserved blocks in chronological order
  const flatMessages: ChatMessage[] = [];
  for (const block of keptBlocks) {
    flatMessages.push(...block.messages);
  }

  // Ensure strict assistant/tool sequence validity
  return sanitizeMessageSequence(flatMessages);
}
