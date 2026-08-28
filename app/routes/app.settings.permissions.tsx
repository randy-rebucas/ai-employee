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

  try {
    await setAgentActionPermission(shop, String(formData.get("agentId")), String(formData.get("actionType")), {
      enabled: formData.get("enabled") === "true",
      requiresApproval: formData.get("requiresApproval") === "true",
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not update" };
  }
};

export default function PermissionsSettings() {
  const { agentPermissions } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

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
                {permissions.map((perm) => (
                  <s-stack key={perm.actionType} direction="inline" gap="small" alignItems="center">
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
                      onClick={() =>
                        submit(agent.id, perm.actionType, !perm.enabled, perm.requiresApproval)
                      }
                    >
                      {perm.enabled ? "Disable" : "Enable"}
                    </s-button>
                    {perm.enabled && (
                      <s-button
                        variant="tertiary"
                        onClick={() =>
                          submit(agent.id, perm.actionType, perm.enabled, !perm.requiresApproval)
                        }
                      >
                        {perm.requiresApproval ? "Allow auto-execute" : "Require approval"}
                      </s-button>
                    )}
                  </s-stack>
                ))}
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
