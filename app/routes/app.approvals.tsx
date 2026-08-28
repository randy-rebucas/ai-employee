import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  executeApprovedDecision,
  setDecisionApproval,
} from "../agents/orchestrator.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const decisions = await db.decision.findMany({
    where: { shop, approvalStatus: "pending" },
    orderBy: { createdAt: "desc" },
    include: { agent: true, task: true },
  });

  return { decisions };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const decisionId = String(formData.get("decisionId"));
  const intent = String(formData.get("intent"));

  if (intent === "approve") {
    await setDecisionApproval(shop, decisionId, true);
    await executeApprovedDecision(shop, admin, decisionId);
  } else if (intent === "reject") {
    await setDecisionApproval(shop, decisionId, false);
  }

  return { ok: true };
};

export default function Approvals() {
  const { decisions } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  return (
    <s-page heading="Approvals">
      <s-section heading={`Pending (${decisions.length})`}>
        <s-stack direction="block" gap="base">
          {decisions.length === 0 && (
            <s-text color="subdued">Nothing waiting on you right now.</s-text>
          )}
          {decisions.map((decision) => (
            <s-box
              key={decision.id}
              padding="base"
              borderWidth="base"
              borderRadius="base"
            >
              <s-stack direction="block" gap="small">
                <s-text color="subdued">
                  {decision.agent.name} - {decision.task.title}
                </s-text>
                <s-text>{decision.situation}</s-text>
                <s-text>Proposed action: {decision.recommendation}</s-text>
                <s-badge>Confidence {decision.confidence}%</s-badge>
                <s-stack direction="inline" gap="small">
                  <s-button
                    onClick={() =>
                      fetcher.submit(
                        { decisionId: decision.id, intent: "approve" },
                        { method: "POST" },
                      )
                    }
                  >
                    Approve
                  </s-button>
                  <s-button
                    variant="tertiary"
                    onClick={() =>
                      fetcher.submit(
                        { decisionId: decision.id, intent: "reject" },
                        { method: "POST" },
                      )
                    }
                  >
                    Reject
                  </s-button>
                </s-stack>
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}
