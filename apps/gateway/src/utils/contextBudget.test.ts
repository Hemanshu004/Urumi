import { describe, it, expect } from "vitest";
import {
  extractPayload,
  formatAndBoundToolResult,
  groupConversationIntoBlocks,
  sanitizeMessageSequence,
  boundConversationHistory,
  DEFAULT_MAX_REPO_ITEMS
} from "./contextBudget.js";
import { ChatMessage } from "../services/llm.js";

describe("contextBudget Utility", () => {
  describe("extractPayload", () => {
    it("extracts text from standard MCP content array", () => {
      const mcpContent = [{ type: "text", text: JSON.stringify({ key: "value" }) }];
      const extracted = extractPayload(mcpContent);
      expect(extracted).toEqual({ key: "value" });
    });

    it("extracts text from wrapped CallToolResult content", () => {
      const wrapped = { content: [{ type: "text", text: "plain text message" }] };
      const extracted = extractPayload(wrapped);
      expect(extracted).toBe("plain text message");
    });

    it("extracts and parses json string directly", () => {
      const str = JSON.stringify([1, 2, 3]);
      expect(extractPayload(str)).toEqual([1, 2, 3]);
    });

    it("returns raw object or primitives if not wrapped", () => {
      expect(extractPayload({ direct: true })).toEqual({ direct: true });
      expect(extractPayload("hello world")).toBe("hello world");
      expect(extractPayload(null)).toBe("");
    });
  });

  describe("formatAndBoundToolResult - GitHub Search Repositories", () => {
    const makeRepo = (id: number) => ({
      id,
      node_id: `node_${id}`,
      name: `repo-${id}`,
      full_name: `owner/repo-${id}`,
      private: false,
      owner: {
        login: "owner",
        id: 100,
        avatar_url: "https://avatars.githubusercontent.com/u/100?v=4",
        html_url: "https://github.com/owner",
        followers_url: "https://api.github.com/users/owner/followers",
        organizations_url: "https://api.github.com/users/owner/orgs",
        repos_url: "https://api.github.com/users/owner/repos"
      },
      html_url: `https://github.com/owner/repo-${id}`,
      description: `This is a test description for repository ${id} with enough text to verify that description trimming works appropriately.`,
      fork: false,
      url: `https://api.github.com/repos/owner/repo-${id}`,
      forks_url: `https://api.github.com/repos/owner/repo-${id}/forks`,
      keys_url: `https://api.github.com/repos/owner/repo-${id}/keys{/key_id}`,
      collaborators_url: `https://api.github.com/repos/owner/repo-${id}/collaborators{/collaborator}`,
      teams_url: `https://api.github.com/repos/owner/repo-${id}/teams`,
      hooks_url: `https://api.github.com/repos/owner/repo-${id}/hooks`,
      issue_events_url: `https://api.github.com/repos/owner/repo-${id}/issues/events{/number}`,
      events_url: `https://api.github.com/repos/owner/repo-${id}/events`,
      assignees_url: `https://api.github.com/repos/owner/repo-${id}/assignees{/user}`,
      branches_url: `https://api.github.com/repos/owner/repo-${id}/branches{/branch}`,
      tags_url: `https://api.github.com/repos/owner/repo-${id}/tags`,
      blobs_url: `https://api.github.com/repos/owner/repo-${id}/git/blobs{/sha}`,
      git_tags_url: `https://api.github.com/repos/owner/repo-${id}/git/tags{/sha}`,
      git_refs_url: `https://api.github.com/repos/owner/repo-${id}/git/refs{/sha}`,
      trees_url: `https://api.github.com/repos/owner/repo-${id}/git/trees{/sha}`,
      statuses_url: `https://api.github.com/repos/owner/repo-${id}/statuses/{sha}`,
      languages_url: `https://api.github.com/repos/owner/repo-${id}/languages`,
      stargazers_url: `https://api.github.com/repos/owner/repo-${id}/stargazers`,
      contributors_url: `https://api.github.com/repos/owner/repo-${id}/contributors`,
      subscribers_url: `https://api.github.com/repos/owner/repo-${id}/subscribers`,
      subscription_url: `https://api.github.com/repos/owner/repo-${id}/subscription`,
      commits_url: `https://api.github.com/repos/owner/repo-${id}/commits{/sha}`,
      git_commits_url: `https://api.github.com/repos/owner/repo-${id}/git/commits{/sha}`,
      comments_url: `https://api.github.com/repos/owner/repo-${id}/comments{/number}`,
      issue_comment_url: `https://api.github.com/repos/owner/repo-${id}/issues/comments{/number}`,
      contents_url: `https://api.github.com/repos/owner/repo-${id}/contents/{+path}`,
      compare_url: `https://api.github.com/repos/owner/repo-${id}/compare/{base}...{head}`,
      merges_url: `https://api.github.com/repos/owner/repo-${id}/merges`,
      archive_url: `https://api.github.com/repos/owner/repo-${id}/{archive_format}{/ref}`,
      downloads_url: `https://api.github.com/repos/owner/repo-${id}/downloads`,
      issues_url: `https://api.github.com/repos/owner/repo-${id}/issues{/number}`,
      pulls_url: `https://api.github.com/repos/owner/repo-${id}/pulls{/number}`,
      milestones_url: `https://api.github.com/repos/owner/repo-${id}/milestones{/number}`,
      notifications_url: `https://api.github.com/repos/owner/repo-${id}/notifications{?since,all,participating}`,
      labels_url: `https://api.github.com/repos/owner/repo-${id}/labels{/name}`,
      releases_url: `https://api.github.com/repos/owner/repo-${id}/releases{/id}`,
      deployments_url: `https://api.github.com/repos/owner/repo-${id}/deployments`,
      stargazers_count: 150 * id,
      language: "TypeScript",
      forks_count: 20 * id,
      open_issues_count: 5 * id
    });

    it("prunes 80+ fields down to essential fields and caps at 5 items", () => {
      const tenMassiveRepos = Array.from({ length: 10 }, (_, i) => makeRepo(i + 1));
      const mcpContent = [{ type: "text", text: JSON.stringify(tenMassiveRepos) }];

      const initialSize = JSON.stringify(tenMassiveRepos).length;
      expect(initialSize).toBeGreaterThan(15000); // Verify realistic huge upstream payload

      const result = formatAndBoundToolResult("github__search_repositories", mcpContent);

      // LLM content must be valid JSON and compact
      const parsedLLM = JSON.parse(result.llmContent);
      expect(parsedLLM._truncated).toBe(true);
      expect(parsedLLM._total_found).toBe(10);
      expect(parsedLLM.items).toHaveLength(DEFAULT_MAX_REPO_ITEMS);

      // Check essential fields preserved
      const firstRepo = parsedLLM.items[0];
      expect(firstRepo.id).toBe(1);
      expect(firstRepo.full_name).toBe("owner/repo-1");
      expect(firstRepo.html_url).toBe("https://github.com/owner/repo-1");
      expect(firstRepo.stargazers_count).toBe(150);
      expect(firstRepo.language).toBe("TypeScript");

      // Check extraneous fields removed
      expect(firstRepo).not.toHaveProperty("blobs_url");
      expect(firstRepo).not.toHaveProperty("branches_url");
      expect(firstRepo).not.toHaveProperty("comments_url");
      expect(firstRepo).not.toHaveProperty("git_commits_url");

      // Verify displayResult is directly usable by Dashboard ToolRenderer table
      expect(Array.isArray(result.displayResult)).toBe(true);
      expect(result.displayResult).toHaveLength(DEFAULT_MAX_REPO_ITEMS);
      expect(result.displayResult[0].full_name).toBe("owner/repo-1");

      // Verify massive token reduction (>80% reduction)
      expect(result.llmContent.length).toBeLessThan(initialSize * 0.2);
    });
  });

  describe("formatAndBoundToolResult - Oversized Tool Outputs", () => {
    it("reduces oversized arrays safely and preserves valid JSON", () => {
      const largeArray = Array.from({ length: 100 }, (_, i) => ({
        index: i,
        data: `Long text description for entry ${i} `.repeat(5)
      }));

      const raw = [{ type: "text", text: JSON.stringify(largeArray) }];
      const result = formatAndBoundToolResult("custom_tool", raw, 2000);

      // Must be valid JSON
      expect(() => JSON.parse(result.llmContent)).not.toThrow();
      const parsed = JSON.parse(result.llmContent);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeLessThan(largeArray.length);

      const marker = parsed[parsed.length - 1];
      expect(marker._truncated).toBe(true);
      expect(marker._total_items).toBe(100);
    });

    it("reduces oversized objects with list fields safely", () => {
      const largeObj = {
        status: "ok",
        orders: Array.from({ length: 50 }, (_, i) => ({
          orderId: i,
          customer: `Customer ${i}`,
          notes: "Very long order notes that take up significant space in JSON payload."
        }))
      };

      const result = formatAndBoundToolResult("woocommerce__list_orders", largeObj, 1500);

      expect(() => JSON.parse(result.llmContent)).not.toThrow();
      const parsed = JSON.parse(result.llmContent);
      expect(parsed._truncated).toBe(true);
      expect(parsed.orders.length).toBeLessThan(50);
      expect(parsed._total_items).toBe(50);
    });

    it("truncates oversized plain strings cleanly with truncation notice", () => {
      const hugeString = "Lorem ipsum dolor sit amet. ".repeat(200); // ~5600 chars
      const result = formatAndBoundToolResult("generic_text_tool", hugeString, 1000);

      expect(result.llmContent.length).toBeLessThanOrEqual(1050);
      expect(result.llmContent).toContain("[... Output truncated to fit context budget]");
    });
  });

  describe("boundConversationHistory - Grouping and Tool Pairing", () => {
    it("preserves assistant tool-call and tool-response pairs intact", () => {
      const history: ChatMessage[] = [
        { role: "user", content: "What is the weather?" },
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_weather_1", type: "function", function: { name: "get_weather", arguments: "{}" } }]
        },
        { role: "tool", tool_call_id: "call_weather_1", content: "Sunny 22C" },
        { role: "assistant", content: "It is sunny and 22C." },
        { role: "user", content: "And in Tokyo?" },
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_weather_2", type: "function", function: { name: "get_weather", arguments: "{}" } }]
        },
        { role: "tool", tool_call_id: "call_weather_2", content: "Rainy 15C" },
        { role: "assistant", content: "It is rainy in Tokyo." }
      ];

      // Request keeping only the most recent turn (maxTurns: 1)
      const bounded = boundConversationHistory(history, { maxTurns: 1 });

      // First turn must be dropped completely; second turn must remain completely intact
      expect(bounded).toHaveLength(4);
      expect(bounded[0]).toEqual({ role: "user", content: "And in Tokyo?" });
      expect(bounded[1].role).toBe("assistant");
      expect(bounded[1].tool_calls?.[0].id).toBe("call_weather_2");
      expect(bounded[2]).toEqual({ role: "tool", tool_call_id: "call_weather_2", content: "Rainy 15C" });
      expect(bounded[3]).toEqual({ role: "assistant", content: "It is rainy in Tokyo." });
    });

    it("drops orphaned tool responses without prior assistant tool calls", () => {
      const history: ChatMessage[] = [
        { role: "user", content: "Hello" },
        { role: "tool", tool_call_id: "orphaned_call_id", content: "Should be dropped" },
        { role: "assistant", content: "Hi there" }
      ];

      const bounded = boundConversationHistory(history);
      expect(bounded.some(m => m.role === "tool")).toBe(false);
      expect(bounded).toHaveLength(2);
    });

    it("removes unanswered tool calls from assistant messages if tool response is missing", () => {
      const history: ChatMessage[] = [
        { role: "user", content: "Check something" },
        {
          role: "assistant",
          content: "Let me check that.",
          tool_calls: [{ id: "unanswered_call", type: "function", function: { name: "test", arguments: "{}" } }]
        }
      ];

      const bounded = boundConversationHistory(history);
      expect(bounded).toHaveLength(2);
      expect(bounded[1].tool_calls).toBeUndefined();
      expect(bounded[1].content).toBe("Let me check that.");
    });
  });
});
