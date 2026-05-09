import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
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
          <SignUp appearance={APPEARANCE} signInUrl="/sign-in" />
        </div>
        <p className="auth-footer">
          Already have an account? <Link href="/sign-in">Sign in →</Link>
        </p>
      </div>
    </main>
  );
}
