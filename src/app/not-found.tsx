import { Compass } from "lucide-react";
import Link from "next/link";

/**
 * Unmatched routes used to render Next's unstyled default 404 (for signed-in
 * users), which dropped out of the app's visual language entirely.
 * Note: signed-out visitors are redirected to /sign-in by the middleware, so
 * this page is reached by authenticated users following a stale link.
 */
export default function NotFound() {
  return (
    <main className="app-page">
      <div className="inbox-empty-state mx-auto max-w-xl">
        <span className="inbox-empty-icon">
          <Compass size={23} aria-hidden="true" />
        </span>
        <h1 className="dashboard-title !text-2xl">This page isn’t here</h1>
        <p>
          The link may be out of date, or the address was mistyped. Nothing was
          lost — head back and pick up where you were.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <Link href="/" className="cta-primary">
            Back to home
          </Link>
          <Link href="/dashboard" className="cta-secondary">
            Open my inbox
          </Link>
        </div>
      </div>
    </main>
  );
}
