/**
 * Strips null-valued optional parameters from tool arguments.
 *
 * LLMs (Groq, Gemini, OpenAI, etc.) routinely emit `"key": null` for optional
 * parameters they don't intend to set.  MCP tool schemas declare those as
 * `{ type: "string" }` (not nullable), so passing `null` causes validation
 * errors.
 *
 * This utility removes any key whose value is `null` **unless** the key appears
 * in the schema's `required` array.  Required parameters are left untouched so
 * that genuine validation errors are surfaced rather than silently swallowed.
 *
 * @param args - The parsed arguments object from the LLM tool call.
 * @param inputSchema - The MCP tool's JSON Schema (from the registry).
 *                      May be undefined/null for tools with no schema.
 * @returns A shallow copy of `args` with null optionals removed.
 */
export function stripNullArgs(
  args: Record<string, unknown>,
  inputSchema?: { required?: string[]; [key: string]: unknown } | null
): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return args;
  }

  const required = new Set<string>(
    Array.isArray(inputSchema?.required) ? inputSchema!.required : []
  );

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === null && !required.has(key)) {
      // Omit null optional parameter
      continue;
    }
    cleaned[key] = value;
  }

  return cleaned;
}
