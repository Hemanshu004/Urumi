import { db } from "../db/index.js";
import { audit_logs } from "../db/schema.js";

export async function logAudit(record: {
  userId?: number;
  serverId?: number;
  namespacedTool: string;
  toolName: string;
  requestParams: any;
  outcome: "success" | "error" | "timeout";
  errorMessage?: string;
  durationMs: number;
  source: string;
  startedAt: Date;
  completedAt: Date;
}) {
  // Redact sensitive fields
  let sanitizedParams = { ...record.requestParams };
  const sensitiveKeys = ["password", "token", "secret", "authorization", "api_key", "consumer_secret"];
  
  if (sanitizedParams) {
    sanitizedParams = JSON.parse(JSON.stringify(sanitizedParams));
    const redact = (obj: any) => {
      if (typeof obj !== 'object' || obj === null) return;
      for (const [key, value] of Object.entries(obj)) {
        if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
          obj[key] = "[REDACTED]";
        } else if (typeof value === 'object') {
          redact(value);
        }
      }
    };
    redact(sanitizedParams);
  }

  try {
    await db.insert(audit_logs).values({
      user_id: record.userId,
      server_id: record.serverId,
      namespaced_tool: record.namespacedTool,
      tool_name: record.toolName,
      request_params: sanitizedParams,
      outcome: record.outcome,
      error_message: record.errorMessage,
      duration_ms: record.durationMs,
      source: record.source,
      started_at: record.startedAt,
      completed_at: record.completedAt
    });
  } catch (err) {
    console.error("Failed to write audit log:", err);
  }
}
