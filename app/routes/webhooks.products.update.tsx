import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureDefaultAgents, handleProductUpdatedEvent } from "../agents/orchestrator.server";

interface ProductUpdatePayload {
  id?: string | number;
  title?: string;
  variants?: { id?: string | number; title?: string; inventory_quantity?: number }[];
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  await ensureDefaultAgents(shop);
  await handleProductUpdatedEvent(shop, payload as ProductUpdatePayload);

  return new Response();
};
