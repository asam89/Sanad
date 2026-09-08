import { prisma } from "@/lib/db";
import { redactAddress } from "@/lib/gateway/twilio";

export default async function ConversationsPage() {
  const convos = await prisma.conversation.findMany({
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: {
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { messages: true, escalations: { where: { resolvedAt: null } } } },
    },
  });

  return (
    <>
      <h1>Conversations</h1>
      {convos.length === 0 ? (
        <p className="card muted">
          No conversations yet. Try the <a href="/admin/simulator">simulator</a>.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>From</th>
              <th>State</th>
              <th>Last message</th>
              <th>Msgs</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {convos.map((c) => (
              <tr key={c.id}>
                <td>
                  <a href={`/admin/conversations/${c.id}`}>{redactAddress(c.externalAddress)}</a>
                  {c.optedOut && <span className="pill"> STOP</span>}
                </td>
                <td>
                  <span className={`pill ${c.state}`}>{c.state}</span>
                  {c._count.escalations > 0 && <span className="pill ESCALATED"> {c._count.escalations} open</span>}
                </td>
                <td className="muted">{c.messages[0]?.body.slice(0, 80)}</td>
                <td>{c._count.messages}</td>
                <td className="muted">{c.updatedAt.toLocaleString("en-CA")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
