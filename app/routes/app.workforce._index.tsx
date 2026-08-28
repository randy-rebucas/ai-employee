import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

/**
 * The AI Workforce dashboard now lives at /app (Home) - this route existed
 * as a near-duplicate page before they were merged. Kept as a redirect so
 * old links/bookmarks don't 404; /app/workforce/:agentId and
 * /app/workforce/new are untouched, separate routes.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { redirect } = await authenticate.admin(request);
  return redirect("/app");
};
