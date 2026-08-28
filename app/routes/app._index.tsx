import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  ensureDefaultAgents,
  runChiefOfStaffSynthesis,
  runCustomerSuccessCheck,
  runFinanceRevenueCheck,
  runInventoryForecast,
  runMarketingAnalysis,
  runOperationsInventoryCheck,
  runProductCatalogCheck,
} from "../agents/orchestrator.server";
import db from "../db.server";

const DEPARTMENT_COLORS: Record<string, string> = {
  Executive: "#6b46c1",
  Operations: "#2563eb",
  Finance: "#059669",
  Merchandising: "#d97706",
  Support: "#db2777",
  Marketing: "#dc2626",
  Sales: "#0891b2",
  Inventory: "#0d9488",
};
const DEFAULT_AVATAR_COLOR = "#4b5563";

/** A simple person-silhouette icon, like a profile picture, shown on a department-colored circle. */
function PersonIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="white" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8v1H4v-1z" />
    </svg>
  );
}

function relativeTime(date: Date | null) {
  if (!date) return "No activity yet";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  await ensureDefaultAgents(shop);

  const agents = await db.agent.findMany({
    where: { shop },
    orderBy: { createdAt: "asc" },
    include: {
      tasks: { orderBy: { createdAt: "desc" } },
      decisions: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const pendingApprovals = await db.decision.count({
    where: { shop, approvalStatus: "pending" },
  });

  const agentCards = await Promise.all(
    agents.map(async (agent) => {
      const openTasks = agent.tasks.filter((t) =>
        ["pending", "running", "waiting_approval", "blocked"].includes(t.status),
      );
      const agentPendingApprovals = await db.decision.count({
        where: { shop, agentId: agent.id, approvalStatus: "pending" },
      });

      let status: "attention" | "working" | "healthy" | "not_started" = "not_started";
      if (agentPendingApprovals > 0) status = "attention";
      else if (openTasks.length > 0) status = "working";
      else if (agent.tasks.length > 0) status = "healthy";

      const currentTask = agent.tasks[0]?.title ?? null;
      const lastActivityAt = agent.tasks[0]?.createdAt ?? null;
      const recommendations = await db.decision.count({ where: { shop, agentId: agent.id } });
      const approved = await db.decision.count({
        where: { shop, agentId: agent.id, approvalStatus: "approved" },
      });

      return {
        id: agent.id,
        name: agent.name,
        jobTitle: agent.jobTitle,
        department: agent.department,
        isCustom: agent.isCustom,
        status,
        currentTask,
        taskCount: agent.tasks.length,
        alerts: agentPendingApprovals,
        lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
        recommendations,
        approved,
      };
    }),
  );

  return { agentCards, pendingApprovals };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  await ensureDefaultAgents(shop);
  const [operations, finance, product, customerSuccess, marketing, inventory] = await Promise.all([
    runOperationsInventoryCheck(shop, admin),
    runFinanceRevenueCheck(shop, admin),
    runProductCatalogCheck(shop, admin),
    runCustomerSuccessCheck(shop, admin),
    runMarketingAnalysis(shop, admin),
    runInventoryForecast(shop, admin),
  ]);
  const assessment = await runChiefOfStaffSynthesis(shop);
  return { operations, finance, product, customerSuccess, marketing, inventory, assessment };
};

const STATUS_META: Record<
  string,
  { label: string; tone: "success" | "info" | "warning" | "neutral"; dot: string }
> = {
  attention: { label: "Attention", tone: "warning", dot: "#d97706" },
  working: { label: "Working", tone: "info", dot: "#2563eb" },
  healthy: { label: "Healthy", tone: "success", dot: "#16a34a" },
  not_started: { label: "Not started", tone: "neutral", dot: "#9ca3af" },
};

export default function Index() {
  const { agentCards, pendingApprovals } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const isRunning = fetcher.state !== "idle";

  return (
    <s-page heading="AI Workforce">
      <s-button
        slot="primary-action"
        onClick={() => fetcher.submit({}, { method: "POST" })}
        {...(isRunning ? { loading: true } : {})}
      >
        Run AI team scan
      </s-button>
      <s-button slot="secondary-actions" href="/app/workforce/new">
        + Create AI Employee
      </s-button>
      <s-button slot="secondary-actions" href="/app/briefing">
        View Daily Briefing
      </s-button>

      {pendingApprovals > 0 && (
        <s-banner tone="warning" heading={`${pendingApprovals} decision(s) awaiting your approval`}>
          <s-link href="/app/approvals">Review approvals</s-link>
        </s-banner>
      )}

      {fetcher.data?.operations && (
        <s-banner tone="info" heading="Scan complete">
          Operations: scanned {fetcher.data.operations.scanned} products,
          flagged {fetcher.data.operations.flagged} as low stock. Finance:
          reviewed {fetcher.data.finance.ordersScanned} orders,{" "}
          {fetcher.data.finance.flagged ? "found issues to review" : "no issues found"}.
          {" "}Product: audited {fetcher.data.product.scanned} listings, flagged{" "}
          {fetcher.data.product.flagged} with gaps.{" "}
          Customer Success: reviewed {fetcher.data.customerSuccess.ordersScanned}{" "}
          orders,{" "}
          {fetcher.data.customerSuccess.flagged ? "found issues to review" : "no issues found"}.{" "}
          Marketing: found {fetcher.data.marketing.abandonedCheckoutCount} abandoned checkouts,{" "}
          {fetcher.data.marketing.flagged ? "worth a look" : "within normal range"}.{" "}
          Inventory: scanned {fetcher.data.inventory.scanned} variants,{" "}
          {fetcher.data.inventory.stockoutRiskCount} at stockout risk,{" "}
          {fetcher.data.inventory.deadStockCount} dead stock.
          {fetcher.data.assessment && (
            <> Chief of Staff: {fetcher.data.assessment.situation}</>
          )}
        </s-banner>
      )}

      <s-section heading="Your team">
        <s-stack direction="block" gap="base">
          {agentCards.map((agent) => {
            const avatarColor = DEPARTMENT_COLORS[agent.department] ?? DEFAULT_AVATAR_COLOR;
            const statusMeta = STATUS_META[agent.status];

            return (
              <s-box key={agent.id} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="inline" gap="base" alignItems="center">
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      minWidth: 48,
                      borderRadius: "50%",
                      background: avatarColor,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      position: "relative",
                    }}
                  >
                    <PersonIcon />
                    <span
                      style={{
                        position: "absolute",
                        bottom: -1,
                        right: -1,
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        background: statusMeta.dot,
                        border: "2px solid var(--p-color-bg-surface, white)",
                      }}
                    />
                  </div>

                  <s-stack direction="block" gap="small">
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-link href={`/app/workforce/${agent.id}`}>
                        <s-heading>{agent.name}</s-heading>
                      </s-link>
                      <s-badge tone={statusMeta.tone}>{statusMeta.label}</s-badge>
                      {agent.isCustom && <s-badge tone="info">Custom</s-badge>}
                    </s-stack>
                    <s-text color="subdued">
                      {agent.jobTitle} - {agent.department}
                    </s-text>
                    <s-text>
                      {agent.currentTask
                        ? `Current: ${agent.currentTask}`
                        : "No tasks yet - run a scan to get started."}
                    </s-text>
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-badge>{agent.taskCount} task{agent.taskCount === 1 ? "" : "s"}</s-badge>
                      {agent.alerts > 0 && (
                        <s-badge tone="warning">{agent.alerts} alert{agent.alerts === 1 ? "" : "s"}</s-badge>
                      )}
                      <s-text color="subdued">
                        Last activity: {relativeTime(agent.lastActivityAt ? new Date(agent.lastActivityAt) : null)}
                      </s-text>
                    </s-stack>
                    {agent.recommendations > 0 && (
                      <s-text color="subdued">
                        {agent.recommendations} recommendation{agent.recommendations === 1 ? "" : "s"} -{" "}
                        {agent.approved} approved
                      </s-text>
                    )}
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

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
