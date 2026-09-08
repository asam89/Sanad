import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <nav className="nav">
        <a className="brand" href="/admin">
          Sanad<span>admin</span>
        </a>
        <a href="/admin">Conversations</a>
        <a href="/admin/escalations">Escalations</a>
        <a href="/admin/programs">Programs</a>
        <a href="/admin/simulator">Simulator</a>
      </nav>
      <main>{children}</main>
    </>
  );
}
