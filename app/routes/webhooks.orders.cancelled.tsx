import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureDefaultAgents, handleOrderCancelledEvent } from "../agents/orchestrator.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  await ensureDefaultAgents(shop);
  await handleOrderCancelledEvent(shop, payload as { id?: string | number; name?: string; cancel_reason?: string | null });

  return new Response();
};
