import { NextResponse, type NextRequest } from "next/server";

/**
 * HTTP Basic auth for the admin console and admin APIs. User is "admin";
 * password is SANAD_ADMIN_PASSWORD. With no password configured, admin is off.
 * The Twilio webhook is not under this matcher — it authenticates by signature.
 */
export function middleware(req: NextRequest) {
  const password = process.env.SANAD_ADMIN_PASSWORD;
  if (!password) return new NextResponse("admin disabled", { status: 404 });

  const header = req.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const [user, ...rest] = atob(encoded).split(":");
    if (user === "admin" && rest.join(":") === password) return NextResponse.next();
  }
  return new NextResponse("authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Sanad admin"' },
  });
}

export const config = { matcher: ["/admin/:path*", "/api/sanad/admin/:path*"] };
