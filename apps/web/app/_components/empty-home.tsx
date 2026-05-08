import Link from "next/link";

export function EmptyHome() {
  return (
    <section className="empty-home">
      <h2>No inspections yet</h2>
      <p>Define a defect, drop in target images, and Sightline will check them.</p>
      <Link className="btn" href="/i/new">+ Start your first inspection</Link>
    </section>
  );
}
