import type { GroupListItem } from "@/types/group";

type Props = { group: GroupListItem };

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function GroupCard({ group }: Props) {
  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm shadow-zinc-950/[0.04] transition hover:border-zinc-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{group.name}</h2>
        <span className="rounded-md bg-zinc-100 px-2 py-1 font-mono text-xs text-zinc-700">
          {group.code}
        </span>
      </div>
      <p className="mt-2 text-sm text-zinc-500">Created {formatDate(group.createdAt)}</p>
      <p className="mt-1 text-xs text-zinc-500">{group.membersCount} member(s)</p>
    </article>
  );
}
