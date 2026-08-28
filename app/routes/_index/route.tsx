import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export function links() {
  return [
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
    { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
    {
      rel: "stylesheet",
      href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Manrope:wght@400;500;600;700&display=swap",
    },
  ];
}

const roster = [
  {
    title: "Chief of Staff",
    dept: "Executive",
    duty: "Synthesizes every employee's work into one daily briefing: what needs a decision, what's healthy.",
    autonomy: "advisor",
  },
  {
    title: "Operations Manager",
    dept: "Operations",
    duty: "Watches order flow and fulfillment health, flags what's breaking before customers notice.",
    autonomy: "draft",
  },
  {
    title: "Finance Manager",
    dept: "Finance",
    duty: "Tracks margin, spend, and cash patterns; recommends pricing and cost moves with the numbers attached.",
    autonomy: "advisor",
  },
  {
    title: "Marketing Manager",
    dept: "Marketing",
    duty: "Spots what's working in traffic and conversion, drafts the next campaign to run.",
    autonomy: "draft",
  },
  {
    title: "Inventory Manager",
    dept: "Inventory",
    duty: "Watches stock levels against velocity, reorders before you'd have noticed a shortfall.",
    autonomy: "limited",
  },
  {
    title: "Customer Success",
    dept: "Customer Success",
    duty: "Reads support signal across orders and messages, catches unhappy customers early.",
    autonomy: "advisor",
  },
];

const autonomyLabels: Record<string, string> = {
  advisor: "Advisor",
  draft: "Drafts actions",
  limited: "Limited autonomy",
  autonomous: "Autonomous",
};

const autonomySteps = ["advisor", "draft", "limited", "autonomous"];

const deptSparks: Record<string, JSX.Element> = {
  Executive: (
    <path
      className={styles.avatarSpark}
      d="M12 1.1l.86 1.98 2.14.24-1.6 1.46.44 2.12L12 5.8l-1.84 1.1.44-2.12-1.6-1.46 2.14-.24z"
    />
  ),
  Operations: (
    <polygon
      className={styles.avatarSpark}
      points="12,1.5 13.3,2.25 13.3,3.75 12,4.5 10.7,3.75 10.7,2.25"
    />
  ),
  Finance: (
    <polygon className={styles.avatarSpark} points="12,1.4 13.5,3 12,4.6 10.5,3" />
  ),
  Marketing: (
    <polygon className={styles.avatarSpark} points="12,1.5 13.4,4 10.6,4" />
  ),
  Inventory: (
    <rect className={styles.avatarSpark} x="10.6" y="1.6" width="2.8" height="2.8" rx="0.5" />
  ),
  "Customer Success": <circle className={styles.avatarSpark} cx="12" cy="3" r="1.45" />,
};

function AvatarIcon({ dept, inverse = false }: { dept: string; inverse?: boolean }) {
  const spark = deptSparks[dept] ?? deptSparks["Customer Success"];
  const sparkWithClass = inverse
    ? {
        ...spark,
        props: {
          ...spark.props,
          className: `${styles.avatarSpark} ${styles.avatarSparkInverse}`,
        },
      }
    : spark;

  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <line x1="12" y1="4.6" x2="12" y2="6.4" stroke="currentColor" strokeWidth="1.4" />
      {sparkWithClass}
      <circle cx="12" cy="10.4" r="3.6" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M5.5 21c0-4.1 3-7.4 6.5-7.4s6.5 3.3 6.5 7.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

const networkNodes: [number, number, boolean][] = [
  [80, 90, false],
  [220, 60, false],
  [360, 150, true],
  [520, 70, false],
  [680, 130, false],
  [820, 60, false],
  [120, 270, false],
  [300, 310, false],
  [480, 260, true],
  [650, 290, false],
  [800, 250, false],
  [210, 430, false],
  [420, 410, false],
  [600, 440, true],
  [760, 410, false],
];

const networkLines: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [0, 6],
  [6, 7],
  [7, 8],
  [8, 9],
  [9, 10],
  [6, 11],
  [7, 12],
  [8, 12],
  [9, 13],
  [10, 14],
  [12, 13],
  [13, 14],
  [2, 7],
  [3, 8],
  [4, 9],
];

function NetworkField() {
  return (
    <svg
      className={styles.network}
      viewBox="0 0 900 500"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {networkLines.map(([a, b]) => {
        const [x1, y1] = networkNodes[a];
        const [x2, y2] = networkNodes[b];
        return (
          <line
            key={`${a}-${b}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            className={styles.networkLine}
          />
        );
      })}
      {networkNodes.map(([x, y, active], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={active ? 4.5 : 2.6}
          className={active ? styles.networkNodeActive : styles.networkNode}
        />
      ))}
    </svg>
  );
}

function HandoffScene() {
  return (
    <svg viewBox="0 0 400 200" aria-hidden="true" className={styles.sceneSvg}>
      <path
        d="M124,100 Q200,58 276,100"
        className={styles.sceneDashPath}
        fill="none"
      />
      <polygon points="196,79 208,83 197,88" className={styles.sceneArrow} />
      <rect x="140" y="24" width="120" height="26" rx="13" className={styles.sceneChip} />
      <text x="200" y="41" textAnchor="middle" className={styles.sceneChipText}>
        Ops → Finance
      </text>

      <circle cx="90" cy="100" r="34" className={styles.sceneAvatarBg} />
      <g transform="translate(69,79) scale(1.75)">
        <line x1="12" y1="4.6" x2="12" y2="6.4" stroke="currentColor" strokeWidth="1.4" />
        <polygon
          points="12,1.5 13.3,2.25 13.3,3.75 12,4.5 10.7,3.75 10.7,2.25"
          fill="var(--accent)"
        />
        <circle cx="12" cy="10.4" r="3.6" stroke="currentColor" strokeWidth="1.4" fill="none" />
        <path
          d="M5.5 21c0-4.1 3-7.4 6.5-7.4s6.5 3.3 6.5 7.4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          fill="none"
        />
      </g>

      <circle cx="310" cy="100" r="34" className={styles.sceneAvatarBg} />
      <g transform="translate(289,79) scale(1.75)">
        <line x1="12" y1="4.6" x2="12" y2="6.4" stroke="currentColor" strokeWidth="1.4" />
        <polygon points="12,1.4 13.5,3 12,4.6 10.5,3" fill="var(--accent)" />
        <circle cx="12" cy="10.4" r="3.6" stroke="currentColor" strokeWidth="1.4" fill="none" />
        <path
          d="M5.5 21c0-4.1 3-7.4 6.5-7.4s6.5 3.3 6.5 7.4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          fill="none"
        />
      </g>

      <circle cx="335" cy="72" r="11" className={styles.sceneBadgeCircle} />
      <path
        d="M330 72l3 3 6-6"
        stroke="var(--accent-ink)"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AuditScene() {
  const rows = [
    { y: 58, state: "done" },
    { y: 90, state: "done" },
    { y: 122, state: "done" },
    { y: 154, state: "pending" },
  ];

  return (
    <svg viewBox="0 0 400 220" aria-hidden="true" className={styles.sceneSvg}>
      <rect x="56" y="26" width="220" height="170" rx="12" className={styles.sceneDoc} />
      {rows.map((row) => (
        <g key={row.y}>
          <rect x="78" y={row.y} width="130" height="10" rx="5" className={styles.sceneDocLine} />
          {row.state === "done" ? (
            <>
              <circle cx="244" cy={row.y + 5} r="9" className={styles.sceneCheckDone} />
              <path
                d={`M240 ${row.y + 5}l3 3 6-6`}
                stroke="var(--accent-ink)"
                strokeWidth="1.8"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          ) : (
            <circle cx="244" cy={row.y + 5} r="9" className={styles.sceneCheckPending} />
          )}
        </g>
      ))}

      <circle cx="298" cy="176" r="36" className={styles.sceneAvatarBg} />
      <g transform="translate(276,154) scale(1.85)">
        <line x1="12" y1="4.6" x2="12" y2="6.4" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="12" cy="3" r="1.45" fill="var(--accent)" />
        <circle cx="12" cy="10.4" r="3.6" stroke="currentColor" strokeWidth="1.4" fill="none" />
        <path
          d="M5.5 21c0-4.1 3-7.4 6.5-7.4s6.5 3.3 6.5 7.4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          fill="none"
        />
      </g>
      <circle cx="326" cy="148" r="14" className={styles.sceneLensRing} />
      <line
        x1="336"
        y1="158"
        x2="346"
        y2="168"
        className={styles.sceneLensHandle}
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.page}>
      <div className={styles.glow} aria-hidden="true" />
      <NetworkField />

      <header className={styles.hero}>
        <nav className={styles.nav}>
          <span className={styles.wordmark}>
            AI <span className={styles.wordmarkAccent}>Employee</span>
          </span>
          <span className={styles.navTag}>Built for Shopify Admin</span>
        </nav>

        <div className={styles.heroGrid}>
          <div className={styles.heroCopy}>
            <h1 className={styles.heading}>
              Hire an AI team that
              <span className={styles.headingAccent}> never clocks out.</span>
            </h1>
            <p className={styles.text}>
              AI Employee staffs your store with a Chief of Staff, Operations,
              Finance, Marketing, Inventory, and Customer Success lead — each
              one persistent, each one explainable, each one earning more
              autonomy as you trust it.
            </p>

            {showForm && (
              <Form className={styles.form} method="post" action="/auth/login">
                <label className={styles.label}>
                  <span className={styles.labelText}>Shop domain</span>
                  <input
                    className={styles.input}
                    type="text"
                    name="shop"
                    placeholder="my-shop-domain.myshopify.com"
                  />
                </label>
                <button className={styles.button} type="submit">
                  Put your team to work
                </button>
              </Form>
            )}
            <p className={styles.microcopy}>
              No credit card yet — connect your store and meet your first employee.
            </p>
          </div>

          <div className={styles.decisionCard} aria-hidden="true">
            <div className={styles.decisionCardHeader}>
              <span className={styles.decisionAvatar}>
                <AvatarIcon dept="Inventory" inverse />
              </span>
              <div>
                <p className={styles.decisionName}>Inventory Manager</p>
                <p className={styles.decisionDept}>Inventory · Decision</p>
              </div>
              <span className={styles.decisionConfidence}>92% confident</span>
            </div>
            <p className={styles.decisionSituation}>
              "Sea Salt Candle" will stock out in 4 days at current velocity.
            </p>
            <p className={styles.decisionData}>
              Based on 30-day sell-through (6.2/day) vs. 25 units on hand, no
              open POs.
            </p>
            <p className={styles.decisionRec}>
              Recommendation: reorder 150 units from your default supplier.
            </p>
            <div className={styles.decisionActions}>
              <span className={styles.decisionBadge}>Awaiting your approval</span>
              <span className={styles.decisionApprove}>Approve</span>
            </div>
          </div>
        </div>
      </header>

      <section className={styles.section} aria-labelledby="roster-heading">
        <div className={styles.sectionHead}>
          <h2 id="roster-heading" className={styles.sectionHeading}>
            Six roles. One store. Zero payroll.
          </h2>
          <p className={styles.sectionText}>
            Every employee has a job title, a department, and a memory of how
            your store likes things run — taught by you, not guessed at.
          </p>
        </div>

        <ul className={styles.rosterGrid}>
          {roster.map((employee) => (
            <li className={styles.rosterCard} key={employee.title}>
              <div className={styles.rosterCardTop}>
                <span
                  className={`${styles.rosterAvatar} ${styles[`avatarTier-${employee.autonomy}`]}`}
                  aria-hidden="true"
                >
                  <AvatarIcon
                    dept={employee.dept}
                    inverse={employee.autonomy === "autonomous"}
                  />
                </span>
                <span className={styles.rosterDept}>{employee.dept}</span>
              </div>
              <h3 className={styles.rosterTitle}>{employee.title}</h3>
              <p className={styles.rosterDuty}>{employee.duty}</p>
              <span
                className={`${styles.rosterAutonomy} ${styles[`autonomy-${employee.autonomy}`]}`}
              >
                {autonomyLabels[employee.autonomy]}
              </span>
            </li>
          ))}
          <li className={`${styles.rosterCard} ${styles.rosterCardCustom}`}>
            <span className={styles.rosterAvatar} aria-hidden="true">+</span>
            <h3 className={styles.rosterTitle}>Build a custom employee</h3>
            <p className={styles.rosterDuty}>
              Give any role a title, a department, and instructions — it joins
              the team like the rest.
            </p>
          </li>
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="scenes-heading">
        <div className={styles.sectionHead}>
          <h2 id="scenes-heading" className={styles.sectionHeading}>
            They hand off work, and they show their work.
          </h2>
          <p className={styles.sectionText}>
            Employees delegate to each other by department, and every check
            an agent runs is logged — so "why did this happen" always has an
            answer.
          </p>
        </div>

        <div className={styles.scenesGrid}>
          <div className={styles.scenePanel}>
            <HandoffScene />
            <h3 className={styles.sceneTitle}>Agents hand off work</h3>
            <p className={styles.sceneText}>
              Operations flags a fulfillment risk and routes it straight to
              Finance for a cost call — no merchant relay required.
            </p>
          </div>
          <div className={styles.scenePanel}>
            <AuditScene />
            <h3 className={styles.sceneTitle}>Every check is an audit</h3>
            <p className={styles.sceneText}>
              Each run is logged with the data behind it, so an approved
              action is never a mystery six months later.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.sectionAlt} aria-labelledby="trust-heading">
        <div className={styles.sectionHead}>
          <h2 id="trust-heading" className={styles.sectionHeading}>
            Autonomy is graduated, never assumed.
          </h2>
          <p className={styles.sectionText}>
            Every employee starts as an advisor. You decide when — and
            whether — it moves further.
          </p>
        </div>

        <div className={styles.ladder}>
          {autonomySteps.map((step, index) => (
            <div className={styles.ladderStep} key={step}>
              <span
                className={
                  step === "autonomous"
                    ? `${styles.ladderIndex} ${styles.ladderIndexEarned}`
                    : styles.ladderIndex
                }
              >
                {index + 1}
              </span>
              <span className={styles.ladderLabel}>{autonomyLabels[step]}</span>
              <span className={styles.ladderDesc}>
                {step === "advisor" && "Recommends only — you act on it."}
                {step === "draft" && "Prepares the action, waits for your go-ahead."}
                {step === "limited" && "Acts within limits you set, reports back."}
                {step === "autonomous" && "Acts on its own for this task, fully trusted."}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.closing}>
        <h2 className={styles.closingHeading}>
          Your team is assembled. It's waiting on you.
        </h2>
        <p className={styles.sectionText}>
          Connect your store and your Chief of Staff will have a briefing
          ready before you finish your coffee.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span className={styles.labelText}>Shop domain</span>
              <input
                className={styles.input}
                type="text"
                name="shop"
                placeholder="my-shop-domain.myshopify.com"
              />
            </label>
            <button className={styles.button} type="submit">
              Put your team to work
            </button>
          </Form>
        )}
      </section>
    </div>
  );
}
