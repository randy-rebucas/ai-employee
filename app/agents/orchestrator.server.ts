import db from "../db.server";
import { authenticate } from "../shopify.server";
import {
  ACTION_POLICIES,
  assertActionPermitted,
  getEffectiveActionPolicy,
  type ActionType,
} from "./permissions.server";

type AdminApiContext = Awaited<
  ReturnType<typeof authenticate.admin>
>["admin"];

export const AGENT_DEFINITIONS = [
  {
    key: "chief-of-staff",
    name: "Chief of Staff",
    jobTitle: "Chief of Staff",
    department: "Executive",
    description:
      "Coordinates the AI workforce, prioritizes findings, and prepares the daily briefing.",
    autonomy: "advisor",
  },
  {
    key: "operations-manager",
    name: "Operations Manager",
    jobTitle: "Operations Manager",
    department: "Operations",
    description:
      "Monitors inventory levels and flags products at risk of stocking out.",
    autonomy: "draft",
  },
  {
    key: "finance-manager",
    name: "Finance Manager",
    jobTitle: "Finance Manager",
    department: "Finance",
    description:
      "Tracks revenue and discount trends and flags margin risk before it becomes a problem.",
    autonomy: "advisor",
  },
  {
    key: "product-manager",
    name: "Product Manager",
    jobTitle: "Product Manager",
    department: "Merchandising",
    description:
      "Audits the catalog for missing descriptions, images, and other listing gaps that hurt conversion.",
    autonomy: "advisor",
  },
  {
    key: "customer-success",
    name: "Customer Success",
    jobTitle: "Customer Success Manager",
    department: "Support",
    description:
      "Watches order cancellations and repeat purchase rate to catch satisfaction problems early.",
    autonomy: "advisor",
  },
  {
    key: "marketing-manager",
    name: "Marketing Manager",
    jobTitle: "Marketing Manager",
    department: "Marketing",
    description:
      "Watches abandoned checkouts and sales velocity to recommend what to promote and where revenue is being left on the table.",
    autonomy: "advisor",
  },
  {
    key: "inventory-manager",
    name: "Inventory Manager",
    jobTitle: "Inventory Manager",
    department: "Inventory",
    description:
      "Forecasts stockouts from sales velocity and flags dead stock, with concrete reorder-quantity recommendations.",
    autonomy: "advisor",
  },
] as const;

/** Default structured rules seeded per agent. Machine-readable, enforced in code below. */
const DEFAULT_RULES: Record<
  string,
  { key: string; value: unknown; description: string }[]
> = {
  "operations-manager": [
    {
      key: "low_stock_threshold",
      value: 10,
      description: "Flag a variant as low stock when quantity falls below this number of units.",
    },
  ],
  "finance-manager": [
    {
      key: "revenue_decline_alert_percent",
      value: 10,
      description:
        "Raise a finance alert when 7-day revenue drops by at least this percent vs. the prior 7 days.",
    },
    {
      key: "discount_ratio_alert_percent",
      value: 15,
      description:
        "Raise a finance alert when discounts consume at least this percent of gross revenue.",
    },
  ],
  "product-manager": [
    {
      key: "min_description_length",
      value: 40,
      description: "Flag a product whose description is shorter than this many characters.",
    },
  ],
  "customer-success": [
    {
      key: "max_cancellation_rate_percent",
      value: 5,
      description: "Raise an alert when order cancellations exceed this percent of recent orders.",
    },
    {
      key: "min_repeat_rate_percent",
      value: 20,
      description:
        "Raise an alert when the repeat-purchase rate falls below this percent of recent customers.",
    },
  ],
  "marketing-manager": [
    {
      key: "abandoned_checkout_alert_count",
      value: 5,
      description: "Raise an alert when there are at least this many abandoned checkouts in 7 days.",
    },
  ],
  "inventory-manager": [
    {
      key: "stockout_alert_days",
      value: 7,
      description: "Flag a variant when forecasted days-until-stockout falls below this number.",
    },
    {
      key: "reorder_cover_days",
      value: 14,
      description: "Size the recommended reorder to cover this many days of forecasted demand.",
    },
    {
      key: "sales_lookback_days",
      value: 30,
      description: "Window of order history used to compute average daily sales velocity.",
    },
  ],
};

/** Idempotently creates the built-in agents (and their default rules) for a shop. */
export async function ensureDefaultAgents(shop: string) {
  for (const def of AGENT_DEFINITIONS) {
    const agent = await db.agent.upsert({
      where: { shop_key: { shop, key: def.key } },
      update: {},
      create: { shop, ...def },
    });

    for (const rule of DEFAULT_RULES[def.key] ?? []) {
      await db.agentRule.upsert({
        where: { shop_agentId_key: { shop, agentId: agent.id, key: rule.key } },
        update: {},
        create: {
          shop,
          agentId: agent.id,
          key: rule.key,
          value: JSON.stringify(rule.value),
          description: rule.description,
        },
      });
    }
  }
}

const AUTONOMY_LEVELS = ["advisor", "draft", "limited", "autonomous"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export interface CreateCustomAgentInput {
  name: string;
  jobTitle: string;
  department: string;
  description: string;
  instructions: string;
  autonomy: string;
}

/**
 * Creates a merchant-authored AI employee (custom agents, per the product spec).
 * Unlike the built-in
 * agents, custom agents start with no analysis logic of their own - they get
 * a profile, instructions, and a task queue that the Chief of Staff (or the
 * merchant) can assign work to by hand.
 */
export async function createCustomAgent(shop: string, input: CreateCustomAgentInput) {
  const name = input.name.trim();
  if (!name) throw new Error("Name is required");
  if (!AUTONOMY_LEVELS.includes(input.autonomy as AutonomyLevel)) {
    throw new Error("Invalid autonomy level");
  }

  const baseKey = slugify(name) || "custom-agent";
  let key = baseKey;
  let suffix = 1;
  while (await db.agent.findUnique({ where: { shop_key: { shop, key } } })) {
    suffix += 1;
    key = `${baseKey}-${suffix}`;
  }

  const agent = await db.agent.create({
    data: {
      shop,
      key,
      name,
      jobTitle: input.jobTitle.trim() || name,
      department: input.department.trim() || "Custom",
      description: input.description.trim(),
      instructions: input.instructions.trim() || null,
      autonomy: input.autonomy,
      isCustom: true,
    },
  });

  await db.auditLog.create({
    data: {
      shop,
      agentId: agent.id,
      action: "agent.created",
      detail: JSON.stringify({ name, jobTitle: agent.jobTitle, autonomy: agent.autonomy }),
    },
  });

  if (agent.instructions) {
    await db.instructionVersion.create({
      data: {
        shop,
        agentId: agent.id,
        version: 1,
        instructions: agent.instructions,
        changeSummary: "Initial instructions",
      },
    });
  }

  return agent;
}

/**
 * Edits an agent's instructions and snapshots the previous version.
 * Every call bumps instructionsVersion and writes a new InstructionVersion
 * row - the merchant can always see what changed, when, and why.
 */
export async function updateAgentInstructions(
  shop: string,
  agentId: string,
  newInstructions: string,
  changeSummary?: string,
) {
  const agent = await db.agent.findUniqueOrThrow({ where: { id: agentId } });
  if (agent.shop !== shop) {
    throw new Response("Not found", { status: 404 });
  }

  const trimmed = newInstructions.trim();
  const nextVersion = agent.instructionsVersion + 1;

  const updated = await db.agent.update({
    where: { id: agentId },
    data: { instructions: trimmed || null, instructionsVersion: nextVersion },
  });

  await db.instructionVersion.create({
    data: {
      shop,
      agentId,
      version: nextVersion,
      instructions: trimmed,
      changeSummary: changeSummary?.trim() || null,
    },
  });

  await db.auditLog.create({
    data: {
      shop,
      agentId,
      action: "instructions.updated",
      detail: JSON.stringify({ version: nextVersion, changeSummary: changeSummary ?? null }),
    },
  });

  return updated;
}

/** Restores a previous instruction version as a new version (never rewrites history). */
export async function restoreInstructionVersion(shop: string, versionId: string) {
  const version = await db.instructionVersion.findUniqueOrThrow({ where: { id: versionId } });
  if (version.shop !== shop) {
    throw new Response("Not found", { status: 404 });
  }
  return updateAgentInstructions(
    shop,
    version.agentId,
    version.instructions,
    `Restored from version ${version.version}`,
  );
}

const MEMORY_TYPES = ["preference", "fact", "experience", "instruction"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export interface TeachAgentInput {
  agentId: string;
  type: string;
  content: string;
  importance?: number;
  expiresAt?: Date | null;
}

/**
 * "Teaches" an agent something the merchant says (§15) - a preference, a
 * fact, a past experience/outcome, or a one-off instruction. This is
 * deliberately separate from AgentRule: a memory is contextual knowledge fed
 * into the prompt, never a deterministic gate on a Shopify write.
 */
export async function teachAgent(shop: string, input: TeachAgentInput) {
  if (!MEMORY_TYPES.includes(input.type as MemoryType)) {
    throw new Error(`Invalid memory type: ${input.type}`);
  }
  const content = input.content.trim();
  if (!content) throw new Error("Memory content is required");

  const agent = await db.agent.findUniqueOrThrow({ where: { id: input.agentId } });
  if (agent.shop !== shop) {
    throw new Response("Not found", { status: 404 });
  }

  const memory = await db.agentMemory.create({
    data: {
      shop,
      agentId: input.agentId,
      type: input.type,
      content,
      importance: input.importance ?? 3,
      expiresAt: input.expiresAt ?? null,
    },
  });

  await db.auditLog.create({
    data: {
      shop,
      agentId: input.agentId,
      action: "memory.created",
      detail: JSON.stringify({ type: input.type, content }),
    },
  });

  return memory;
}

/** Deletes a memory the merchant no longer wants the agent to rely on. */
export async function forgetMemory(shop: string, memoryId: string) {
  const memory = await db.agentMemory.findUniqueOrThrow({ where: { id: memoryId } });
  if (memory.shop !== shop) {
    throw new Response("Not found", { status: 404 });
  }
  await db.agentMemory.delete({ where: { id: memoryId } });
  await db.auditLog.create({
    data: {
      shop,
      agentId: memory.agentId,
      action: "memory.deleted",
      detail: JSON.stringify({ type: memory.type, content: memory.content }),
    },
  });
}

async function getRuleValue<T>(
  shop: string,
  agentId: string,
  key: string,
  fallback: T,
): Promise<T> {
  const rule = await db.agentRule.findUnique({
    where: { shop_agentId_key: { shop, agentId, key } },
  });
  if (!rule) return fallback;
  try {
    return JSON.parse(rule.value) as T;
  } catch {
    return fallback;
  }
}

interface LowStockVariant {
  productId: string;
  productTitle: string;
  variantId: string;
  variantTitle: string;
  inventoryQuantity: number;
}

/**
 * Operations Manager's real analysis: reads current inventory via the Admin API
 * and flags variants below the low-stock threshold. For each finding it opens a
 * task, records an explainable Decision, and (since this agent runs at "draft"
 * autonomy) proposes a gated Shopify write - tagging the product "low-stock" -
 * that requires merchant approval before it executes.
 */
export async function runOperationsInventoryCheck(
  shop: string,
  admin: AdminApiContext,
) {
  const operationsAgent = await db.agent.findUniqueOrThrow({
    where: { shop_key: { shop, key: "operations-manager" } },
  });
  const lowStockThreshold = await getRuleValue(
    shop,
    operationsAgent.id,
    "low_stock_threshold",
    10,
  );

  const response = await admin.graphql(
    `#graphql
      query LowStockCheck {
        products(first: 25, sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              title
              tags
              variants(first: 10) {
                edges {
                  node {
                    id
                    title
                    inventoryQuantity
                  }
                }
              }
            }
          }
        }
      }`,
  );
  const json = await response.json();
  const products = json.data?.products?.edges ?? [];

  const lowStock: LowStockVariant[] = [];
  const productTagsById = new Map<string, string[]>();
  for (const { node: product } of products) {
    productTagsById.set(product.id, product.tags ?? []);
    for (const { node: variant } of product.variants.edges) {
      if (
        typeof variant.inventoryQuantity === "number" &&
        variant.inventoryQuantity >= 0 &&
        variant.inventoryQuantity < lowStockThreshold
      ) {
        lowStock.push({
          productId: product.id,
          productTitle: product.title,
          variantId: variant.id,
          variantTitle: variant.title,
          inventoryQuantity: variant.inventoryQuantity,
        });
      }
    }
  }

  const createdDecisionIds: string[] = [];
  const tagPolicy = await getEffectiveActionPolicy(shop, operationsAgent.id, "add_product_tag");

  for (const item of lowStock) {
    const task = await db.agentTask.create({
      data: {
        shop,
        agentId: operationsAgent.id,
        title: `Review low stock: ${item.productTitle} (${item.variantTitle})`,
        status: "waiting_approval",
      },
    });

    const alreadyTagged = (productTagsById.get(item.productId) ?? []).includes(
      "low-stock",
    );
    const canProposeAction = !alreadyTagged && (tagPolicy?.enabled ?? true);
    const autoApprove = canProposeAction && tagPolicy?.requiresApproval === false;
    const confidence = Math.min(
      95,
      60 + (lowStockThreshold - item.inventoryQuantity) * 3,
    );

    const decision = await db.decision.create({
      data: {
        shop,
        agentId: operationsAgent.id,
        taskId: task.id,
        situation: `${item.productTitle} - ${item.variantTitle} has ${item.inventoryQuantity} units in stock, below the ${lowStockThreshold}-unit threshold.`,
        dataUsed: JSON.stringify({
          productId: item.productId,
          variantId: item.variantId,
          inventoryQuantity: item.inventoryQuantity,
          threshold: lowStockThreshold,
        }),
        recommendation: alreadyTagged
          ? "Already flagged as low-stock. Recommend reordering soon."
          : "Tag this product 'low-stock' so it's visible across the catalog, and plan a reorder.",
        confidence,
        requiresApproval: canProposeAction && !autoApprove,
        approvalStatus: !canProposeAction ? "none" : autoApprove ? "approved" : "pending",
        actionPayload: canProposeAction
          ? JSON.stringify({
              type: "add_product_tag",
              productId: item.productId,
              tag: "low-stock",
            })
          : null,
      },
    });
    createdDecisionIds.push(decision.id);

    if (autoApprove) {
      await executeApprovedDecision(shop, admin, decision.id);
    }

    await db.auditLog.create({
      data: {
        shop,
        agentId: operationsAgent.id,
        decisionId: decision.id,
        action: "decision.created",
        detail: JSON.stringify({
          situation: decision.situation,
          recommendation: decision.recommendation,
          confidence,
        }),
      },
    });
  }

  return { scanned: products.length, flagged: lowStock.length, createdDecisionIds };
}

/**
 * Finance Manager's real analysis: reads the last 14 days of orders, splits
 * them into this-week/last-week buckets, and compares revenue and discount
 * ratio against the shop's structured rules. Advisor-only (no gated action) -
 * this agent recommends, it never touches the store.
 */
export async function runFinanceRevenueCheck(
  shop: string,
  admin: AdminApiContext,
) {
  const financeAgent = await db.agent.findUniqueOrThrow({
    where: { shop_key: { shop, key: "finance-manager" } },
  });
  const revenueDeclineAlertPercent = await getRuleValue(
    shop,
    financeAgent.id,
    "revenue_decline_alert_percent",
    10,
  );
  const discountRatioAlertPercent = await getRuleValue(
    shop,
    financeAgent.id,
    "discount_ratio_alert_percent",
    15,
  );

  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const response = await admin.graphql(
    `#graphql
      query RecentOrders($query: String!) {
        orders(first: 100, query: $query, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              createdAt
              currentTotalPriceSet { shopMoney { amount } }
              currentTotalDiscountsSet { shopMoney { amount } }
            }
          }
        }
      }`,
    {
      variables: { query: `created_at:>=${fourteenDaysAgo.toISOString()}` },
    },
  );
  const json = await response.json();
  const orders = json.data?.orders?.edges ?? [];

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let thisWeekRevenue = 0;
  let lastWeekRevenue = 0;
  let thisWeekDiscounts = 0;

  for (const { node: order } of orders) {
    const createdAt = new Date(order.createdAt).getTime();
    const total = parseFloat(order.currentTotalPriceSet?.shopMoney?.amount ?? "0");
    const discount = parseFloat(
      order.currentTotalDiscountsSet?.shopMoney?.amount ?? "0",
    );
    if (createdAt >= sevenDaysAgo) {
      thisWeekRevenue += total;
      thisWeekDiscounts += discount;
    } else {
      lastWeekRevenue += total;
    }
  }

  const revenueChangePercent =
    lastWeekRevenue > 0
      ? ((thisWeekRevenue - lastWeekRevenue) / lastWeekRevenue) * 100
      : 0;
  const discountRatioPercent =
    thisWeekRevenue > 0 ? (thisWeekDiscounts / thisWeekRevenue) * 100 : 0;

  const revenueDeclineFlagged =
    lastWeekRevenue > 0 && revenueChangePercent <= -revenueDeclineAlertPercent;
  const discountRatioFlagged = discountRatioPercent >= discountRatioAlertPercent;

  const findings: string[] = [];
  if (revenueDeclineFlagged) {
    findings.push(
      `Revenue declined ${Math.abs(revenueChangePercent).toFixed(1)}% vs. the prior 7 days.`,
    );
  }
  if (discountRatioFlagged) {
    findings.push(
      `Discounts consumed ${discountRatioPercent.toFixed(1)}% of gross revenue this week.`,
    );
  }

  const task = await db.agentTask.create({
    data: {
      shop,
      agentId: financeAgent.id,
      title: "Weekly revenue & margin review",
      status: "completed",
    },
  });

  const confidence = Math.min(
    95,
    60 + Math.abs(revenueChangePercent) + (discountRatioFlagged ? 10 : 0),
  );

  const decision = await db.decision.create({
    data: {
      shop,
      agentId: financeAgent.id,
      taskId: task.id,
      situation:
        findings.length > 0
          ? findings.join(" ")
          : `Revenue is ${revenueChangePercent >= 0 ? "up" : "down"} ${Math.abs(revenueChangePercent).toFixed(1)}% vs. the prior 7 days, within normal range.`,
      dataUsed: JSON.stringify({
        thisWeekRevenue,
        lastWeekRevenue,
        thisWeekDiscounts,
        revenueChangePercent,
        discountRatioPercent,
        ordersScanned: orders.length,
      }),
      recommendation:
        findings.length > 0
          ? "Review recent campaigns and discount codes; consider pausing underperforming promotions."
          : "No action needed. Continue monitoring.",
      confidence: Math.round(confidence),
      requiresApproval: false,
      approvalStatus: "none",
      actionPayload: null,
    },
  });

  await db.auditLog.create({
    data: {
      shop,
      agentId: financeAgent.id,
      decisionId: decision.id,
      action: "decision.created",
      detail: JSON.stringify({ findings, revenueChangePercent, discountRatioPercent }),
    },
  });

  return {
    ordersScanned: orders.length,
    revenueChangePercent,
    discountRatioPercent,
    flagged: findings.length > 0,
  };
}

/**
 * Customer Success's real analysis: reads the last 30 days of orders and
 * measures order cancellation rate and repeat-purchase rate against
 * structured rules. Advisor-only - no reviews app required, no writes.
 */
export async function runCustomerSuccessCheck(
  shop: string,
  admin: AdminApiContext,
) {
  const customerSuccessAgent = await db.agent.findUniqueOrThrow({
    where: { shop_key: { shop, key: "customer-success" } },
  });
  const maxCancellationRatePercent = await getRuleValue(
    shop,
    customerSuccessAgent.id,
    "max_cancellation_rate_percent",
    5,
  );
  const minRepeatRatePercent = await getRuleValue(
    shop,
    customerSuccessAgent.id,
    "min_repeat_rate_percent",
    20,
  );

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const response = await admin.graphql(
    `#graphql
      query RecentOrdersForSuccess($query: String!) {
        orders(first: 100, query: $query, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              cancelledAt
              customer { id }
            }
          }
        }
      }`,
    { variables: { query: `created_at:>=${thirtyDaysAgo.toISOString()}` } },
  );
  const json = await response.json();
  const orders = json.data?.orders?.edges ?? [];

  const ordersPerCustomer = new Map<string, number>();
  let cancelledCount = 0;
  for (const { node: order } of orders) {
    if (order.cancelledAt) cancelledCount += 1;
    const customerId = order.customer?.id;
    if (customerId) {
      ordersPerCustomer.set(customerId, (ordersPerCustomer.get(customerId) ?? 0) + 1);
    }
  }

  const totalOrders = orders.length;
  const uniqueCustomers = ordersPerCustomer.size;
  const repeatCustomers = [...ordersPerCustomer.values()].filter((c) => c >= 2).length;

  const cancellationRatePercent = totalOrders > 0 ? (cancelledCount / totalOrders) * 100 : 0;
  const repeatRatePercent = uniqueCustomers > 0 ? (repeatCustomers / uniqueCustomers) * 100 : 0;

  const cancellationFlagged = cancellationRatePercent > maxCancellationRatePercent;
  const repeatRateFlagged = uniqueCustomers > 0 && repeatRatePercent < minRepeatRatePercent;

  const findings: string[] = [];
  if (cancellationFlagged) {
    findings.push(
      `Order cancellation rate is ${cancellationRatePercent.toFixed(1)}%, above the ${maxCancellationRatePercent}% threshold.`,
    );
  }
  if (repeatRateFlagged) {
    findings.push(
      `Repeat purchase rate is ${repeatRatePercent.toFixed(1)}%, below the ${minRepeatRatePercent}% target.`,
    );
  }

  const task = await db.agentTask.create({
    data: {
      shop,
      agentId: customerSuccessAgent.id,
      title: "Monthly customer health review",
      status: "completed",
    },
  });

  const confidence = Math.min(
    95,
    60 + (cancellationFlagged ? 15 : 0) + (repeatRateFlagged ? 15 : 0),
  );

  const decision = await db.decision.create({
    data: {
      shop,
      agentId: customerSuccessAgent.id,
      taskId: task.id,
      situation:
        findings.length > 0
          ? findings.join(" ")
          : `Cancellations are at ${cancellationRatePercent.toFixed(1)}% and repeat purchase rate is ${repeatRatePercent.toFixed(1)}%, both within normal range.`,
      dataUsed: JSON.stringify({
        totalOrders,
        cancelledCount,
        uniqueCustomers,
        repeatCustomers,
        cancellationRatePercent,
        repeatRatePercent,
      }),
      recommendation:
        findings.length > 0
          ? "Review recent cancellations for a common cause, and consider a retention offer for one-time buyers."
          : "No action needed. Continue monitoring.",
      confidence,
      requiresApproval: false,
      approvalStatus: "none",
      actionPayload: null,
    },
  });

  await db.auditLog.create({
    data: {
      shop,
      agentId: customerSuccessAgent.id,
      decisionId: decision.id,
      action: "decision.created",
      detail: JSON.stringify({ findings, cancellationRatePercent, repeatRatePercent }),
    },
  });

  return {
    ordersScanned: totalOrders,
    cancellationRatePercent,
    repeatRatePercent,
    flagged: findings.length > 0,
  };
}

/**
 * Marketing Manager's real analysis: reads recent abandoned checkouts (cart
 * recovery opportunity) and the last 30 days of order line items (to find
 * the current best-seller worth promoting further). Advisor-only - it
 * recommends campaigns and promotions, it never launches them.
 */
export async function runMarketingAnalysis(shop: string, admin: AdminApiContext) {
  const marketingAgent = await db.agent.findUniqueOrThrow({
    where: { shop_key: { shop, key: "marketing-manager" } },
  });
  const abandonedCheckoutAlertCount = await getRuleValue(
    shop,
    marketingAgent.id,
    "abandoned_checkout_alert_count",
    5,
  );

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [checkoutsResponse, ordersResponse] = await Promise.all([
    admin.graphql(
      `#graphql
        query AbandonedCheckouts($query: String!) {
          abandonedCheckouts(first: 50, query: $query) {
            edges {
              node {
                id
                totalPriceSet { shopMoney { amount } }
              }
            }
          }
        }`,
      { variables: { query: `created_at:>=${sevenDaysAgo.toISOString()}` } },
    ),
    admin.graphql(
      `#graphql
        query RecentOrderLineItems($query: String!) {
          orders(first: 100, query: $query, sortKey: CREATED_AT, reverse: true) {
            edges {
              node {
                lineItems(first: 10) {
                  edges { node { title quantity } }
                }
              }
            }
          }
        }`,
      { variables: { query: `created_at:>=${thirtyDaysAgo.toISOString()}` } },
    ),
  ]);

  const checkoutsJson = await checkoutsResponse.json();
  const abandonedCheckouts = checkoutsJson.data?.abandonedCheckouts?.edges ?? [];
  const abandonedValue = abandonedCheckouts.reduce(
    (sum: number, { node }: { node: { totalPriceSet?: { shopMoney?: { amount?: string } } } }) =>
      sum + parseFloat(node.totalPriceSet?.shopMoney?.amount ?? "0"),
    0,
  );

  const ordersJson = await ordersResponse.json();
  const orders = ordersJson.data?.orders?.edges ?? [];
  const quantityByProduct = new Map<string, number>();
  for (const { node: order } of orders) {
    for (const { node: item } of order.lineItems.edges) {
      quantityByProduct.set(item.title, (quantityByProduct.get(item.title) ?? 0) + item.quantity);
    }
  }
  const topProduct = [...quantityByProduct.entries()].sort((a, b) => b[1] - a[1])[0];

  const findings: string[] = [];
  const checkoutsFlagged = abandonedCheckouts.length >= abandonedCheckoutAlertCount;
  if (checkoutsFlagged) {
    findings.push(
      `${abandonedCheckouts.length} abandoned checkouts in the last 7 days, worth an estimated $${abandonedValue.toFixed(2)} in recoverable revenue.`,
    );
  }

  const task = await db.agentTask.create({
    data: {
      shop,
      agentId: marketingAgent.id,
      title: "Weekly marketing opportunity review",
      status: "completed",
    },
  });

  const situation = [
    ...findings,
    topProduct
      ? `${topProduct[0]} is the best seller of the last 30 days with ${topProduct[1]} units sold.`
      : "Not enough order history yet to identify a best seller.",
  ].join(" ");

  const recommendation = [
    checkoutsFlagged
      ? "Consider a cart-recovery email or discount code for abandoned checkouts."
      : null,
    topProduct
      ? `Feature "${topProduct[0]}" more prominently, or pair it with a cross-sell bundle.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  const confidence = Math.min(95, 55 + (checkoutsFlagged ? 15 : 0) + (topProduct ? 15 : 0));

  const decision = await db.decision.create({
    data: {
      shop,
      agentId: marketingAgent.id,
      taskId: task.id,
      situation,
      dataUsed: JSON.stringify({
        abandonedCheckoutCount: abandonedCheckouts.length,
        abandonedValue,
        topProduct: topProduct ? { title: topProduct[0], quantity: topProduct[1] } : null,
        ordersScanned: orders.length,
      }),
      recommendation: recommendation || "No action needed. Continue monitoring.",
      confidence,
      requiresApproval: false,
      approvalStatus: "none",
      actionPayload: null,
    },
  });

  await db.auditLog.create({
    data: {
      shop,
      agentId: marketingAgent.id,
      decisionId: decision.id,
      action: "decision.created",
      detail: JSON.stringify({ findings, topProduct: topProduct?.[0] ?? null }),
    },
  });

  return {
    abandonedCheckoutCount: abandonedCheckouts.length,
    ordersScanned: orders.length,
    flagged: checkoutsFlagged,
  };
}

interface VariantSnapshot {
  variantId: string;
  variantTitle: string;
  productTitle: string;
  inventoryQuantity: number;
}

/**
 * Inventory Manager's real analysis: computes each variant's average daily
 * sales velocity from recent order line items, forecasts days-until-stockout
 * from current inventory, and sizes a reorder recommendation to cover a
 * configurable number of forecasted-demand days - the exact shape of the
 * spec's example (stock, avg daily sales, forecast stockout, reorder qty,
 * confidence). Also flags variants with in-stock quantity but zero sales in
 * the lookback window as dead-stock candidates. Advisor-only: reordering and
 * clearance decisions are financial calls this agent recommends but doesn't
 * execute.
 */
export async function runInventoryForecast(shop: string, admin: AdminApiContext) {
  const inventoryAgent = await db.agent.findUniqueOrThrow({
    where: { shop_key: { shop, key: "inventory-manager" } },
  });
  const [stockoutAlertDays, reorderCoverDays, salesLookbackDays] = await Promise.all([
    getRuleValue(shop, inventoryAgent.id, "stockout_alert_days", 7),
    getRuleValue(shop, inventoryAgent.id, "reorder_cover_days", 14),
    getRuleValue(shop, inventoryAgent.id, "sales_lookback_days", 30),
  ]);

  const lookbackStart = new Date(Date.now() - salesLookbackDays * 24 * 60 * 60 * 1000);

  const [productsResponse, ordersResponse] = await Promise.all([
    admin.graphql(
      `#graphql
        query InventorySnapshot {
          products(first: 25, sortKey: UPDATED_AT, reverse: true) {
            edges {
              node {
                title
                variants(first: 10) {
                  edges { node { id title inventoryQuantity } }
                }
              }
            }
          }
        }`,
    ),
    admin.graphql(
      `#graphql
        query RecentSalesVelocity($query: String!) {
          orders(first: 100, query: $query, sortKey: CREATED_AT, reverse: true) {
            edges {
              node {
                lineItems(first: 10) {
                  edges { node { quantity variant { id } } }
                }
              }
            }
          }
        }`,
      { variables: { query: `created_at:>=${lookbackStart.toISOString()}` } },
    ),
  ]);

  const productsJson = await productsResponse.json();
  const products = productsJson.data?.products?.edges ?? [];

  const variants = new Map<string, VariantSnapshot>();
  for (const { node: product } of products) {
    for (const { node: variant } of product.variants.edges) {
      if (typeof variant.inventoryQuantity !== "number") continue;
      variants.set(variant.id, {
        variantId: variant.id,
        variantTitle: variant.title,
        productTitle: product.title,
        inventoryQuantity: variant.inventoryQuantity,
      });
    }
  }

  const ordersJson = await ordersResponse.json();
  const orders = ordersJson.data?.orders?.edges ?? [];
  const soldQuantityByVariant = new Map<string, number>();
  for (const { node: order } of orders) {
    for (const { node: item } of order.lineItems.edges) {
      const variantId = item.variant?.id;
      if (!variantId) continue;
      soldQuantityByVariant.set(variantId, (soldQuantityByVariant.get(variantId) ?? 0) + item.quantity);
    }
  }

  const createdDecisionIds: string[] = [];
  let stockoutRiskCount = 0;
  let deadStockCount = 0;

  for (const variant of variants.values()) {
    const totalSold = soldQuantityByVariant.get(variant.variantId) ?? 0;
    const avgDailySales = totalSold / salesLookbackDays;

    const isDeadStock = variant.inventoryQuantity > 0 && totalSold === 0;
    const forecastStockoutDays = avgDailySales > 0 ? variant.inventoryQuantity / avgDailySales : null;
    const isStockoutRisk = forecastStockoutDays !== null && forecastStockoutDays < stockoutAlertDays;

    if (!isDeadStock && !isStockoutRisk) continue;

    const task = await db.agentTask.create({
      data: {
        shop,
        agentId: inventoryAgent.id,
        title: isStockoutRisk
          ? `Forecasted stockout: ${variant.productTitle} (${variant.variantTitle})`
          : `Dead stock: ${variant.productTitle} (${variant.variantTitle})`,
        status: "completed",
      },
    });

    let situation: string;
    let recommendation: string;
    let confidence: number;

    if (isStockoutRisk && forecastStockoutDays !== null) {
      const recommendedReorder = Math.ceil(avgDailySales * reorderCoverDays);
      stockoutRiskCount += 1;
      situation =
        `${variant.productTitle} (${variant.variantTitle}) - stock: ${variant.inventoryQuantity}, ` +
        `average daily sales: ${avgDailySales.toFixed(1)}, forecast stockout: ${forecastStockoutDays.toFixed(1)} days.`;
      recommendation = `Reorder approximately ${recommendedReorder} units to cover the next ${reorderCoverDays} days of demand.`;
      confidence = Math.min(95, 70 + Math.round((stockoutAlertDays - forecastStockoutDays) * 3));
    } else {
      deadStockCount += 1;
      situation =
        `${variant.productTitle} (${variant.variantTitle}) has ${variant.inventoryQuantity} units in stock ` +
        `with no sales in the last ${salesLookbackDays} days.`;
      recommendation = "Consider a clearance discount or bundling this with a faster-moving product.";
      confidence = 65;
    }

    const decision = await db.decision.create({
      data: {
        shop,
        agentId: inventoryAgent.id,
        taskId: task.id,
        situation,
        dataUsed: JSON.stringify({
          variantId: variant.variantId,
          inventoryQuantity: variant.inventoryQuantity,
          avgDailySales,
          forecastStockoutDays,
          totalSold,
          salesLookbackDays,
        }),
        recommendation,
        confidence,
        requiresApproval: false,
        approvalStatus: "none",
        actionPayload: null,
      },
    });
    createdDecisionIds.push(decision.id);

    await db.auditLog.create({
      data: {
        shop,
        agentId: inventoryAgent.id,
        decisionId: decision.id,
        action: "decision.created",
        detail: JSON.stringify({ situation, recommendation, confidence }),
      },
    });
  }

  return {
    scanned: variants.size,
    stockoutRiskCount,
    deadStockCount,
    flagged: stockoutRiskCount + deadStockCount > 0,
    createdDecisionIds,
  };
}

/**
 * Event-driven counterpart to the manual scans above: reacts to a
 * single "Order Cancelled" webhook the moment it happens, instead of waiting
 * for the next batch run. Creates one lightweight Decision per cancellation
 * so a spike shows up in the Activity Log and briefing in near real time.
 */
export async function handleOrderCancelledEvent(
  shop: string,
  order: { id?: string | number; name?: string; cancel_reason?: string | null },
) {
  const customerSuccessAgent = await db.agent.findUnique({
    where: { shop_key: { shop, key: "customer-success" } },
  });
  if (!customerSuccessAgent) return;

  const orderLabel = order.name ?? `#${order.id}`;
  const task = await db.agentTask.create({
    data: {
      shop,
      agentId: customerSuccessAgent.id,
      title: `Order cancelled: ${orderLabel}`,
      status: "completed",
    },
  });

  const decision = await db.decision.create({
    data: {
      shop,
      agentId: customerSuccessAgent.id,
      taskId: task.id,
      situation: `Order ${orderLabel} was cancelled${order.cancel_reason ? ` (reason: ${order.cancel_reason})` : ""}.`,
      dataUsed: JSON.stringify({ orderId: order.id, cancelReason: order.cancel_reason ?? null }),
      recommendation: "Check whether this fits a pattern with recent cancellations.",
      confidence: 60,
      requiresApproval: false,
      approvalStatus: "none",
      actionPayload: null,
    },
  });

  await db.auditLog.create({
    data: {
      shop,
      agentId: customerSuccessAgent.id,
      decisionId: decision.id,
      action: "event.order_cancelled",
      detail: JSON.stringify({ orderId: order.id, orderLabel }),
    },
  });
}

/**
 * Event-driven counterpart to the Operations Manager's inventory scan: reacts
 * to a single "Product Updated" webhook and flags any variant that just
 * dropped below the low-stock rule, instead of waiting for the next manual
 * scan. Deduplicates against the last 24h so repeated product edits don't
 * spam a decision per webhook delivery.
 */
export async function handleProductUpdatedEvent(
  shop: string,
  product: {
    id?: string | number;
    title?: string;
    variants?: { id?: string | number; title?: string; inventory_quantity?: number }[];
  },
) {
  const operationsAgent = await db.agent.findUnique({
    where: { shop_key: { shop, key: "operations-manager" } },
  });
  if (!operationsAgent) return;

  const lowStockThreshold = await getRuleValue(
    shop,
    operationsAgent.id,
    "low_stock_threshold",
    10,
  );

  // No admin API client is available from a webhook payload, so unlike the
  // manual scan this handler can't auto-execute even if the merchant has set
  // this action to "no approval needed" - it can only respect a fully
  // disabled action by skipping it.
  const tagPolicy = await getEffectiveActionPolicy(shop, operationsAgent.id, "add_product_tag");
  if (!(tagPolicy?.enabled ?? true)) return;

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  for (const variant of product.variants ?? []) {
    if (
      typeof variant.inventory_quantity !== "number" ||
      variant.inventory_quantity < 0 ||
      variant.inventory_quantity >= lowStockThreshold
    ) {
      continue;
    }

    const variantKey = `"variantId":"${variant.id}"`;
    const recentDuplicate = await db.decision.findFirst({
      where: {
        shop,
        agentId: operationsAgent.id,
        createdAt: { gte: oneDayAgo },
        dataUsed: { contains: variantKey },
      },
    });
    if (recentDuplicate) continue;

    const task = await db.agentTask.create({
      data: {
        shop,
        agentId: operationsAgent.id,
        title: `Review low stock: ${product.title ?? "Product"} (${variant.title ?? "Variant"})`,
        status: "waiting_approval",
      },
    });

    const decision = await db.decision.create({
      data: {
        shop,
        agentId: operationsAgent.id,
        taskId: task.id,
        situation: `${product.title ?? "A product"} - ${variant.title ?? "variant"} dropped to ${variant.inventory_quantity} units, below the ${lowStockThreshold}-unit threshold (detected from a product update event).`,
        dataUsed: JSON.stringify({
          productId: product.id,
          variantId: variant.id,
          inventoryQuantity: variant.inventory_quantity,
          threshold: lowStockThreshold,
          source: "webhook:products/update",
        }),
        recommendation:
          "Tag this product 'low-stock' so it's visible across the catalog, and plan a reorder.",
        confidence: Math.min(95, 60 + (lowStockThreshold - variant.inventory_quantity) * 3),
        requiresApproval: true,
        approvalStatus: "pending",
        actionPayload: JSON.stringify({
          type: "add_product_tag",
          productId: `gid://shopify/Product/${product.id}`,
          tag: "low-stock",
        }),
      },
    });

    await db.auditLog.create({
      data: {
        shop,
        agentId: operationsAgent.id,
        decisionId: decision.id,
        action: "event.product_low_stock",
        detail: JSON.stringify({ productId: product.id, variantId: variant.id }),
      },
    });
  }
}

/**
 * Product Manager's real analysis: audits the live catalog for listing gaps -
 * missing/short descriptions and products with no images - that hurt SEO and
 * conversion. Advisor-only for now: it recommends copy fixes but doesn't
 * write to the catalog itself.
 */
export async function runProductCatalogCheck(
  shop: string,
  admin: AdminApiContext,
) {
  const productManager = await db.agent.findUniqueOrThrow({
    where: { shop_key: { shop, key: "product-manager" } },
  });
  const minDescriptionLength = await getRuleValue(
    shop,
    productManager.id,
    "min_description_length",
    40,
  );

  const response = await admin.graphql(
    `#graphql
      query CatalogAudit {
        products(first: 25, sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              title
              descriptionHtml
              featuredMedia { id }
            }
          }
        }
      }`,
  );
  const json = await response.json();
  const products = json.data?.products?.edges ?? [];

  const gaps: { id: string; title: string; issues: string[] }[] = [];
  for (const { node: product } of products) {
    const issues: string[] = [];
    const descriptionText = (product.descriptionHtml ?? "").replace(/<[^>]*>/g, "").trim();
    if (descriptionText.length < minDescriptionLength) {
      issues.push("description too short or missing");
    }
    if (!product.featuredMedia) {
      issues.push("no featured image");
    }
    if (issues.length > 0) {
      gaps.push({ id: product.id, title: product.title, issues });
    }
  }

  const createdDecisionIds: string[] = [];
  for (const gap of gaps) {
    const task = await db.agentTask.create({
      data: {
        shop,
        agentId: productManager.id,
        title: `Improve listing: ${gap.title}`,
        status: "completed",
      },
    });

    const decision = await db.decision.create({
      data: {
        shop,
        agentId: productManager.id,
        taskId: task.id,
        situation: `${gap.title} has listing gaps: ${gap.issues.join(", ")}.`,
        dataUsed: JSON.stringify({ productId: gap.id, issues: gap.issues }),
        recommendation:
          "Write a fuller description and add a featured image to improve SEO and conversion.",
        confidence: 70 + gap.issues.length * 10,
        requiresApproval: false,
        approvalStatus: "none",
        actionPayload: null,
      },
    });
    createdDecisionIds.push(decision.id);

    await db.auditLog.create({
      data: {
        shop,
        agentId: productManager.id,
        decisionId: decision.id,
        action: "decision.created",
        detail: JSON.stringify({ productId: gap.id, issues: gap.issues }),
      },
    });
  }

  return { scanned: products.length, flagged: gaps.length, createdDecisionIds };
}

/**
 * Executes an approved Decision's gated action against the Shopify Admin API.
 * This is the only place agent-proposed writes actually touch the store, and
 * every outcome (success or failure) is written to the audit log.
 */
export async function executeApprovedDecision(
  shop: string,
  admin: AdminApiContext,
  decisionId: string,
) {
  const decision = await db.decision.findUniqueOrThrow({
    where: { id: decisionId },
  });
  if (decision.shop !== shop) {
    throw new Response("Not found", { status: 404 });
  }
  if (!decision.actionPayload) {
    throw new Error("Decision has no executable action");
  }

  const payload = JSON.parse(decision.actionPayload) as {
    type: "add_product_tag";
    productId: string;
    tag: string;
  };

  await assertActionPermitted(shop, decision, payload.type);

  let result: string;
  try {
    if (payload.type === "add_product_tag") {
      const response = await admin.graphql(
        `#graphql
          mutation AddLowStockTag($id: ID!, $tags: [String!]!) {
            tagsAdd(id: $id, tags: $tags) {
              userErrors { field message }
            }
          }`,
        { variables: { id: payload.productId, tags: [payload.tag] } },
      );
      const json = await response.json();
      const errors = json.data?.tagsAdd?.userErrors ?? [];
      if (errors.length > 0) {
        throw new Error(errors.map((e: { message: string }) => e.message).join("; "));
      }
      result = "Tag added successfully.";
    } else {
      throw new Error(`Unknown action type: ${payload.type}`);
    }

    await db.decision.update({
      where: { id: decisionId },
      data: { executedAt: new Date(), executionResult: result },
    });
    await db.agentTask.update({
      where: { id: decision.taskId },
      data: { status: "completed" },
    });
    await db.auditLog.create({
      data: {
        shop,
        agentId: decision.agentId,
        decisionId: decision.id,
        action: "decision.executed",
        detail: JSON.stringify({ payload, result }),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.decision.update({
      where: { id: decisionId },
      data: { executionResult: `Failed: ${message}` },
    });
    await db.auditLog.create({
      data: {
        shop,
        agentId: decision.agentId,
        decisionId: decision.id,
        action: "decision.execution_failed",
        detail: JSON.stringify({ payload, error: message }),
      },
    });
    throw error;
  }

  return result;
}

/** Approve or reject a pending decision. Rejection just closes it out - no Shopify call. */
export async function setDecisionApproval(
  shop: string,
  decisionId: string,
  approve: boolean,
) {
  const decision = await db.decision.findUniqueOrThrow({
    where: { id: decisionId },
  });
  if (decision.shop !== shop) {
    throw new Response("Not found", { status: 404 });
  }

  const approvalStatus = approve ? "approved" : "rejected";
  await db.decision.update({
    where: { id: decisionId },
    data: { approvalStatus },
  });
  if (!approve) {
    await db.agentTask.update({
      where: { id: decision.taskId },
      data: { status: "cancelled" },
    });
  }
  await db.auditLog.create({
    data: {
      shop,
      agentId: decision.agentId,
      decisionId: decision.id,
      action: approve ? "decision.approved" : "decision.rejected",
      detail: JSON.stringify({}),
    },
  });
}

/**
 * Chief of Staff's synthesis step: pulls the most recent Operations and
 * Finance decisions, combines them into one prioritized assessment, and
 * records its own Decision that references the sub-agent decisions it drew
 * on. This is the "combine findings and set priorities" half of delegation -
 * the analysis itself is still done by the specialist agents.
 */
export async function runChiefOfStaffSynthesis(shop: string) {
  const chiefOfStaff = await db.agent.findUniqueOrThrow({
    where: { shop_key: { shop, key: "chief-of-staff" } },
  });

  const [latestOperations, latestFinance, latestCustomerSuccess, latestMarketing] = await Promise.all([
    db.decision.findFirst({
      where: { shop, agent: { key: "operations-manager" } },
      orderBy: { createdAt: "desc" },
    }),
    db.decision.findFirst({
      where: { shop, agent: { key: "finance-manager" } },
      orderBy: { createdAt: "desc" },
    }),
    db.decision.findFirst({
      where: { shop, agent: { key: "customer-success" } },
      orderBy: { createdAt: "desc" },
    }),
    db.decision.findFirst({
      where: { shop, agent: { key: "marketing-manager" } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const inputs = [latestOperations, latestFinance, latestCustomerSuccess, latestMarketing].filter(
    (d): d is NonNullable<typeof d> => d !== null,
  );

  if (inputs.length === 0) {
    return null;
  }

  const flaggedInputs = inputs.filter(
    (d) => d.requiresApproval || !d.recommendation.startsWith("No action needed"),
  );

  const priorities = (flaggedInputs.length > 0 ? flaggedInputs : inputs).map(
    (d, i) => `${i + 1}. ${d.situation}`,
  );

  const task = await db.agentTask.create({
    data: {
      shop,
      agentId: chiefOfStaff.id,
      title: "Combine team findings and set priorities",
      status: "completed",
    },
  });

  const confidence = Math.round(
    inputs.reduce((sum, d) => sum + d.confidence, 0) / inputs.length,
  );

  const decision = await db.decision.create({
    data: {
      shop,
      agentId: chiefOfStaff.id,
      taskId: task.id,
      situation:
        flaggedInputs.length > 0
          ? `Your AI team found ${flaggedInputs.length} item(s) worth your attention.`
          : "Your AI team reviewed the store and found nothing urgent.",
      dataUsed: JSON.stringify({
        sourceDecisionIds: inputs.map((d) => d.id),
      }),
      recommendation: priorities.join(" "),
      confidence,
      requiresApproval: false,
      approvalStatus: "none",
      actionPayload: null,
    },
  });

  await db.auditLog.create({
    data: {
      shop,
      agentId: chiefOfStaff.id,
      decisionId: decision.id,
      action: "decision.created",
      detail: JSON.stringify({
        delegatedFrom: inputs.map((d) => ({ agentId: d.agentId, decisionId: d.id })),
      }),
    },
  });

  // Formal agent-to-agent delegation records: each specialist "reports"
  // its latest finding to the Chief of Staff. This is what the synthesis step
  // above actually consumed - recorded explicitly so it shows up in each
  // agent's collaboration history, not just buried in dataUsed JSON.
  for (const input of inputs) {
    await db.agentMessage.create({
      data: {
        shop,
        senderId: input.agentId,
        receiverId: chiefOfStaff.id,
        task: "Report latest finding for daily synthesis",
        context: input.situation,
        priority: input.requiresApproval ? "high" : "medium",
        expectedOutput: "A situation summary and recommendation",
        status: "completed",
      },
    });
  }

  return decision;
}

/**
 * Agent performance summary: task/decision throughput, how the
 * merchant has responded to what the agent proposed, and a confidence
 * distribution across its recommendations. Computed on read from existing
 * Task/Decision rows - no separate metrics table to keep in sync.
 */
/**
 * Every agent, paired with the effective policy for every action on the
 * whitelist - what the Permissions control center (§35) renders. An agent
 * that has never done anything with a given action type still shows up with
 * the default policy, so the merchant can pre-configure it.
 */
export async function listAllAgentActionPermissions(shop: string) {
  const [agents, overrides] = await Promise.all([
    db.agent.findMany({ where: { shop }, orderBy: { createdAt: "asc" } }),
    db.agentActionPermission.findMany({ where: { shop } }),
  ]);

  const overrideByKey = new Map(
    overrides.map((o) => [`${o.agentId}:${o.actionType}`, o]),
  );

  return agents.map((agent) => ({
    agent,
    permissions: (Object.keys(ACTION_POLICIES) as ActionType[]).map((actionType) => {
      const policy = ACTION_POLICIES[actionType];
      const override = overrideByKey.get(`${agent.id}:${actionType}`);
      return {
        actionType,
        label: policy.label,
        enabled: override?.enabled ?? true,
        requiresApproval: override?.requiresApproval ?? policy.requiresApproval,
      };
    }),
  }));
}

/** Sets or updates the merchant's override for one agent + action type. */
export async function setAgentActionPermission(
  shop: string,
  agentId: string,
  actionType: string,
  input: { enabled: boolean; requiresApproval: boolean },
) {
  if (!(actionType in ACTION_POLICIES)) {
    throw new Error(`Unknown action type: ${actionType}`);
  }

  await db.agentActionPermission.upsert({
    where: { shop_agentId_actionType: { shop, agentId, actionType } },
    update: { enabled: input.enabled, requiresApproval: input.requiresApproval },
    create: { shop, agentId, actionType, ...input },
  });

  await db.auditLog.create({
    data: {
      shop,
      agentId,
      action: "permission.updated",
      detail: JSON.stringify({ actionType, ...input }),
    },
  });
}

export async function getAgentPerformance(shop: string, agentId: string) {
  const [tasksCompleted, decisions] = await Promise.all([
    db.agentTask.count({ where: { shop, agentId, status: "completed" } }),
    db.decision.findMany({ where: { shop, agentId }, select: { confidence: true, approvalStatus: true } }),
  ]);

  const recommendations = decisions.length;
  const approved = decisions.filter((d) => d.approvalStatus === "approved").length;
  const rejected = decisions.filter((d) => d.approvalStatus === "rejected").length;
  const pending = decisions.filter((d) => d.approvalStatus === "pending").length;

  const highConfidence = decisions.filter((d) => d.confidence >= 80).length;
  const mediumConfidence = decisions.filter((d) => d.confidence >= 50 && d.confidence < 80).length;
  const lowConfidence = decisions.filter((d) => d.confidence < 50).length;

  const pct = (count: number) => (recommendations > 0 ? Math.round((count / recommendations) * 100) : 0);

  return {
    tasksCompleted,
    recommendations,
    approved,
    rejected,
    pending,
    approvalRatePercent: recommendations > 0 ? Math.round((approved / recommendations) * 100) : null,
    confidenceDistribution: {
      highPercent: pct(highConfidence),
      mediumPercent: pct(mediumConfidence),
      lowPercent: pct(lowConfidence),
    },
  };
}

/**
 * Chief of Staff's daily briefing: the most recent decision per built-in agent
 * (excluding the Chief of Staff itself, which has no analysis of its own yet),
 * ranked so the merchant sees what needs attention first.
 */
export async function buildDailyBriefing(shop: string) {
  const agents = await db.agent.findMany({
    where: { shop, key: { not: "chief-of-staff" } },
    include: {
      decisions: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const chiefOfStaffAssessment = await db.decision.findFirst({
    where: { shop, agent: { key: "chief-of-staff" } },
    orderBy: { createdAt: "desc" },
  });

  const pendingApprovals = await db.decision.count({
    where: { shop, approvalStatus: "pending" },
  });

  const items = agents
    .filter((agent) => agent.decisions.length > 0)
    .map((agent) => {
      const decision = agent.decisions[0];
      const isNoActionNeeded = decision.recommendation.startsWith("No action needed");
      return {
        agentName: agent.name,
        department: agent.department,
        situation: decision.situation,
        recommendation: decision.recommendation,
        confidence: decision.confidence,
        needsAttention: !isNoActionNeeded,
        decisionId: decision.id,
      };
    })
    .sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention));

  return {
    items,
    pendingApprovals,
    assessment: chiefOfStaffAssessment
      ? {
          situation: chiefOfStaffAssessment.situation,
          priorities: chiefOfStaffAssessment.recommendation,
          confidence: chiefOfStaffAssessment.confidence,
        }
      : null,
  };
}
