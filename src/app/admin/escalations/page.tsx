import { prisma } from "@/lib/db";
import { redactAddress } from "@/lib/gateway/twilio";

export default async function EscalationsPage() {
  const rows = await prisma.escalation.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: "desc" },
    include: { conversation: true },
    take: 100,
  });
  return (
    <>
      <h1>Open escalations</h1>
      {rows.length === 0 ? (
        <p className="card muted">Nothing waiting on a human.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>From</th>
              <th>Reason</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="muted">{e.createdAt.toLocaleString("en-CA")}</td>
                <td>
                  <a href={`/admin/conversations/${e.conversationId}`}>{redactAddress(e.conversation.externalAddress)}</a>
                </td>
                <td><span className="pill ESCALATED">{e.reason}</span></td>
                <td>{e.excerpt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
