import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useEffect, useRef } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { sendAgentChatMessage } from "../agents/llm.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const agent = await db.agent.findUnique({ where: { id: params.agentId } });
  if (!agent || agent.shop !== shop) {
    throw new Response("Agent not found", { status: 404 });
  }

  const messages = await db.message.findMany({
    where: { shop, agentId: agent.id },
    orderBy: { createdAt: "asc" },
  });

  return { agent, messages };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const agentId = params.agentId!;

  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent || agent.shop !== shop) {
    throw new Response("Agent not found", { status: 404 });
  }

  const formData = await request.formData();
  const userMessage = String(formData.get("message") ?? "").trim();
  if (!userMessage) {
    return { ok: false as const, error: "Message cannot be empty" };
  }

  try {
    const { reply } = await sendAgentChatMessage(shop, agentId, userMessage);
    return { ok: true as const, reply };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Something went wrong",
    };
  }
};

export default function AgentChat() {
  const { agent, messages } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const formRef = useRef<HTMLFormElement>(null);
  const isSending = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      formRef.current?.reset();
    }
  }, [fetcher.data, fetcher.state]);

  return (
    <s-page heading={`Chat with ${agent.name}`}>
      <s-section heading="Conversation">
        <s-stack direction="block" gap="base">
          {messages.length === 0 && (
            <s-text color="subdued">
              Say hello to get started. {agent.name} can see its rules, recent
              decisions, and your instructions.
            </s-text>
          )}
          {messages.map((message) => (
            <s-box
              key={message.id}
              padding="small"
              borderWidth="base"
              borderRadius="base"
              background={message.role === "user" ? "subdued" : undefined}
            >
              <s-stack direction="block" gap="small">
                <s-text type="strong">
                  {message.role === "user" ? "You" : agent.name}
                </s-text>
                <s-text>{message.content}</s-text>
              </s-stack>
            </s-box>
          ))}

          {fetcher.data && !fetcher.data.ok && (
            <s-banner tone="critical" heading="Message failed">
              {fetcher.data.error}
            </s-banner>
          )}

          <fetcher.Form method="POST" ref={formRef}>
            <s-stack direction="block" gap="small">
              <s-text-area
                label={`Message ${agent.name}`}
                name="message"
                rows={2}
                required
              />
              <s-button
                type="submit"
                variant="primary"
                {...(isSending ? { loading: true } : {})}
              >
                Send
              </s-button>
            </s-stack>
          </fetcher.Form>
        </s-stack>
      </s-section>
    </s-page>
  );
}
