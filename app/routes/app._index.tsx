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

const SKIN_TONES = ["#f4c9a5", "#e0a878", "#c58a5c", "#8d5a3c", "#6b4226"];
const HAIR_COLORS = ["#2b2118", "#4a2f22", "#7a4a2b", "#1c1c1c", "#a15a2e", "#3d3d3d"];

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** A small illustrated head-and-shoulders avatar, varied per person id via skin tone, hair color/style, and short vs. long hair - not tied to department. */
function PersonAvatar({ seed }: { seed: string }) {
  const hash = hashString(seed);
  const skin = SKIN_TONES[hash % SKIN_TONES.length];
  const hair = HAIR_COLORS[Math.floor(hash / SKIN_TONES.length) % HAIR_COLORS.length];
  const longHair = hash % 2 === 0;

  return (
    <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="24" fill="#eef0f2" />
      {longHair && <path d="M10 30c0-10 4-18 14-18s14 8 14 18v6H10v-6z" fill={hair} />}
      <path d="M14 40c0-7.7 4.5-12 10-12s10 4.3 10 12v2H14v-2z" fill="#d7dade" />
      <circle cx="24" cy="21" r="9" fill={skin} />
      <path
        d={
          longHair
            ? "M15 20c0-6 4-10.5 9-10.5s9 4.5 9 10.5c0-2-1-3.5-2.5-3.5-1.2 0-1.5 1-3 1-2 0-2-2-4.5-2s-2.5 2-4.5 2c-1.5 0-1.8-1-3-1C16 16.5 15 18 15 20z"
            : "M15 18c0-5.5 4-9.5 9-9.5s9 4 9 9.5c0-1.5-.8-2.5-2-2.5-3.5 0-9.5 0-14 0-1.2 0-2 1-2 2.5z"
        }
        fill={hair}
      />
    </svg>
  );
}

const RUNNABLE_DEPARTMENT_KEYS = new Set([
  "operations-manager",
  "finance-manager",
  "product-manager",
  "customer-success",
  "marketing-manager",
  "inventory-manager",
]);

const RESULT_LABELS: Record<string, { icon: string; title: string }> = {
  operations: { icon: "📦", title: "Operations" },
  finance: { icon: "💰", title: "Finance" },
  product: { icon: "🛍️", title: "Product Catalog" },
  customerSuccess: { icon: "💬", title: "Customer Success" },
  marketing: { icon: "📣", title: "Marketing" },
  inventory: { icon: "📊", title: "Inventory" },
};

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
        key: agent.key,
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

  const stats = {
    totalAgents: agentCards.length,
    activeAgents: agentCards.filter((a) => a.status === "working" || a.status === "attention").length,
    openTasks: agentCards.reduce((sum, a) => sum + (a.currentTask ? 1 : 0), 0),
    totalRecommendations: agentCards.reduce((sum, a) => sum + a.recommendations, 0),
    totalApproved: agentCards.reduce((sum, a) => sum + a.approved, 0),
  };

  return { agentCards, pendingApprovals, stats };
};

const AGENT_KEY_RUNNERS: Record<string, (shop: string, admin: any) => Promise<unknown>> = {
  "operations-manager": runOperationsInventoryCheck,
  "finance-manager": runFinanceRevenueCheck,
  "product-manager": runProductCatalogCheck,
  "customer-success": runCustomerSuccessCheck,
  "marketing-manager": runMarketingAnalysis,
  "inventory-manager": runInventoryForecast,
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  await ensureDefaultAgents(shop);

  const formData = await request.formData();
  const agentKey = formData.get("agentKey");

  if (typeof agentKey === "string" && AGENT_KEY_RUNNERS[agentKey]) {
    const result = await AGENT_KEY_RUNNERS[agentKey](shop, admin);
    return { single: { key: agentKey, result } };
  }

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

type AgentCard = ReturnType<typeof useLoaderData<typeof loader>>["agentCards"][number];

function StatTile({ label, value, tone }: { label: string; value: number | string; tone?: "warning" | "success" }) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base" inlineSize="100%">
      <s-stack direction="block" gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
        {tone && <s-badge tone={tone}>{tone === "warning" ? "Needs review" : "Good"}</s-badge>}
      </s-stack>
    </s-box>
  );
}

function ScanResultCard({ id, result }: { id: string; result: any }) {
  const meta = RESULT_LABELS[id] ?? { icon: "🔎", title: id };
  const flagged =
    typeof result?.flagged === "number"
      ? result.flagged
      : typeof result?.flagged === "boolean"
        ? Number(result.flagged)
        : (result?.stockoutRiskCount ?? 0) + (result?.deadStockCount ?? 0);

  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="small-200">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-text>{meta.icon}</s-text>
          <s-heading>{meta.title}</s-heading>
          {flagged > 0 ? (
            <s-badge tone="warning">{flagged} flagged</s-badge>
          ) : (
            <s-badge tone="success">All clear</s-badge>
          )}
        </s-stack>
        <s-stack direction="inline" gap="base">
          {"scanned" in result && <s-text color="subdued">Scanned: {result.scanned}</s-text>}
          {"ordersScanned" in result && <s-text color="subdued">Orders: {result.ordersScanned}</s-text>}
          {"abandonedCheckoutCount" in result && (
            <s-text color="subdued">Abandoned checkouts: {result.abandonedCheckoutCount}</s-text>
          )}
          {"stockoutRiskCount" in result && (
            <s-text color="subdued">Stockout risk: {result.stockoutRiskCount}</s-text>
          )}
          {"deadStockCount" in result && (
            <s-text color="subdued">Dead stock: {result.deadStockCount}</s-text>
          )}
        </s-stack>
      </s-stack>
    </s-box>
  );
}

function AgentAvatar({ id, department, status }: { id: string; department: string; status: AgentCard["status"] }) {
  const ringColor = DEPARTMENT_COLORS[department] ?? DEFAULT_AVATAR_COLOR;
  const statusMeta = STATUS_META[status];

  return (
    <div
      style={{
        width: 48,
        height: 48,
        minWidth: 48,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        boxShadow: `0 0 0 2px ${ringColor}`,
        overflow: "hidden",
      }}
      title={department}
    >
      <PersonAvatar seed={id} />
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
  );
}

function AgentCardRow({ agent }: { agent: AgentCard }) {
  const runFetcher = useFetcher();
  const isRunningThis = runFetcher.state !== "idle";
  const statusMeta = STATUS_META[agent.status];
  const canRunDirectly = RUNNABLE_DEPARTMENT_KEYS.has(agent.key);

  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="base" alignItems="center">
          <AgentAvatar id={agent.id} department={agent.department} status={agent.status} />

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

        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
          {canRunDirectly && (
            <s-button
              variant="secondary"
              onClick={() => runFetcher.submit({ agentKey: agent.key }, { method: "POST" })}
              {...(isRunningThis ? { loading: true } : {})}
            >
              Run scan
            </s-button>
          )}
          <s-button variant="tertiary" href={`/app/workforce/${agent.id}`}>
            View details
          </s-button>
        </div>
      </s-stack>
    </s-box>
  );
}

export default function Index() {
  const { agentCards, pendingApprovals, stats } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const isRunning = fetcher.state !== "idle";
  const data = fetcher.data as any;
  const fullScanResults =
    data && !data.single
      ? (["operations", "finance", "product", "customerSuccess", "marketing", "inventory"] as const)
          .filter((key) => data[key])
          .map((key) => ({ id: key, result: data[key] }))
      : [];

  return (
    <s-page heading="AI Workforce" inlineSize="large">
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

      <s-section heading="Overview">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "var(--p-space-400, 16px)",
          }}
        >
          <StatTile label="AI employees" value={stats.totalAgents} />
          <StatTile label="Currently active" value={stats.activeAgents} />
          <StatTile label="Open tasks" value={stats.openTasks} />
          <StatTile label="Pending approvals" value={pendingApprovals} tone={pendingApprovals > 0 ? "warning" : undefined} />
          <StatTile label="Recommendations" value={stats.totalRecommendations} />
          <StatTile label="Approved" value={stats.totalApproved} tone={stats.totalApproved > 0 ? "success" : undefined} />
        </div>
      </s-section>

      {fullScanResults.length > 0 && (
        <s-section heading="Latest scan results">
          <s-stack direction="block" gap="base">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--p-space-400, 16px)" }}>
              {fullScanResults.map(({ id, result }) => (
                <div key={id} style={{ flex: "1 1 260px" }}>
                  <ScanResultCard id={id} result={result} />
                </div>
              ))}
            </div>
            {data?.assessment && (
              <s-banner tone="info" heading="Chief of Staff assessment">
                {data.assessment.situation}
              </s-banner>
            )}
          </s-stack>
        </s-section>
      )}

      {data?.single && (
        <s-section heading="Scan result">
          <ScanResultCard
            id={
              Object.entries(AGENT_KEY_RUNNERS_UI).find(([, key]) => key === data.single.key)?.[0] ??
              data.single.key
            }
            result={data.single.result}
          />
        </s-section>
      )}

      <s-section heading="Your team">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: "var(--p-space-400, 16px)",
          }}
        >
          {agentCards.map((agent) => (
            <AgentCardRow key={agent.id} agent={agent} />
          ))}
        </div>
      </s-section>
    </s-page>
  );
}

const AGENT_KEY_RUNNERS_UI: Record<string, string> = {
  operations: "operations-manager",
  finance: "finance-manager",
  product: "product-manager",
  customerSuccess: "customer-success",
  marketing: "marketing-manager",
  inventory: "inventory-manager",
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
