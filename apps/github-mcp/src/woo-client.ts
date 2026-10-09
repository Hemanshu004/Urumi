import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import dotenv from "dotenv";

dotenv.config();

const url = process.env.WOOCOMMERCE_URL || "http://urumi-wordpress";
const consumerKey = process.env.WOOCOMMERCE_CONSUMER_KEY || "";
const consumerSecret = process.env.WOOCOMMERCE_CONSUMER_SECRET || "";

if (!url || !consumerKey || !consumerSecret) {
  console.warn("WARNING: WooCommerce credentials are not fully configured in environment variables.");
}

// The standard woocommerce-rest-api is CJS, in some versions it exports default, in others it doesn't.
// We handle both forms just in case.
const ApiConstructor = (WooCommerceRestApi as any).default || WooCommerceRestApi;

export const wooClient = new ApiConstructor({
  url: url,
  consumerKey: consumerKey,
  consumerSecret: consumerSecret,
  version: "wc/v3",
  queryStringAuth: true // Required for HTTP without HTTPS
});

// Helper for mapping WooCommerce errors
export function handleWooError(error: any): never {
  if (error.response && error.response.data) {
    throw new Error(`WooCommerce API Error: ${error.response.data.message || JSON.stringify(error.response.data)}`);
  }
  throw new Error(`WooCommerce Connection Error: ${error.message}`);
}
