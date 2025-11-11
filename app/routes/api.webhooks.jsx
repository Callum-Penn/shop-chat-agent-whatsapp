import { authenticate } from "../shopify.server";
import db from "../db.server";
import { json } from "@remix-run/node";

export const action = async ({ request }) => {
  const topic = request.headers.get("X-Shopify-Topic") || "unknown";
  const shop = request.headers.get("X-Shopify-Shop-Domain") || "unknown";

  // Respond quickly to Shopify
  return json({ success: true });
};
