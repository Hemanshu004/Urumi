import { wooClient, handleWooError } from "../woo-client.js";

export const ordersTools = [
  {
    name: "list_orders",
    description: "List orders from WooCommerce",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "number" },
        per_page: { type: "number" },
        after: { type: "string", description: "Filter by date after (ISO 8601)" }
      }
    }
  },
  {
    name: "get_order",
    description: "Get an order by ID",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" }
      },
      required: ["id"]
    }
  },
  {
    name: "update_order_status",
    description: "Update order status",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        status: { type: "string", enum: ["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed", "trash"] }
      },
      required: ["id", "status"]
    }
  }
];

export async function handleOrdersToolCall(name: string, args: any) {
  try {
    if (name === "list_orders") {
      const params: any = {
        page: args.page || 1,
        per_page: args.per_page || 10
      };
      if (args.after) params.after = args.after;

      const response = await wooClient.get("orders", params);
      const orders = response.data.map((o: any) => ({
        id: o.id,
        status: o.status,
        date_created: o.date_created,
        total: o.total,
        currency: o.currency,
        billing: o.billing
      }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify(orders, null, 2) }]
      };
    }

    if (name === "get_order") {
      const response = await wooClient.get(`orders/${args.id}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(response.data, null, 2) }]
      };
    }

    if (name === "update_order_status") {
      const response = await wooClient.put(`orders/${args.id}`, { status: args.status });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(response.data, null, 2) }]
      };
    }

    throw new Error(`Unknown order tool: ${name}`);
  } catch (error) {
    return handleWooError(error);
  }
}
