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

const ACTION_META: Record<string, { label: string; tone: "success" | "critical" | "info" | "neutral" }> = {
  "decision.created": { label: "Recorded a decision", tone: "info" },
  "decision.approved": { label: "Merchant approved", tone: "success" },
  "decision.rejected": { label: "Merchant rejected", tone: "neutral" },
  "decision.executed": { label: "Executed action", tone: "success" },
  "decision.execution_failed": { label: "Action failed", tone: "critical" },
  "agent.created": { label: "Employee created", tone: "info" },
};
const DEFAULT_ACTION_META = { label: undefined, tone: "neutral" as const };

/** Locale pinned so server-rendered and client-hydrated timestamps always match; audit timestamps also read better as an unambiguous absolute time than a locale-varying one. */
function formatTimestamp(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function executionError(action: string, detail: string) {
  if (action !== "decision.execution_failed") return null;
  try {
    const parsed = JSON.parse(detail) as { error?: string };
    return parsed.error ?? null;
  } catch {
    return null;
  }
}

export default function Activity() {
  const { logs } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Activity Log">
      <s-section heading={`Last ${logs.length} events`}>
        <s-stack direction="block" gap="small">
          {logs.length === 0 && (
            <s-text color="subdued">No activity yet. Run a scan from the AI Workforce page.</s-text>
          )}
          {logs.map((log) => {
            const meta = ACTION_META[log.action] ?? { label: log.action, tone: DEFAULT_ACTION_META.tone };
            const error = executionError(log.action, log.detail);

            return (
              <s-box key={log.id} padding="small" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-text type="strong">{log.agentName}</s-text>
                    <s-badge tone={meta.tone}>{meta.label}</s-badge>
                    <s-text color="subdued">{formatTimestamp(new Date(log.createdAt))}</s-text>
                  </s-stack>
                  {error && (
                    <span style={{ color: "var(--p-color-text-critical, #b30000)" }}>{error}</span>
                  )}
                  <s-box padding="small" background="subdued" borderRadius="base">
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      <code>{formatDetail(log.detail)}</code>
                    </pre>
                  </s-box>
                </s-stack>
              </s-box>
            );
          })}
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
