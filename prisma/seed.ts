/**
 * Demo seed: two FaezSports programs, one venue, a handful of registrations,
 * and the knowledge docs from docs/knowledge/*.md. Idempotent (upserts by slug).
 *
 * Program/registration data here stands in for the platform's read-only mirror
 * during the Mac Mini demo. Knowledge docs are DRAFT placeholders until Alex
 * supplies the real policy text (SPEC §14.1).
 */
import "../scripts/load-env";
import { PrismaClient } from "@prisma/client";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();

/** Toronto local times regardless of the host's TZ (EDT in Sep-Oct, when the demo programs run). */
const TORONTO_OFFSET = "-04:00";

function upcomingWeekly(dayOfWeek: number, hour: number, minute: number, count: number, startFrom: Date) {
  const out: { startsAt: Date; endsAt: Date }[] = [];
  const d = new Date(startFrom);
  d.setUTCHours(12, 0, 0, 0);
  while (d.getUTCDay() !== dayOfWeek) d.setUTCDate(d.getUTCDate() + 1);
  while (out.length < count) {
    const ymd = d.toISOString().slice(0, 10);
    const hh = String(hour).padStart(2, "0");
    const mm = String(minute).padStart(2, "0");
    const startsAt = new Date(`${ymd}T${hh}:${mm}:00${TORONTO_OFFSET}`);
    const endsAt = new Date(startsAt.getTime() + 90 * 60_000);
    out.push({ startsAt, endsAt });
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

async function main() {
  const venue = await prisma.venue.upsert({
    where: { id: "venue-demo-gym" },
    update: {},
    create: {
      id: "venue-demo-gym",
      name: "Scarborough Community Gym",
      address: "1250 Markham Rd, Scarborough, ON M1H 2Y5",
      parking: "Free lot at the north entrance; overflow on Progress Ave.",
      accessNotes: "Enter through the north doors by the parking lot. Indoor shoes required on the court.",
    },
  });

  const now = new Date();
  const programs = [
    {
      slug: "fall-girls-basketball-9-12",
      name: "Fall Girls Basketball (Ages 9-12)",
      sport: "Basketball",
      ageRange: "9-12",
      dayOfWeek: "Saturday",
      timeOfDay: "10:00-11:30",
      priceCents: 18000,
      capacity: 24,
      registrationUrl: "https://faezsports.com/programs/fall-girls-basketball",
      sessions: upcomingWeekly(6, 10, 0, 8, now),
    },
    {
      slug: "fall-boys-basketball-13-15",
      name: "Fall Boys Basketball (Ages 13-15)",
      sport: "Basketball",
      ageRange: "13-15",
      dayOfWeek: "Sunday",
      timeOfDay: "13:00-14:30",
      priceCents: 20000,
      capacity: 24,
      registrationUrl: "https://faezsports.com/programs/fall-boys-basketball",
      sessions: upcomingWeekly(0, 13, 0, 8, now),
    },
  ];

  for (const p of programs) {
    const { sessions, ...data } = p;
    const program = await prisma.program.upsert({
      where: { slug: p.slug },
      update: { ...data, venueId: venue.id, startsOn: sessions[0].startsAt },
      create: { ...data, venueId: venue.id, startsOn: sessions[0].startsAt },
    });
    await prisma.session.deleteMany({ where: { programId: program.id } });
    await prisma.session.createMany({ data: sessions.map((s) => ({ ...s, programId: program.id })) });
  }

  const girls = await prisma.program.findUniqueOrThrow({ where: { slug: "fall-girls-basketball-9-12" } });
  await prisma.registration.deleteMany({ where: { parentPhone: { in: ["+14165550100", "+14165550200"] } } });
  await prisma.registration.createMany({
    data: [
      {
        programId: girls.id,
        childFirstName: "Maya",
        childLastName: "Demo",
        childAge: 10,
        parentName: "Demo Parent One",
        parentPhone: "+14165550100",
        parentEmail: "parent1@example.com",
        paymentStatus: "PAID",
      },
      {
        programId: girls.id,
        childFirstName: "Zara",
        childLastName: "Demo",
        childAge: 11,
        parentName: "Demo Parent Two",
        parentPhone: "+14165550200",
        parentEmail: "parent2@example.com",
        paymentStatus: "UNPAID",
      },
    ],
  });

  const dir = path.join(__dirname, "..", "docs", "knowledge");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    const body = readFileSync(path.join(dir, file), "utf8");
    const slug = file.replace(/\.md$/, "");
    const title = body.split("\n")[0].replace(/^#\s*/, "").trim();
    const category = slug.split("-")[0];
    await prisma.knowledgeDoc.upsert({
      where: { slug },
      update: { title, body, category, isPublished: true },
      create: { slug, title, body, category, isPublished: true },
    });
  }

  console.log("seeded: 1 venue, 2 programs, 2 registrations, knowledge docs from docs/knowledge");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
