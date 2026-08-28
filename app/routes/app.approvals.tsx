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
    try {
      await executeApprovedDecision(shop, admin, decisionId);
    } catch (error) {
      // The approval itself succeeded and is recorded either way; only the
      // Shopify-side execution failed (already logged to executionResult and
      // AuditLog by executeApprovedDecision). Surface it instead of crashing
      // the page, since the decision has already left the pending list.
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, decisionId, error: message };
    }
  } else if (intent === "reject") {
    await setDecisionApproval(shop, decisionId, false);
  }

  return { ok: true, decisionId };
};

export default function Approvals() {
  const { decisions } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const isSubmitting = fetcher.state !== "idle";
  const submittingId = fetcher.formData?.get("decisionId");
  const submittingIntent = fetcher.formData?.get("intent");
  const failure = fetcher.data && "error" in fetcher.data ? fetcher.data : null;

  return (
    <s-page heading="Approvals">
      {failure && (
        <s-banner tone="critical" heading="Approved, but the action failed to run">
          <s-stack direction="block" gap="small">
            <s-text>{failure.error}</s-text>
            <s-link href="/app/activity">View the Activity log for details</s-link>
          </s-stack>
        </s-banner>
      )}

      <s-section heading={`Pending (${decisions.length})`}>
        <s-stack direction="block" gap="base">
          {decisions.length === 0 && (
            <s-text color="subdued">Nothing waiting on you right now.</s-text>
          )}
          {decisions.map((decision) => {
            const isThisRow = submittingId === decision.id;
            const isApproving = isThisRow && submittingIntent === "approve";
            const isRejecting = isThisRow && submittingIntent === "reject";

            return (
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
                      disabled={isSubmitting}
                      {...(isApproving ? { loading: true } : {})}
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
                      disabled={isSubmitting}
                      {...(isRejecting ? { loading: true } : {})}
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
            );
          })}
        </s-stack>
      </s-section>
    </s-page>
  );
}
