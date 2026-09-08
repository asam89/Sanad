import { prisma } from "@/lib/db";
import type { HouseholdRegistration, ProgramData, ProgramDetails, ProgramSummary, SessionInfo, VenueInfo } from "./index";

const TZ = process.env.SANAD_TZ ?? "America/Toronto";

export function formatWhen(d: Date): string {
  return d.toLocaleString("en-CA", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(0)} CAD`;
}

/** Demo implementation over Sanad's own Program tables. On the VM this is swapped for the platform mirror. */
export class PrismaProgramData implements ProgramData {
  async openPrograms(): Promise<ProgramSummary[]> {
    const rows = await prisma.program.findMany({
      where: { isOpen: true },
      include: { venue: true, _count: { select: { registrations: true } } },
      orderBy: { startsOn: "asc" },
    });
    return rows.map((p) => summary(p, p.venue.name, p._count.registrations));
  }

  async programDetails(slug: string): Promise<ProgramDetails | null> {
    const p = await prisma.program.findUnique({
      where: { slug },
      include: { venue: true, _count: { select: { registrations: true } } },
    });
    if (!p) return null;
    return {
      ...summary(p, p.venue.name, p._count.registrations),
      venueAddress: p.venue.address,
      parking: p.venue.parking,
      accessNotes: p.venue.accessNotes,
    };
  }

  async upcomingSessions(slug: string, limit: number): Promise<SessionInfo[]> {
    const rows = await prisma.session.findMany({
      where: { program: { slug }, startsAt: { gte: new Date() } },
      include: { program: { include: { venue: true } } },
      orderBy: { startsAt: "asc" },
      take: limit,
    });
    return rows.map((s) => ({
      program: s.program.name,
      startsAt: formatWhen(s.startsAt),
      endsAt: formatWhen(s.endsAt),
      venue: s.program.venue.name,
      note: s.note,
    }));
  }

  async registrationsForPhone(phoneE164: string): Promise<HouseholdRegistration[]> {
    const rows = await prisma.registration.findMany({
      where: { parentPhone: phoneE164 },
      include: {
        program: {
          include: {
            venue: true,
            sessions: { where: { startsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" }, take: 1 },
          },
        },
      },
    });
    return rows.map((r) => ({
      childFirstName: r.childFirstName,
      program: r.program.name,
      programSlug: r.program.slug,
      paymentStatus: r.paymentStatus,
      nextSession: r.program.sessions[0] ? formatWhen(r.program.sessions[0].startsAt) : null,
      venue: r.program.venue.name,
    }));
  }

  async venues(): Promise<VenueInfo[]> {
    const rows = await prisma.venue.findMany({ orderBy: { name: "asc" } });
    return rows.map((v) => ({ name: v.name, address: v.address, parking: v.parking, accessNotes: v.accessNotes }));
  }
}

function summary(
  p: {
    slug: string;
    name: string;
    sport: string;
    ageRange: string;
    dayOfWeek: string;
    timeOfDay: string;
    priceCents: number;
    capacity: number;
    startsOn: Date;
    registrationUrl: string;
  },
  venue: string,
  registered: number,
): ProgramSummary {
  return {
    slug: p.slug,
    name: p.name,
    sport: p.sport,
    ageRange: p.ageRange,
    dayOfWeek: p.dayOfWeek,
    timeOfDay: p.timeOfDay,
    price: formatPrice(p.priceCents),
    spotsLeft: Math.max(0, p.capacity - registered),
    startsOn: p.startsOn.toLocaleDateString("en-CA", { timeZone: TZ, month: "long", day: "numeric" }),
    venue,
    registrationUrl: p.registrationUrl,
  };
}
