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

/** Renders **bold**, "- " bullets, and "1. " numbered lines from LLM replies as native Polaris text/list elements instead of one run-on paragraph with literal asterisks. Not a full Markdown parser - just the subset the chat prompt's replies actually use. */
function ChatMarkdown({ content }: { content: string }) {
  type Block = { type: "ul" | "ol" | "p"; lines: string[] };
  const blocks: Block[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;

    const bulletMatch = /^[-*]\s+(.*)/.exec(line);
    const numberedMatch = /^\d+\.\s+(.*)/.exec(line);
    const type: Block["type"] = bulletMatch ? "ul" : numberedMatch ? "ol" : "p";
    const text = bulletMatch?.[1] ?? numberedMatch?.[1] ?? line;

    const last = blocks[blocks.length - 1];
    if (last && last.type === type && type !== "p") {
      last.lines.push(text);
    } else {
      blocks.push({ type, lines: [text] });
    }
  }

  return (
    <s-stack direction="block" gap="small-200">
      {blocks.map((block, i) => {
        if (block.type === "ul") {
          return (
            <s-unordered-list key={i}>
              {block.lines.map((line, j) => (
                <s-list-item key={j}>{renderInlineMarkdown(line)}</s-list-item>
              ))}
            </s-unordered-list>
          );
        }
        if (block.type === "ol") {
          return (
            <s-ordered-list key={i}>
              {block.lines.map((line, j) => (
                <s-list-item key={j}>{renderInlineMarkdown(line)}</s-list-item>
              ))}
            </s-ordered-list>
          );
        }
        return <s-paragraph key={i}>{renderInlineMarkdown(block.lines.join(" "))}</s-paragraph>;
      })}
    </s-stack>
  );
}

function renderInlineMarkdown(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <s-text key={i} type="strong">
        {part.slice(2, -2)}
      </s-text>
    ) : (
      part
    ),
  );
}

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
                {message.role === "user" ? (
                  <s-text>{message.content}</s-text>
                ) : (
                  <ChatMarkdown content={message.content} />
                )}
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
