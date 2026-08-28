import db from "../db.server";
import { retrieveRelevantDocuments } from "./documents.server";

const ANTHROPIC_MODEL = "claude-sonnet-5";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MAX_HISTORY_MESSAGES = 20;

/**
 * Composable prompt assembly (base policy + role + instructions + rules +
 * recent decisions + output format). This is the "Intelligence" layer from
 * the product architecture: it never touches Shopify or the DB write path
 * itself - it only produces text. Permissions, rules-as-data, and execution
 * stay in the orchestrator, not here.
 */
async function buildSystemPrompt(shop: string, agentId: string, userMessage: string) {
  const agent = await db.agent.findUniqueOrThrow({
    where: { id: agentId },
    include: {
      rules: true,
      decisions: { orderBy: { createdAt: "desc" }, take: 5 },
      memories: {
        where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        orderBy: { importance: "desc" },
        take: 20,
      },
    },
  });

  const layers: string[] = [];

  layers.push(
    "You are an AI employee inside a Shopify merchant's AI workforce platform. " +
      "You act as a specialized staff member, not a generic assistant. Stay within " +
      "your job description. Be concise, concrete, and business-focused. " +
      "You cannot take actions yourself in this conversation - if the merchant asks " +
      "for something that requires touching the store, tell them you'll create a task " +
      "for review rather than pretending to have done it.",
  );

  layers.push(
    `Your identity: ${agent.name}, ${agent.jobTitle} (${agent.department} department).\n` +
      `Primary responsibility: ${agent.description}`,
  );

  if (agent.instructions) {
    layers.push(`Business instructions from the merchant:\n${agent.instructions}`);
  }

  if (agent.memories.length > 0) {
    const memoryLines = agent.memories
      .map((m) => `- [${m.type}] ${m.content}`)
      .join("\n");
    layers.push(
      `Things the merchant has taught you (preferences, facts, past experience):\n${memoryLines}`,
    );
  }

  if (agent.rules.length > 0) {
    const ruleLines = agent.rules
      .map((r) => `- ${r.key} = ${r.value} (${r.description})`)
      .join("\n");
    layers.push(
      `Structured business rules you must respect (these are enforced in code, not just guidance):\n${ruleLines}`,
    );
  }

  if (agent.decisions.length > 0) {
    const decisionLines = agent.decisions
      .map(
        (d) =>
          `- ${d.situation} -> recommended: ${d.recommendation} (confidence ${d.confidence}%, approval: ${d.approvalStatus})`,
      )
      .join("\n");
    layers.push(`Your most recent findings and decisions:\n${decisionLines}`);
  }

  const relevantDocuments = await retrieveRelevantDocuments(shop, agentId, userMessage);
  if (relevantDocuments.length > 0) {
    const docLines = relevantDocuments
      .map((d) => `--- ${d.title} ---\n${d.content}`)
      .join("\n\n");
    layers.push(
      `Relevant business documents retrieved for this question (use only what's relevant, don't just repeat them verbatim):\n${docLines}`,
    );
  }

  layers.push(
    `Your autonomy level is "${agent.autonomy}". advisor = you only recommend; ` +
      "draft = you propose actions that wait for merchant approval; limited/autonomous = " +
      "predefined low-risk actions may execute automatically under strict rules. " +
      "Always be explicit about which category any suggestion falls into.",
  );

  return layers.join("\n\n");
}

/**
 * The Chief of Staff gets a different prompt shape: instead of its own rules
 * and decisions, it sees every other agent's latest finding plus pending
 * approvals, so it can answer cross-team questions the way the spec's chat
 * example does ("Why did sales drop yesterday?" -> combines Marketing,
 * Finance, Operations). It still can't act - it can only report and suggest
 * delegating, same as the real orchestrator's synthesis step.
 */
async function buildChiefOfStaffSystemPrompt(shop: string, agentId: string, userMessage: string) {
  const [chiefOfStaff, agents, pendingApprovals] = await Promise.all([
    db.agent.findUniqueOrThrow({ where: { id: agentId } }),
    db.agent.findMany({
      where: { shop, key: { not: "chief-of-staff" } },
      include: { decisions: { orderBy: { createdAt: "desc" }, take: 1 } },
    }),
    db.decision.count({ where: { shop, approvalStatus: "pending" } }),
  ]);

  const layers: string[] = [];

  layers.push(
    "You are the Chief of Staff inside a Shopify merchant's AI workforce platform - " +
      "think CEO's chief of staff, not a generic assistant. You coordinate a team of " +
      "specialist AI employees (Operations, Marketing, Finance, Inventory, Product, " +
      "Customer Success, and any custom employees the merchant created). You do not run " +
      "your own analysis; you synthesize what the " +
      "team already found, set priorities, and tell the merchant what needs their attention. " +
      "You cannot execute actions yourself - direct the merchant to the Approvals page or " +
      "to the specific employee for anything that requires action.",
  );

  if (chiefOfStaff.instructions) {
    layers.push(`Business instructions from the merchant:\n${chiefOfStaff.instructions}`);
  }

  const teamLines = agents
    .map((agent) => {
      const latest = agent.decisions[0];
      const finding = latest
        ? `Latest finding: ${latest.situation} Recommendation: ${latest.recommendation} (confidence ${latest.confidence}%)`
        : "No findings yet - hasn't been run.";
      return `${agent.name} (${agent.jobTitle}, ${agent.department}): ${finding}`;
    })
    .join("\n");
  layers.push(`Your team and their most recent findings:\n${teamLines || "No employees yet."}`);

  layers.push(
    `There are currently ${pendingApprovals} decision(s) awaiting the merchant's approval.`,
  );

  const relevantDocuments = await retrieveRelevantDocuments(shop, agentId, userMessage);
  if (relevantDocuments.length > 0) {
    const docLines = relevantDocuments
      .map((d) => `--- ${d.title} ---\n${d.content}`)
      .join("\n\n");
    layers.push(
      `Relevant business documents retrieved for this question:\n${docLines}`,
    );
  }

  layers.push(
    "When answering, cite which employee's finding you're drawing on, combine causes across " +
      "departments when relevant, and end with a short numbered list of recommended next steps.",
  );

  return layers.join("\n\n");
}

interface ChatResult {
  reply: string;
}

/**
 * Sends one merchant message to an agent, persists both turns, and returns
 * the assistant's reply. Requires ANTHROPIC_API_KEY - if it's missing, this
 * fails with a clear setup message instead of a cryptic API error.
 */
export async function sendAgentChatMessage(
  shop: string,
  agentId: string,
  userMessage: string,
): Promise<ChatResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured. Add it to your environment to enable agent chat.",
    );
  }

  const agentRecord = await db.agent.findUniqueOrThrow({ where: { id: agentId } });

  await db.message.create({
    data: { shop, agentId, role: "user", content: userMessage },
  });

  const [systemPrompt, history] = await Promise.all([
    agentRecord.key === "chief-of-staff"
      ? buildChiefOfStaffSystemPrompt(shop, agentId, userMessage)
      : buildSystemPrompt(shop, agentId, userMessage),
    db.message.findMany({
      where: { shop, agentId },
      orderBy: { createdAt: "desc" },
      take: MAX_HISTORY_MESSAGES,
    }),
  ]);

  const orderedHistory = history.reverse();

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: orderedHistory.map((m: { role: string; content: string }) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI provider error (${response.status}): ${errorText}`);
  }

  const json = await response.json();
  const reply =
    json.content?.filter((block: { type: string }) => block.type === "text")
      .map((block: { text: string }) => block.text)
      .join("\n") || "(no response)";

  await db.message.create({
    data: { shop, agentId, role: "assistant", content: reply },
  });

  return { reply };
}
