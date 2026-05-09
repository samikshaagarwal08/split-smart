"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/db";
import { pullGroupsToLocal, syncPendingData } from "@/lib/sync";
import { useOnline } from "@/lib/useOnline";
import { useParams } from "next/navigation";

type LocalExpense = {
  id: string;
  title: string;
  amount: number;
  groupId: string;
  splitType: "equal" | "custom";
  users: string[];
  customSplits: { userId: string; amount: number }[];
  createdAt: string;
  updatedAt: string;
  synced: boolean;
  deleted?: boolean;
};

type LocalGroup = {
  id: string;
  name: string;
  code: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  membersCount: number;
  memberIds: string[];
  synced: boolean;
  deleted?: boolean;
};

type LocalGroupMember = {
  id: string;
  userId: string;
  groupId: string;
  joinedAt: string;
  updatedAt: string;
  synced: boolean;
  name?: string | null;
};

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

function dedupeMembersByUserId(members: LocalGroupMember[]) {
  return Array.from(
    new Map(
      members
        .slice()
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        )
        .map((member) => [member.userId, member] as const),
    ).values(),
  );
}

const currency = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

export default function GroupDetailsPage() {
  const params = useParams();

  const id = params?.id;
  const online = useOnline();
  const [group, setGroup] = useState<LocalGroup | null>(null);
  const [members, setMembers] = useState<LocalGroupMember[]>([]);
  const [expenses, setExpenses] = useState<LocalExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);

    try {
      const [localGroup, localMembers, localExpenses] = await Promise.all([
        db.groups.get(id),
        db.members.where("groupId").equals(id).toArray(),
        db.expenses.where("groupId").equals(id).reverse().sortBy("createdAt"),
      ]);
      setGroup(localGroup ?? null);
      setMembers(dedupeMembersByUserId(localMembers ?? []));
      setExpenses(localExpenses ?? []);

      if (!localGroup) {
        setError(
          "Group not found locally. Try syncing or open from the home screen.",
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load group details",
      );
      setGroup(null);
      setMembers([]);
      setExpenses([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    void loadData();
  }, [id]);

  useEffect(() => {
    if (!online || !id) return;
    const sync = async () => {
      setSyncing(true);
      setSyncMessage(null);
      try {
        const result = await syncPendingData();
        if (result.errors > 0) {
          setSyncMessage(`Sync completed with ${result.errors} error(s).`);
        } else if (result.syncedGroups + result.syncedExpenses > 0) {
          setSyncMessage(
            `Synced ${result.syncedGroups} group(s) and ${result.syncedExpenses} expense(s).`,
          );
        } else {
          setSyncMessage("All data is up to date.");
        }
        setLastSyncedAt(new Date().toLocaleTimeString());
        await loadData();
      } catch {
        setSyncMessage(
          "Sync failed. Pending changes will retry automatically.",
        );
      } finally {
        setSyncing(false);
      }
    };
    void sync();
  }, [online, id]);

  const totalExpenses = useMemo(
    () => expenses.reduce((sum, expense) => sum + expense.amount, 0),
    [expenses],
  );

  const memberMap = useMemo(() => {
    return new Map(
      members.map((member) => [member.userId, member.name ?? member.userId]),
    );
  }, [members]);

  const balances = useMemo(() => {
    const map = new Map<string, number>();

    for (const expense of expenses) {
      const payer = expense.users[0] ?? "unknown";
      map.set(payer, (map.get(payer) ?? 0) + expense.amount);

      if (expense.splitType === "custom") {
        for (const split of expense.customSplits) {
          map.set(split.userId, (map.get(split.userId) ?? 0) - split.amount);
        }
      } else {
        const share = expense.users.length
          ? expense.amount / expense.users.length
          : 0;
        for (const userId of expense.users) {
          map.set(userId, (map.get(userId) ?? 0) - share);
        }
      }
    }

    return Array.from(map.entries()).map(([userId, balance]) => ({
      userId,
      balance: Number(balance.toFixed(2)),
      name: memberMap.get(userId) ?? userId,
    }));
  }, [expenses, memberMap]);

  const settlements = useMemo(() => {
    const creditors = balances
      .filter((item) => item.balance > 0)
      .map((item) => ({ ...item, cents: Math.round(item.balance * 100) }))
      .sort((a, b) => b.cents - a.cents);
    const debtors = balances
      .filter((item) => item.balance < 0)
      .map((item) => ({
        ...item,
        cents: Math.round(Math.abs(item.balance) * 100),
      }))
      .sort((a, b) => b.cents - a.cents);

    const output: Array<{
      fromUserId: string;
      fromName: string;
      toUserId: string;
      toName: string;
      amount: number;
    }> = [];

    let i = 0;
    let j = 0;

    while (i < debtors.length && j < creditors.length) {
      const debtor = debtors[i];
      const creditor = creditors[j];
      const settle = Math.min(debtor.cents, creditor.cents);

      output.push({
        fromUserId: debtor.userId,
        fromName: debtor.name,
        toUserId: creditor.userId,
        toName: creditor.name,
        amount: settle / 100,
      });

      debtor.cents -= settle;
      creditor.cents -= settle;
      if (debtor.cents === 0) i += 1;
      if (creditor.cents === 0) j += 1;
    }

    return output;
  }, [balances]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/"
            className="text-sm font-medium text-emerald-700 hover:underline"
          >
            ← Back to groups
          </Link>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-900">
            {group?.name ?? "Group details"}
          </h1>
          {group ? (
            <p className="mt-2 text-sm text-zinc-600">
              Join code: <span className="font-mono">{group.code}</span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 shadow-sm">
          <span>{online ? "Online" : "Offline"}</span>
          {syncing ? <span>Syncing…</span> : null}
          {syncMessage ? <span>{syncMessage}</span> : null}
          {lastSyncedAt ? <span>Last synced at {lastSyncedAt}</span> : null}
        </div>
      </div>

      {error ? (
        <div className="mt-8 rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-zinc-500">Members</p>
              <p className="mt-3 text-3xl font-semibold text-zinc-900">
                {members.length}
              </p>
            </div>
            <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-zinc-500">
                Total expenses
              </p>
              <p className="mt-3 text-3xl font-semibold text-zinc-900">
                {currency.format(totalExpenses)}
              </p>
            </div>
          </div>

          <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-900">Members</h2>
            <div className="mt-4 grid gap-2">
              {members.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  No member details available yet.
                </p>
              ) : (
                members.map((member) => (
                  <div
                    key={member.id}
                    className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3"
                  >
                    <p className="font-medium text-zinc-900">
                      {member.name ?? member.userId}
                    </p>
                    <p className="text-xs text-zinc-500">{member.userId}</p>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold text-zinc-900">Expenses</h2>
              <span className="text-xs uppercase tracking-[0.12em] text-zinc-500">
                {expenses.length} items
              </span>
            </div>
            {expenses.length === 0 ? (
              <div className="mt-6 rounded-3xl border border-dashed border-zinc-200 bg-zinc-50 px-6 py-10 text-center">
                <p className="text-sm font-medium text-zinc-800">
                  No expenses available.
                </p>
                <p className="mt-2 text-sm text-zinc-500">
                  Add your first expense from the home page.
                </p>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                {expenses.map((expense) => (
                  <div
                    key={expense.id}
                    className="rounded-3xl border border-zinc-200 bg-zinc-50 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-base font-semibold text-zinc-900">
                          {expense.title}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {formatDate(expense.createdAt)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-semibold text-zinc-900">
                          {currency.format(expense.amount)}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {expense.synced ? "Synced" : "Pending"}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-2xl bg-white p-3 text-sm text-zinc-700">
                        <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                          Split type
                        </p>
                        <p className="mt-2 font-medium text-zinc-900">
                          {expense.splitType}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-white p-3 text-sm text-zinc-700">
                        <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                          Participants
                        </p>
                        <p className="mt-2 font-medium text-zinc-900">
                          {expense.users.length}
                        </p>
                      </div>
                    </div>
                    {expense.splitType === "custom" ? (
                      <div className="mt-3 rounded-2xl bg-white p-3 text-sm text-zinc-700">
                        <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                          Custom splits
                        </p>
                        <ul className="mt-2 space-y-1">
                          {expense.customSplits.map((split) => (
                            <li
                              key={split.userId}
                              className="flex items-center justify-between"
                            >
                              <span>
                                {memberMap.get(split.userId) ?? split.userId}
                              </span>
                              <span>{currency.format(split.amount)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-zinc-900">
              Balance summary
            </h2>
            {balances.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-500">No balance data yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {balances.map((item) => (
                  <li
                    key={item.userId}
                    className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3"
                  >
                    <span>{item.name}</span>
                    <span
                      className={
                        item.balance >= 0
                          ? "text-emerald-700 font-semibold"
                          : "text-red-700 font-semibold"
                      }
                    >
                      {item.balance >= 0 ? "+" : ""}
                      {currency.format(item.balance)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-zinc-900">
              Settlement plan
            </h2>
            {settlements.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-500">
                Group is already balanced or has no outstanding settlements.
              </p>
            ) : (
              <ul className="mt-4 space-y-3 text-sm text-zinc-700">
                {settlements.map((item, index) => (
                  <li
                    key={`${item.fromUserId}-${item.toUserId}-${index}`}
                    className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3"
                  >
                    <p className="font-medium text-zinc-900">
                      {item.fromName} → {item.toName}
                    </p>
                    <p className="mt-1 text-sm text-zinc-600">
                      Pay {currency.format(item.amount)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
