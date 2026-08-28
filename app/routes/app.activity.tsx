import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const logs = await db.auditLog.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const agents = await db.agent.findMany({ where: { shop } });
  const agentNameById = new Map(agents.map((a) => [a.id, a.name]));

  return {
    logs: logs.map((log) => ({
      id: log.id,
      agentName: log.agentId ? agentNameById.get(log.agentId) ?? "Unknown agent" : "System",
      action: log.action,
      detail: log.detail,
      createdAt: log.createdAt,
    })),
  };
};

const ACTION_LABELS: Record<string, string> = {
  "decision.created": "Recorded a decision",
  "decision.approved": "Merchant approved",
  "decision.rejected": "Merchant rejected",
  "decision.executed": "Executed action",
  "decision.execution_failed": "Action failed",
  "agent.created": "Employee created",
};

export default function Activity() {
  const { logs } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Activity Log">
      <s-section heading={`Last ${logs.length} events`}>
        <s-stack direction="block" gap="small">
          {logs.length === 0 && (
            <s-text color="subdued">No activity yet. Run a scan from the AI Workforce page.</s-text>
          )}
          {logs.map((log) => (
            <s-box key={log.id} padding="small" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-text type="strong">{log.agentName}</s-text>
                  <s-badge>{ACTION_LABELS[log.action] ?? log.action}</s-badge>
                  <s-text color="subdued">
                    {new Date(log.createdAt).toLocaleString()}
                  </s-text>
                </s-stack>
                <s-box padding="small" background="subdued" borderRadius="base">
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    <code>{formatDetail(log.detail)}</code>
                  </pre>
                </s-box>
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

function formatDetail(detail: string) {
  try {
    return JSON.stringify(JSON.parse(detail), null, 2);
  } catch {
    return detail;
  }
}
