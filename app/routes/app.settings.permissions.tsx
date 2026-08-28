import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import {
  ensureDefaultAgents,
  listAllAgentActionPermissions,
  setAgentActionPermission,
} from "../agents/orchestrator.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  await ensureDefaultAgents(shop);
  const agentPermissions = await listAllAgentActionPermissions(shop);
  return { agentPermissions };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const agentId = String(formData.get("agentId"));
  const actionType = String(formData.get("actionType"));

  try {
    await setAgentActionPermission(shop, agentId, actionType, {
      enabled: formData.get("enabled") === "true",
      requiresApproval: formData.get("requiresApproval") === "true",
    });
    return { ok: true, agentId, actionType };
  } catch (error) {
    return {
      ok: false,
      agentId,
      actionType,
      error: error instanceof Error ? error.message : "Could not update",
    };
  }
};

export default function PermissionsSettings() {
  const { agentPermissions } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const isSubmitting = fetcher.state !== "idle";
  const submittingAgentId = fetcher.formData?.get("agentId");
  const submittingActionType = fetcher.formData?.get("actionType");

  const submit = (agentId: string, actionType: string, enabled: boolean, requiresApproval: boolean) => {
    fetcher.submit(
      {
        agentId,
        actionType,
        enabled: String(enabled),
        requiresApproval: String(requiresApproval),
      },
      { method: "POST" },
    );
  };

  const confirmAndSubmit = (
    agentId: string,
    actionType: string,
    enabled: boolean,
    requiresApproval: boolean,
    confirmMessage: string | null,
  ) => {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    submit(agentId, actionType, enabled, requiresApproval);
  };

  return (
    <s-page heading="Permissions">
      {fetcher.data && !fetcher.data.ok && (
        <s-banner tone="critical" heading="Could not update">
          {fetcher.data.error}
        </s-banner>
      )}

      <s-section heading="Actions every employee is allowed to propose">
        <s-stack direction="block" gap="base">
          {agentPermissions.map(({ agent, permissions }) => (
            <s-box key={agent.id} padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-text type="strong">{agent.name}</s-text>
                {permissions.map((perm) => {
                  const isThisRow = submittingAgentId === agent.id && submittingActionType === perm.actionType;
                  const rowDisabled = isSubmitting && !isThisRow;

                  return (
                    <div
                      key={perm.actionType}
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "var(--p-space-200, 8px)",
                        alignItems: "center",
                        opacity: rowDisabled ? 0.6 : 1,
                      }}
                    >
                      <s-text>{perm.label}</s-text>
                      <s-badge tone={perm.enabled ? "success" : "critical"}>
                        {perm.enabled ? "Enabled" : "Disabled"}
                      </s-badge>
                      {perm.enabled && (
                        <s-badge tone={perm.requiresApproval ? "warning" : "info"}>
                          {perm.requiresApproval ? "Requires approval" : "Auto-executes"}
                        </s-badge>
                      )}
                      <s-button
                        variant="tertiary"
                        disabled={isSubmitting}
                        {...(isThisRow && isSubmitting ? { loading: true } : {})}
                        onClick={() =>
                          confirmAndSubmit(
                            agent.id,
                            perm.actionType,
                            !perm.enabled,
                            perm.requiresApproval,
                            perm.enabled
                              ? `Disable "${perm.label}" for ${agent.name}? This turns the finding into advice only — it will stop taking this action automatically.`
                              : null,
                          )
                        }
                      >
                        {perm.enabled ? "Disable" : "Enable"}
                      </s-button>
                      {perm.enabled && (
                        <s-button
                          variant="tertiary"
                          tone={perm.requiresApproval ? "critical" : "neutral"}
                          disabled={isSubmitting}
                          {...(isThisRow && isSubmitting ? { loading: true } : {})}
                          onClick={() =>
                            confirmAndSubmit(
                              agent.id,
                              perm.actionType,
                              perm.enabled,
                              !perm.requiresApproval,
                              perm.requiresApproval
                                ? `Let ${agent.name} auto-execute "${perm.label}" without your approval from now on? You can require approval again at any time.`
                                : null,
                            )
                          }
                        >
                          {perm.requiresApproval ? "Allow auto-execute" : "Require approval"}
                        </s-button>
                      )}
                    </div>
                  );
                })}
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="How this works">
        <s-paragraph>
          These are the only actions any AI employee is ever allowed to
          propose &mdash; the list itself can&rsquo;t be changed here, only whether an
          action is enabled and whether it needs your approval. Disabling an
          action turns that finding into advice only; allowing auto-execute
          moves an employee toward &ldquo;Limited autonomy.&rdquo;
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
