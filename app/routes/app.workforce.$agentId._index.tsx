import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  forgetMemory,
  getAgentPerformance,
  restoreInstructionVersion,
  teachAgent,
  updateAgentInstructions,
} from "../agents/orchestrator.server";
import { createDocument, deleteDocument } from "../agents/documents.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const agent = await db.agent.findUnique({
    where: { id: params.agentId },
    include: {
      tasks: { orderBy: { createdAt: "desc" } },
      decisions: { orderBy: { createdAt: "desc" }, take: 25 },
      rules: { orderBy: { key: "asc" } },
      memories: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!agent || agent.shop !== shop) {
    throw new Response("Agent not found", { status: 404 });
  }

  const [sentMessages, receivedMessages] = await Promise.all([
    db.agentMessage.findMany({
      where: { shop, senderId: agent.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { receiver: true },
    }),
    db.agentMessage.findMany({
      where: { shop, receiverId: agent.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { sender: true },
    }),
  ]);

  const performance = await getAgentPerformance(shop, agent.id);

  const instructionVersions = await db.instructionVersion.findMany({
    where: { shop, agentId: agent.id },
    orderBy: { version: "desc" },
    take: 10,
  });

  const documents = await db.document.findMany({
    where: { shop, OR: [{ agentId: agent.id }, { agentId: null }] },
    orderBy: { createdAt: "desc" },
  });

  return { agent, sentMessages, receivedMessages, performance, instructionVersions, documents };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const agentId = params.agentId!;
  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  try {
    if (intent === "teach") {
      await teachAgent(shop, {
        agentId,
        type: String(formData.get("type") ?? "fact"),
        content: String(formData.get("content") ?? ""),
      });
    } else if (intent === "forget") {
      await forgetMemory(shop, String(formData.get("memoryId")));
    } else if (intent === "edit_instructions") {
      await updateAgentInstructions(
        shop,
        agentId,
        String(formData.get("instructions") ?? ""),
        String(formData.get("changeSummary") ?? "") || undefined,
      );
    } else if (intent === "restore_version") {
      await restoreInstructionVersion(shop, String(formData.get("versionId")));
    } else if (intent === "upload_document") {
      const file = formData.get("file");
      let content = String(formData.get("content") ?? "");
      if (file instanceof File && file.size > 0) {
        content = await file.text();
      }
      await createDocument(shop, {
        agentId,
        title: String(formData.get("title") ?? ""),
        content,
      });
    } else if (intent === "delete_document") {
      await deleteDocument(shop, String(formData.get("documentId")));
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong" };
  }
};

const MEMORY_TYPE_LABELS: Record<string, string> = {
  preference: "Preference",
  fact: "Fact",
  experience: "Experience",
  instruction: "Instruction",
};

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "instructions", label: "Instructions" },
  { id: "memory", label: "Memory" },
  { id: "documents", label: "Documents" },
  { id: "rules", label: "Rules" },
  { id: "collaboration", label: "Collaboration" },
  { id: "activity", label: "Activity" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function AgentDetail() {
  const { agent, sentMessages, receivedMessages, performance, instructionVersions, documents } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const isSubmitting = fetcher.state !== "idle";
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const hasCollaboration = sentMessages.length > 0 || receivedMessages.length > 0;
  const visibleTabs = TABS.filter((tab) => tab.id !== "collaboration" || hasCollaboration);

  return (
    <s-page heading={agent.name}>
      <s-button slot="primary-action" href={`/app/workforce/${agent.id}/chat`}>
        Chat with {agent.name}
      </s-button>

      <s-section>
        <s-stack direction="inline" gap="small">
          {visibleTabs.map((tab) => (
            <s-button
              key={tab.id}
              variant={activeTab === tab.id ? "primary" : "tertiary"}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </s-button>
          ))}
        </s-stack>
      </s-section>

      {activeTab === "overview" && (
        <>
          <s-section heading="Profile">
            <s-stack direction="block" gap="small">
              <s-text>
                {agent.jobTitle} - {agent.department}
              </s-text>
              <s-text color="subdued">{agent.description}</s-text>
              <s-stack direction="inline" gap="small">
                <s-badge>Autonomy: {agent.autonomy}</s-badge>
                {agent.isCustom && <s-badge tone="info">Custom</s-badge>}
              </s-stack>
            </s-stack>
          </s-section>

          <s-section heading="Performance">
            <s-stack direction="block" gap="small">
              <s-stack direction="inline" gap="small">
                <s-badge>{performance.tasksCompleted} tasks completed</s-badge>
                <s-badge>{performance.recommendations} recommendations</s-badge>
                <s-badge tone="success">{performance.approved} approved</s-badge>
                <s-badge tone="critical">{performance.rejected} rejected</s-badge>
                {performance.pending > 0 && (
                  <s-badge tone="warning">{performance.pending} pending</s-badge>
                )}
              </s-stack>
              {performance.approvalRatePercent !== null && (
                <s-text color="subdued">
                  Approval rate: {performance.approvalRatePercent}%
                </s-text>
              )}
              {performance.recommendations > 0 && (
                <s-text color="subdued">
                  Confidence mix: {performance.confidenceDistribution.highPercent}% high,{" "}
                  {performance.confidenceDistribution.mediumPercent}% medium,{" "}
                  {performance.confidenceDistribution.lowPercent}% low
                </s-text>
              )}
            </s-stack>
          </s-section>
        </>
      )}

      {activeTab === "instructions" && (
        <s-section heading={`Instructions & business knowledge (v${agent.instructionsVersion})`}>
        <s-stack direction="block" gap="base">
          <fetcher.Form method="POST">
            <input type="hidden" name="intent" value="edit_instructions" />
            <s-stack direction="block" gap="small">
              <s-text-area
                label="Instructions"
                name="instructions"
                defaultValue={agent.instructions ?? ""}
                placeholder="Teach this employee how your business works: rules, preferences, things to never do."
                rows={5}
              />
              <s-text-field
                label="What changed and why? (optional)"
                name="changeSummary"
                placeholder="e.g. Added 20% minimum margin rule"
              />
              <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>
                Save new version
              </s-button>
            </s-stack>
          </fetcher.Form>

          {instructionVersions.length > 0 && (
            <s-stack direction="block" gap="small">
              <s-text type="strong">Version history</s-text>
              {instructionVersions.map((version) => (
                <s-box key={version.id} padding="small" borderWidth="base" borderRadius="base">
                  <s-stack direction="block" gap="small">
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-badge>v{version.version}</s-badge>
                      <s-text color="subdued">
                        {new Date(version.createdAt).toLocaleString()}
                      </s-text>
                      {version.version !== agent.instructionsVersion && (
                        <fetcher.Form method="POST">
                          <input type="hidden" name="intent" value="restore_version" />
                          <input type="hidden" name="versionId" value={version.id} />
                          <s-button type="submit" variant="tertiary">
                            Restore
                          </s-button>
                        </fetcher.Form>
                      )}
                    </s-stack>
                    {version.changeSummary && (
                      <s-text color="subdued">{version.changeSummary}</s-text>
                    )}
                    <s-text>{version.instructions || "(empty)"}</s-text>
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          )}
        </s-stack>
        </s-section>
      )}

      {activeTab === "memory" && (
      <s-section heading={`Memory (${agent.memories.length})`}>
        <s-stack direction="block" gap="base">
          {fetcher.data && !fetcher.data.ok && (
            <s-banner tone="critical" heading="Could not save">
              {fetcher.data.error}
            </s-banner>
          )}

          {agent.memories.length === 0 && (
            <s-text color="subdued">
              Nothing taught yet. Add a preference, fact, or past experience
              below and {agent.name} will use it in chat and future analysis.
            </s-text>
          )}

          {agent.memories.map((memory) => (
            <s-box key={memory.id} padding="small" borderWidth="base" borderRadius="base">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-badge>{MEMORY_TYPE_LABELS[memory.type] ?? memory.type}</s-badge>
                <s-text>{memory.content}</s-text>
                <fetcher.Form method="POST">
                  <input type="hidden" name="intent" value="forget" />
                  <input type="hidden" name="memoryId" value={memory.id} />
                  <s-button type="submit" variant="tertiary">
                    Forget
                  </s-button>
                </fetcher.Form>
              </s-stack>
            </s-box>
          ))}

          <fetcher.Form method="POST">
            <input type="hidden" name="intent" value="teach" />
            <s-stack direction="block" gap="small">
              <s-select label="Type" name="type" value="fact">
                <s-option value="preference">Preference</s-option>
                <s-option value="fact">Fact</s-option>
                <s-option value="experience">Past experience</s-option>
                <s-option value="instruction">One-off instruction</s-option>
              </s-select>
              <s-text-area
                label="Teach this employee something"
                name="content"
                placeholder="e.g. Never discount premium products below 20% margin."
                rows={2}
                required
              />
              <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>
                Save
              </s-button>
            </s-stack>
          </fetcher.Form>
        </s-stack>
      </s-section>
      )}

      {activeTab === "documents" && (
      <s-section heading={`Documents (${documents.length})`}>
        <s-stack direction="block" gap="base">
          <s-text color="subdued">
            Paste text or upload a .txt/.md file. {agent.name} retrieves the
            most relevant documents for each chat question - shared documents
            (no employee selected) are visible to every employee.
          </s-text>

          {documents.map((doc) => (
            <s-box key={doc.id} padding="small" borderWidth="base" borderRadius="base">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-text type="strong">{doc.title}</s-text>
                {!doc.agentId && <s-badge tone="info">Shared</s-badge>}
                <s-text color="subdued">{doc.content.length} chars</s-text>
                <fetcher.Form method="POST">
                  <input type="hidden" name="intent" value="delete_document" />
                  <input type="hidden" name="documentId" value={doc.id} />
                  <s-button type="submit" variant="tertiary">
                    Delete
                  </s-button>
                </fetcher.Form>
              </s-stack>
            </s-box>
          ))}

          <fetcher.Form method="POST" encType="multipart/form-data">
            <input type="hidden" name="intent" value="upload_document" />
            <s-stack direction="block" gap="small">
              <s-text-field label="Title" name="title" placeholder="e.g. Return Policy SOP" required />
              <s-text-area
                label="Paste content"
                name="content"
                placeholder="Paste the document text here..."
                rows={4}
              />
              <input type="file" name="file" accept=".txt,.md,text/plain" />
              <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>
                Upload
              </s-button>
            </s-stack>
          </fetcher.Form>
        </s-stack>
      </s-section>
      )}

      {activeTab === "rules" && (
      <s-section heading={`Rules (${agent.rules.length})`}>
        <s-stack direction="block" gap="small">
          {agent.rules.length === 0 && (
            <s-text color="subdued">No structured rules configured.</s-text>
          )}
          {agent.rules.map((rule) => (
            <s-box key={rule.id} padding="small" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-text type="strong">{rule.key}</s-text>
                  <s-badge>{rule.value}</s-badge>
                </s-stack>
                <s-text color="subdued">{rule.description}</s-text>
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>
      )}

      {activeTab === "collaboration" && hasCollaboration && (
        <s-section heading="Collaboration with other employees">
          <s-stack direction="block" gap="small">
            {receivedMessages.map((message) => (
              <s-box key={message.id} padding="small" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-badge tone="info">From {message.sender.name}</s-badge>
                    <s-badge>{message.priority}</s-badge>
                    <s-badge>{message.status}</s-badge>
                  </s-stack>
                  <s-text>{message.task}</s-text>
                  <s-text color="subdued">{message.context}</s-text>
                </s-stack>
              </s-box>
            ))}
            {sentMessages.map((message) => (
              <s-box key={message.id} padding="small" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-badge>To {message.receiver.name}</s-badge>
                    <s-badge>{message.priority}</s-badge>
                    <s-badge>{message.status}</s-badge>
                  </s-stack>
                  <s-text>{message.task}</s-text>
                  <s-text color="subdued">{message.context}</s-text>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      )}

      {activeTab === "activity" && (
      <s-section heading={`Tasks (${agent.tasks.length})`}>
        <s-stack direction="block" gap="small">
          {agent.tasks.length === 0 && (
            <s-text color="subdued">No tasks yet. Run a scan from the AI Workforce page.</s-text>
          )}
          {agent.tasks.map((task) => (
            <s-box key={task.id} padding="small" borderWidth="base" borderRadius="base">
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-text>{task.title}</s-text>
                <s-badge>{task.status}</s-badge>
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>
      )}

      {activeTab === "activity" && (
      <s-section heading="Recent decisions">
        <s-stack direction="block" gap="base">
          {agent.decisions.length === 0 && (
            <s-text color="subdued">No decisions recorded yet.</s-text>
          )}
          {agent.decisions.map((decision) => (
            <s-box key={decision.id} padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-text>{decision.situation}</s-text>
                <s-text color="subdued">Recommendation: {decision.recommendation}</s-text>
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-badge>Confidence {decision.confidence}%</s-badge>
                  <s-badge>Approval: {decision.approvalStatus}</s-badge>
                  {decision.executionResult && (
                    <s-badge>{decision.executionResult}</s-badge>
                  )}
                </s-stack>
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>
      )}
    </s-page>
  );
}
