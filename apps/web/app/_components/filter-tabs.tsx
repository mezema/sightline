import Link from "next/link";

export type Bucket = "all" | "defect" | "clean" | "failed";

type Counts = Record<Bucket, number>;

export function FilterTabs({ active, counts, baseHref }: { active: Bucket; counts: Counts; baseHref: string }) {
  const config: Array<[Bucket, string]> = [
    ["all", "All"],
    ["defect", "Defect"],
    ["clean", "Clean"],
    ["failed", "Failed"],
  ];
  return (
    <div className="filter-tabs" role="tablist" aria-label="Result filters">
      {config.map(([key, label]) => (
        <Link
          key={key}
          role="tab"
          aria-pressed={active === key}
          className="filter-tab"
          href={key === "all" ? baseHref : `${baseHref}?b=${key}`}
        >
          {label} <span className="count">{counts[key]}</span>
        </Link>
      ))}
    </div>
  );
}
