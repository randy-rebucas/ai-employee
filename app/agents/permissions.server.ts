import type { Decision } from "@prisma/client";
import db from "../db.server";

/**
 * The tool layer's permission registry (§18/§29): a whitelist of action types
 * an agent is ever allowed to propose, each declaring a default approval
 * requirement. This is deliberately separate from the LLM/orchestrator code -
 * a Decision's actionPayload.type must appear here or execution is refused
 * outright, regardless of what any agent "intended." Never rely on prompt
 * instructions alone to gate a real Shopify write.
 *
 * The merchant can tighten or loosen the *default* per agent via
 * AgentActionPermission (the Permissions control center), but can never
 * grant an action type outside this whitelist - that requires a code change.
 */
export const ACTION_POLICIES = {
  add_product_tag: {
    label: "Add a tag to a product",
    scope: "write:product_tags",
    requiresApproval: true,
  },
} as const;

export type ActionType = keyof typeof ACTION_POLICIES;

export class PermissionDeniedError extends Error {}

export interface EffectiveActionPolicy {
  enabled: boolean;
  requiresApproval: boolean;
  label: string;
}

/**
 * Resolves the policy actually in effect for one agent + action type: the
 * merchant's override if one exists, otherwise the whitelist default. Used
 * both when an agent proposes an action (to decide whether to ask for
 * approval at all) and again at execution time (defense in depth).
 */
export async function getEffectiveActionPolicy(
  shop: string,
  agentId: string,
  actionType: string,
): Promise<EffectiveActionPolicy | null> {
  const policy = ACTION_POLICIES[actionType as ActionType];
  if (!policy) return null;

  const override = await db.agentActionPermission.findUnique({
    where: { shop_agentId_actionType: { shop, agentId, actionType } },
  });

  return {
    enabled: override?.enabled ?? true,
    requiresApproval: override?.requiresApproval ?? policy.requiresApproval,
    label: policy.label,
  };
}

/**
 * Re-verifies, at execution time, that a Decision is allowed to run - not
 * just that it was created with requiresApproval=true. Checked immediately
 * before every Shopify write so a bug upstream (or a stale permission at
 * creation time) can never skip approval for an action currently configured
 * to require it.
 */
export async function assertActionPermitted(
  shop: string,
  decision: Pick<Decision, "agentId" | "approvalStatus" | "actionPayload">,
  actionType: string,
): Promise<void> {
  const policy = await getEffectiveActionPolicy(shop, decision.agentId, actionType);
  if (!policy) {
    throw new PermissionDeniedError(`Action type "${actionType}" is not on the permitted action list.`);
  }
  if (!policy.enabled) {
    throw new PermissionDeniedError(`"${policy.label}" has been disabled for this employee.`);
  }
  if (policy.requiresApproval && decision.approvalStatus !== "approved") {
    throw new PermissionDeniedError(
      `"${policy.label}" requires merchant approval and this decision is "${decision.approvalStatus}".`,
    );
  }
}
