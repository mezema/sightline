export function formatRelative(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.round(diffMs / 60000);
  const hours = Math.round(diffMs / 3600000);
  const days = Math.round(diffMs / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 2) return "yesterday";
  if (days < 7) return `${days}d ago`;

  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  }).format(date);
}
