import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { useEffect } from "react";
import { authenticate } from "../shopify.server";
import { createCustomAgent } from "../agents/orchestrator.server";
import { AGENT_TEMPLATES } from "../agents/templates";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const templateKey = url.searchParams.get("template");
  const template = AGENT_TEMPLATES.find((t) => t.key === templateKey) ?? null;
  return { template };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  try {
    const agent = await createCustomAgent(shop, {
      name: String(formData.get("name") ?? ""),
      jobTitle: String(formData.get("jobTitle") ?? ""),
      department: String(formData.get("department") ?? ""),
      description: String(formData.get("description") ?? ""),
      instructions: String(formData.get("instructions") ?? ""),
      autonomy: String(formData.get("autonomy") ?? "advisor"),
    });
    return { ok: true as const, agentId: agent.id };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Could not create agent",
    };
  }
};

export default function NewAgent() {
  const { template } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (!fetcher.data?.ok) return;
    const agentId = fetcher.data.agentId;

    const duration = 2000;
    shopify.toast.show("Employee created", { duration });

    const timer = setTimeout(() => {
      navigate(`/app/workforce/${agentId}`);
    }, duration);
    return () => clearTimeout(timer);
  }, [fetcher.data, navigate]);

  return (
    <s-page heading="Create AI Employee">
      {fetcher.data && !fetcher.data.ok && (
        <s-banner tone="critical" heading="Could not create agent">
          {fetcher.data.error}
        </s-banner>
      )}

      <s-section heading="Start from a template (optional)">
        <s-stack direction="inline" gap="small">
          {AGENT_TEMPLATES.map((t) => (
            <s-button
              key={t.key}
              variant={template?.key === t.key ? "primary" : "secondary"}
              href={`/app/workforce/new?template=${t.key}`}
            >
              {t.name}
            </s-button>
          ))}
          {template && (
            <s-button variant="tertiary" href="/app/workforce/new">
              Clear template
            </s-button>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Basic information">
        <fetcher.Form method="POST" key={template?.key ?? searchParams.toString()}>
          <s-stack direction="block" gap="base">
            <s-text-field label="Name" name="name" defaultValue={template?.name ?? ""} required />
            <s-text-field
              label="Job title"
              name="jobTitle"
              defaultValue={template?.jobTitle ?? ""}
              placeholder="e.g. Marketplace Manager"
            />
            <s-text-field
              label="Department"
              name="department"
              defaultValue={template?.department ?? ""}
              placeholder="e.g. Marketing"
            />
            <s-text-area
              label="Primary responsibility"
              name="description"
              defaultValue={template?.description ?? ""}
              placeholder="What should this employee focus on?"
              rows={2}
            />
            <s-text-area
              label="Instructions & business knowledge"
              name="instructions"
              defaultValue={template?.instructions ?? ""}
              placeholder="Teach this employee how your business works: rules, preferences, things to never do."
              rows={5}
            />
            <s-select label="Autonomy" name="autonomy" value={template?.autonomy ?? "advisor"}>
              <s-option value="advisor">Advisor - only recommends</s-option>
              <s-option value="draft">Draft - proposes actions for approval</s-option>
              <s-option value="limited">Limited autonomy - executes low-risk actions</s-option>
              <s-option value="autonomous">Autonomous - executes within strict rules</s-option>
            </s-select>
            <s-button
              type="submit"
              variant="primary"
              {...(isSubmitting ? { loading: true } : {})}
            >
              Create employee
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section slot="aside" heading="About custom employees">
        <s-paragraph>
          Templates just pre-fill the form below - edit anything before
          creating. Custom employees start with a profile and instructions
          but no built-in automation; assign them tasks manually, or extend
          the orchestrator to give them a real analysis routine like the
          built-in agents have.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
