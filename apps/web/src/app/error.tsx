"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">EVS EYE · OPERATIONS</p>
        <h1>We could not load this view.</h1>
        <p className="muted">
          Your session is still safe. Try loading the workspace again, or sign
          in again if the problem continues.
        </p>
        <button type="button" onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  );
}
