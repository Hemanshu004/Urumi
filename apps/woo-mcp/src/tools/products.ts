import { wooClient, handleWooError } from "../woo-client.js";
import { z } from "zod";

export const productsTools = [
  {
    name: "list_products",
    description: "List products from WooCommerce",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "number", description: "Page number for pagination" },
        per_page: { type: "number", description: "Number of products per page" }
      }
    }
  },
  {
    name: "create_product",
    description: "Create a new product in WooCommerce",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        regular_price: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: ["draft", "pending", "private", "publish"] }
      },
      required: ["name", "regular_price"]
    }
  },
  {
    name: "get_product",
    description: "Get a product by ID from WooCommerce",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" }
      },
      required: ["id"]
    }
  }
];

export async function handleProductsToolCall(name: string, args: any) {
  try {
    if (name === "list_products") {
      const page = args.page || 1;
      const per_page = args.per_page || 10;
      const response = await wooClient.get("products", { page, per_page });
      const products = response.data.map((p: any) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        status: p.status,
        stock_status: p.stock_status
      }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify(products, null, 2) }]
      };
    }

    if (name === "create_product") {
      const data = {
        name: args.name,
        regular_price: args.regular_price,
        description: args.description || "",
        status: args.status || "publish"
      };
      const response = await wooClient.post("products", data);
      const p = response.data;
      return {
        content: [{
          type: "text" as const, text: JSON.stringify({
            id: p.id,
            name: p.name,
            price: p.price,
            status: p.status,
            stock_status: p.stock_status
          }, null, 2)
        }]
      };
    }

    if (name === "get_product") {
      const response = await wooClient.get(`products/${args.id}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(response.data, null, 2) }]
      };
    }

    throw new Error(`Unknown product tool: ${name}`);
  } catch (error) {
    return handleWooError(error);
  }
}
