import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { redactAddress } from "@/lib/gateway/twilio";
import { setState } from "./actions";

export default async function ConversationPage({ params }: { params: { id: string } }) {
  const convo = await prisma.conversation.findUnique({
    where: { id: params.id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      escalations: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!convo) notFound();

  return (
    <>
      <h1>
        {redactAddress(convo.externalAddress)} <span className={`pill ${convo.state}`}>{convo.state}</span>
        {convo.optedOut && <span className="pill"> opted out</span>}
      </h1>
      <p className="muted">
        {convo.channel} · started {convo.createdAt.toLocaleString("en-CA")} · full address is only shown to staff in Twilio
      </p>

      <form action={setState} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input type="hidden" name="id" value={convo.id} />
        {convo.state !== "HUMAN_TAKEOVER" ? (
          <button name="state" value="HUMAN_TAKEOVER">Take over (pause bot)</button>
        ) : (
          <button name="state" value="BOT">Hand back to bot</button>
        )}
        {convo.escalations.some((e) => !e.resolvedAt) && (
          <button name="state" value="RESOLVE" style={{ background: "#374151" }}>Resolve escalations</button>
        )}
      </form>

      <div className="thread">
        {convo.messages.map((m) => (
          <div key={m.id} className={`bubble ${m.direction === "INBOUND" ? "in" : "out"}`}>
            {m.body}
            <span className="meta">
              {m.createdAt.toLocaleTimeString("en-CA")}
              {m.routePath && ` · ${m.routePath}`}
              {m.intent && ` · ${m.intent}`}
              {m.latencyMs != null && ` · ${m.latencyMs} ms`}
            </span>
          </div>
        ))}
      </div>

      {convo.escalations.length > 0 && (
        <>
          <h2>Escalations</h2>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Reason</th>
                <th>Excerpt</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {convo.escalations.map((e) => (
                <tr key={e.id}>
                  <td className="muted">{e.createdAt.toLocaleString("en-CA")}</td>
                  <td><span className="pill ESCALATED">{e.reason}</span></td>
                  <td>{e.excerpt}</td>
                  <td className="muted">{e.resolvedAt ? `resolved ${e.resolvedAt.toLocaleString("en-CA")}` : "open"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
