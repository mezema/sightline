import Link from "next/link";
import { SignIn } from "@clerk/nextjs";

import { APPEARANCE } from "../../_components/auth-clerk-appearance";

export default function Page() {
  return (
    <main className="auth-shell">
      <div className="auth-content">
        <Link className="brand auth-brand" href="/">
          <span>Sightline</span>
        </Link>
        <h1 className="auth-lede">A durable defect-inspection workflow.</h1>
        <p className="auth-paragraph">
          Give a reference image, a defect description, and up to{" "}
          <span className="num">25</span> targets. Sightline finds where the
          defect appears across them, runs the inspection in the background,
          and survives refreshes and return visits.
        </p>
        <div className="auth-form">
          <SignIn appearance={APPEARANCE} signUpUrl="/sign-up" />
        </div>
        <p className="auth-footer">
          New here? <Link href="/sign-up">Create an account →</Link>
        </p>
      </div>
    </main>
  );
}
