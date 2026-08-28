# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Solo and small-team Shopify merchants with no dedicated staff for operations, finance, marketing, inventory, or customer success. They run the store themselves (or with 1-2 people) and cannot afford to hire a real team to watch these functions day to day.

## Product Purpose

AI Employee gives a merchant a small team of persistent AI "employees" — each with a job title, department, autonomy level, memory, and merchant-taught instructions — that watch store data (orders, inventory, customers, products), surface explainable recommendations, and, depending on the autonomy level the merchant grants, execute actions directly. It exists to give solo merchants the functional coverage of a small ops/finance/marketing team without the payroll.

## Positioning

Not an alerts/rules engine. Each AI employee is framed as persistent staff: it has a name, job title, and department; it accumulates taught preferences, facts, and experience in memory (`AgentMemory`); it follows merchant-authored instructions with version history; and its output is a `Decision` — a situation, the data used, a recommendation, and a confidence score — not just a triggered notification. A neighboring analytics or automation app could copy the checks; it could not copy the sense of an employee who remembers how this specific store likes things run.

## Operating Context

- Runs embedded in Shopify Admin (React Router + `@shopify/shopify-app-react-router`, Polaris web components).
- Departments observed today: Operations, Finance, Merchandising/Product, Customer Success, Marketing, Inventory, Executive (Chief of Staff synthesis), Sales.
- Core workflow: an agent runs a check → produces a `Decision` with confidence and a recommendation → if the action requires approval (per `AgentActionPermission` / `ACTION_POLICIES`), it waits in Approvals until the merchant approves or rejects it → approved actions execute against the Shopify Admin API.
- Autonomy is graduated per agent: `advisor` (recommend only) → `draft` → `limited` → `autonomous`, so trust in a given employee is dialed up over time rather than granted all at once.
- Daily Briefing surfaces a Chief-of-Staff-synthesized summary of what needs attention versus what's healthy across the whole team.
- Merchants can teach an employee via free-text instructions (versioned), uploaded documents/SOPs (`Document`), deterministic rule thresholds (`AgentRule`, e.g. low-stock threshold), and qualitative memories (`AgentMemory`).
- Merchants can also create fully custom AI employees beyond the default set (`isCustom` agents, `app.workforce.new`).

## Capabilities and Constraints

- Data model: Prisma/SQLite. Key entities: `Agent`, `AgentTask`, `Decision` (the approval-gated recommendation record), `AgentRule`, `AgentMemory`, `AgentActionPermission`, `AgentMessage` (agent-to-agent delegation), `Message` (merchant chat with an agent), `Document`, `InstructionVersion`, `AuditLog`.
- Shopify scopes: `write_products`, `write_metaobjects`, `write_metaobject_definitions`, `read_orders`, `read_customers`, `read_inventory`.
- Document retrieval is keyword-overlap only in this MVP, not vector similarity — noted in schema as a known future upgrade path, not a product gap to hide.
- UI is built entirely from Shopify Polaris web components (`s-page`, `s-section`, `s-box`, `s-stack`, `s-badge`, etc.) with no separate design system or theme file; visual language should stay native to Shopify admin rather than introduce a competing aesthetic.

## Evidence on Hand

None. Pre-launch: no real customers, testimonials, case studies, screenshots, or press exist yet. Future work must not fabricate any of these.

## Product Principles

1. Every agent action is explainable: a situation, the data behind it, a recommendation, and a confidence score — never a bare alert.
2. Trust is earned and graduated, never assumed: higher-impact actions default to requiring approval until the merchant raises an agent's autonomy.
3. Employees are persistent, not stateless: taught instructions, rules, and memories accumulate per agent and per store, and should read as continuity, not a fresh session each time.
4. The interface stays native to Shopify admin (Polaris web components); it earns trust by feeling like a natural extension of the merchant's existing tools, not a bolted-on dashboard.
5. Design for a solo operator under time pressure: surfaces should let them see what needs a decision in seconds, not audit a report.
