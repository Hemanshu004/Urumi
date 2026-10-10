const MEMBER_ALLOW_LIST = new Set([
  "woocommerce__list_products",
  "woocommerce__list_orders",
  "woocommerce__get_order",
  "github__list_issues",
  "weather__get_weather"
]);

export function isToolAllowed(role: string, toolName: string): boolean {
  if (role === "admin") {
    return true;
  }
  
  if (role === "member") {
    return MEMBER_ALLOW_LIST.has(toolName);
  }
  
  return false;
}
