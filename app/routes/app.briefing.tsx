import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { buildDailyBriefing, ensureDefaultAgents } from "../agents/orchestrator.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  await ensureDefaultAgents(shop);
  const briefing = await buildDailyBriefing(shop);
  return { briefing, shop };
};

type BriefingItem = Awaited<ReturnType<typeof buildDailyBriefing>>["items"][number];

function BriefingItemCard({ item, tone }: { item: BriefingItem; tone: "warning" | "success" }) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="small">
        <s-text color="subdued">
          {item.agentName} - {item.department}
        </s-text>
        <s-text>{item.situation}</s-text>
        {tone === "warning" && <s-text>Recommendation: {item.recommendation}</s-text>}
        <s-badge tone={tone}>Confidence {item.confidence}%</s-badge>
      </s-stack>
    </s-box>
  );
}

export default function Briefing() {
  const { briefing } = useLoaderData<typeof loader>();
  const attentionItems = briefing.items.filter((i: BriefingItem) => i.needsAttention);
  const healthyItems = briefing.items.filter((i: BriefingItem) => !i.needsAttention);

  return (
    <s-page heading="Daily Store Briefing">
      {briefing.items.length === 0 && (
        <s-banner tone="info" heading="No data yet">
          Run a scan from the AI Workforce page to generate your first
          briefing.
        </s-banner>
      )}

      {briefing.assessment && (
        <s-section heading="Chief of Staff assessment">
          <s-stack direction="block" gap="small">
            <s-text>{briefing.assessment.situation}</s-text>
            {briefing.assessment.priorities && (
              <s-text color="subdued">{briefing.assessment.priorities}</s-text>
            )}
            <s-badge>Confidence {briefing.assessment.confidence}%</s-badge>
          </s-stack>
        </s-section>
      )}

      {briefing.pendingApprovals > 0 && (
        <s-banner
          tone="warning"
          heading={`${briefing.pendingApprovals} decision(s) awaiting your approval`}
        >
          <s-link href="/app/approvals">Review approvals</s-link>
        </s-banner>
      )}

      {attentionItems.length > 0 && (
        <s-section heading="Needs your attention">
          <s-stack direction="block" gap="base">
            {attentionItems.map((item) => (
              <BriefingItemCard key={item.decisionId} item={item} tone="warning" />
            ))}
          </s-stack>
        </s-section>
      )}

      {healthyItems.length > 0 && (
        <s-section heading="Everything else">
          <s-stack direction="block" gap="base">
            {healthyItems.map((item) => (
              <BriefingItemCard key={item.decisionId} item={item} tone="success" />
            ))}
          </s-stack>
        </s-section>
      )}

      <s-section slot="aside" heading="Take action">
        <s-stack direction="block" gap="small">
          <s-link href="/app/approvals">Go to Approvals</s-link>
          <s-link href="/app">Go to AI Workforce</s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}
