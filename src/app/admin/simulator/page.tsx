import { Simulator } from "./simulator";

export default function SimulatorPage() {
  return (
    <>
      <h1>WhatsApp simulator</h1>
      <p className="muted">
        Sends a message through the real Sanad pipeline (router → tools → local model → escalation) without Twilio.
        Seeded demo parents: <code>+14165550100</code> (Maya, paid) and <code>+14165550200</code> (Zara, unpaid). Any other
        number is a prospect with no registrations.
      </p>
      <Simulator />
    </>
  );
}
