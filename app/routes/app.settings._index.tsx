import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const setting = await db.shopSetting.findUnique({ where: { shop } });
  const merchantKey = setting?.anthropicApiKey ?? null;

  return {
    hasMerchantKey: Boolean(merchantKey),
    keyPreview: merchantKey ? merchantKey.slice(-4) : null,
    hasEnvFallback: Boolean(process.env.ANTHROPIC_API_KEY),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  if (intent === "save") {
    const apiKey = String(formData.get("apiKey") ?? "").trim();
    if (!apiKey) {
      return { ok: false as const, error: "Enter a key before saving." };
    }
    await db.shopSetting.upsert({
      where: { shop },
      create: { shop, anthropicApiKey: apiKey },
      update: { anthropicApiKey: apiKey },
    });
    return { ok: true as const };
  }

  if (intent === "remove") {
    await db.shopSetting.upsert({
      where: { shop },
      create: { shop, anthropicApiKey: null },
      update: { anthropicApiKey: null },
    });
    return { ok: true as const };
  }

  return { ok: false as const, error: "Unknown action." };
};

export default function SettingsIndex() {
  const { hasMerchantKey, keyPreview, hasEnvFallback } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const isSubmitting = fetcher.state !== "idle";

  return (
    <s-page heading="Settings">
      {fetcher.data && !fetcher.data.ok && (
        <s-banner tone="critical" heading="Could not update">
          {fetcher.data.error}
        </s-banner>
      )}

      <s-section heading="Anthropic API Key">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-text>Status:</s-text>
            {hasMerchantKey ? (
              <s-badge tone="success">Using your key (&hellip;{keyPreview})</s-badge>
            ) : hasEnvFallback ? (
              <s-badge tone="info">Using the app&rsquo;s shared key</s-badge>
            ) : (
              <s-badge tone="critical">Not configured</s-badge>
            )}
          </s-stack>

          <s-paragraph>
            Chat with your AI employees runs on Anthropic&rsquo;s API. Add your
            own key to use your own Anthropic account and billing instead of
            the app&rsquo;s shared key.
          </s-paragraph>

          <fetcher.Form method="POST">
            <input type="hidden" name="intent" value="save" />
            <s-stack direction="block" gap="small">
              <s-password-field
                label="Anthropic API key"
                name="apiKey"
                autocomplete="off"
                placeholder={hasMerchantKey ? `Currently saved: …${keyPreview}` : "sk-ant-..."}
              />
              <s-stack direction="inline" gap="small">
                <s-button type="submit" variant="primary" {...(isSubmitting ? { loading: true } : {})}>
                  Save key
                </s-button>
              </s-stack>
            </s-stack>
          </fetcher.Form>

          {hasMerchantKey && (
            <fetcher.Form method="POST">
              <input type="hidden" name="intent" value="remove" />
              <s-button type="submit" variant="tertiary" tone="critical" {...(isSubmitting ? { loading: true } : {})}>
                Remove saved key
              </s-button>
            </fetcher.Form>
          )}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Quick links">
        <s-stack direction="block" gap="small">
          <s-link href="/app/settings/permissions">Permissions</s-link>
          <s-link href="/app/activity">Activity</s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}
