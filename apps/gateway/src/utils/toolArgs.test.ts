import { describe, it, expect } from "vitest";
import { stripNullArgs } from "./toolArgs.js";

describe("stripNullArgs", () => {
  // ── Core behaviour ────────────────────────────────────────────────

  it("removes null-valued optional parameters", () => {
    const args = { after: null, page: 1, per_page: 20 };
    const schema = {
      type: "object",
      properties: {
        after: { type: "string" },
        page: { type: "integer" },
        per_page: { type: "integer" },
      },
      // "after" is NOT required
      required: ["page"],
    };

    const result = stripNullArgs(args, schema);
    expect(result).toEqual({ page: 1, per_page: 20 });
    expect("after" in result).toBe(false);
  });

  it("preserves null-valued REQUIRED parameters", () => {
    const args = { owner: null, repo: "urumi" };
    const schema = {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
      },
      required: ["owner", "repo"],
    };

    const result = stripNullArgs(args, schema);
    expect(result).toEqual({ owner: null, repo: "urumi" });
  });

  // ── WooCommerce regression (the original bug) ─────────────────────

  it("WooCommerce list_orders: strips null 'after' date", () => {
    const args = { after: null, page: 1, per_page: 20 };
    const schema = {
      type: "object",
      properties: {
        after: { type: "string", description: "Limit to orders after a given ISO8601 date." },
        before: { type: "string" },
        status: { type: "string" },
        page: { type: "integer" },
        per_page: { type: "integer" },
      },
      // None are required — all optional
    };

    const result = stripNullArgs(args, schema);
    expect(result).toEqual({ page: 1, per_page: 20 });
    expect("after" in result).toBe(false);
    expect("before" in result).toBe(false);
  });

  // ── Edge cases ────────────────────────────────────────────────────

  it("returns unchanged args when no values are null", () => {
    const args = { page: 1, per_page: 20 };
    const schema = { type: "object", properties: {} };

    expect(stripNullArgs(args, schema)).toEqual({ page: 1, per_page: 20 });
  });

  it("handles missing/undefined schema gracefully", () => {
    const args = { foo: null, bar: "baz" };

    // No required array → all nulls are optional → should strip
    expect(stripNullArgs(args, undefined)).toEqual({ bar: "baz" });
    expect(stripNullArgs(args, null)).toEqual({ bar: "baz" });
  });

  it("handles schema with no required array", () => {
    const args = { a: null, b: null, c: 42 };
    const schema = {
      type: "object",
      properties: { a: { type: "string" }, b: { type: "string" }, c: { type: "integer" } },
    };

    expect(stripNullArgs(args, schema)).toEqual({ c: 42 });
  });

  it("handles empty args object", () => {
    expect(stripNullArgs({}, { type: "object" })).toEqual({});
  });

  it("preserves falsy-but-not-null values (0, false, empty string)", () => {
    const args = { count: 0, active: false, name: "", missing: null };
    const schema = { type: "object", properties: {} };

    const result = stripNullArgs(args, schema);
    expect(result).toEqual({ count: 0, active: false, name: "" });
  });

  it("preserves undefined values (only strips null)", () => {
    const args = { a: undefined, b: null, c: "ok" } as Record<string, unknown>;
    const schema = { type: "object", properties: {} };

    const result = stripNullArgs(args, schema);
    // undefined is preserved (it's not null); b is stripped
    expect("a" in result).toBe(true);
    expect("b" in result).toBe(false);
    expect(result.c).toBe("ok");
  });

  it("strips multiple null optionals among mixed required/optional", () => {
    const args = { a: null, b: null, c: null, d: "keep" };
    const schema = {
      type: "object",
      properties: {},
      required: ["b"],
    };

    const result = stripNullArgs(args, schema);
    expect(result).toEqual({ b: null, d: "keep" });
  });

  // ── Defensive / non-object input ─────────────────────────────────

  it("returns input unchanged for non-object args", () => {
    expect(stripNullArgs(null as any, {})).toBe(null);
    expect(stripNullArgs(undefined as any, {})).toBe(undefined);
    expect(stripNullArgs([] as any, {})).toEqual([]);
  });

  // ── GitHub-style scenario (ensure no regression) ──────────────────

  it("GitHub create_issue: preserves all non-null args with required fields", () => {
    const args = {
      owner: "hemanshu",
      repo: "urumi",
      title: "Bug report",
      body: "Something broke",
      labels: null,
      assignees: null,
    };
    const schema = {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        labels: { type: "array" },
        assignees: { type: "array" },
      },
      required: ["owner", "repo", "title"],
    };

    const result = stripNullArgs(args, schema);
    expect(result).toEqual({
      owner: "hemanshu",
      repo: "urumi",
      title: "Bug report",
      body: "Something broke",
    });
    // Optional nulls removed, required values kept, non-null optionals kept
    expect("labels" in result).toBe(false);
    expect("assignees" in result).toBe(false);
  });
});
