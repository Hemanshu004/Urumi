import { db } from "../db/index.js";
import { role_permissions } from "../db/schema.js";



import { and, eq } from "drizzle-orm";

export async function isToolAllowed(role: string, toolName: string): Promise<boolean> {
  if (role === "admin") {
    return true;
  }
  
  try {
    const perm = await db.select().from(role_permissions).where(
      and(eq(role_permissions.role, role), eq(role_permissions.namespaced_tool, toolName))
    );
    return perm.length > 0;
  } catch (err) {
    return false;
  }
}
