import { prisma } from "@/lib/db";
import { formatPrice } from "@/lib/tools/prisma-program-data";

export default async function ProgramsPage() {
  const [programs, docs] = await Promise.all([
    prisma.program.findMany({
      include: { venue: true, _count: { select: { registrations: true, sessions: true } } },
      orderBy: { startsOn: "asc" },
    }),
    prisma.knowledgeDoc.findMany({ include: { _count: { select: { chunks: true } } }, orderBy: { slug: "asc" } }),
  ]);
  return (
    <>
      <h1>What Sanad can see</h1>
      <p className="muted">Read-only. On the VM these come from the platform mirror; in the demo they come from prisma/seed.ts.</p>
      <h2>Programs</h2>
      <table>
        <thead>
          <tr>
            <th>Program</th>
            <th>When</th>
            <th>Venue</th>
            <th>Price</th>
            <th>Registered</th>
            <th>Sessions</th>
          </tr>
        </thead>
        <tbody>
          {programs.map((p) => (
            <tr key={p.id}>
              <td>
                {p.name} {!p.isOpen && <span className="pill">closed</span>}
                <div className="muted">{p.slug}</div>
              </td>
              <td>{p.dayOfWeek}s {p.timeOfDay}</td>
              <td>{p.venue.name}</td>
              <td>{formatPrice(p.priceCents)}</td>
              <td>{p._count.registrations} / {p.capacity}</td>
              <td>{p._count.sessions}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Knowledge docs</h2>
      <table>
        <thead>
          <tr>
            <th>Doc</th>
            <th>Category</th>
            <th>Published</th>
            <th>Chunks indexed</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id}>
              <td>{d.title}<div className="muted">{d.slug}</div></td>
              <td>{d.category}</td>
              <td>{d.isPublished ? "yes" : "no"}</td>
              <td>{d._count.chunks === 0 ? <span className="pill ESCALATED">not indexed — run npm run knowledge:reindex</span> : d._count.chunks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
