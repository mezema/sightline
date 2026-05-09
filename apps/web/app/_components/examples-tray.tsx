import Link from "next/link";
import { EXAMPLES } from "./examples";

export function ExamplesTray() {
  return (
    <section className="examples" aria-labelledby="examples-heading">
      <h2 className="examples-heading" id="examples-heading">Try a worked example.</h2>
      <ul className="examples-grid">
        {EXAMPLES.map((example) => (
          <li key={example.id}>
            <Link className="example-card" href={`/i/new?example=${example.id}`}>
              <div className="example-image">
                <img src={example.reference.url} alt="" />
              </div>
              <div className="example-caption">
                <strong>{example.title}</strong>
                <span className="example-description">{example.description}</span>
                <span className="example-meta">{example.targets.length} targets</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <p className="examples-blank">
        Or <Link href="/i/new">start a blank inspection</Link>.
      </p>
    </section>
  );
}
