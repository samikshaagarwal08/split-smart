"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { db } from "@/lib/db";
import { syncPendingData } from "@/lib/sync";
import { useOnline } from "@/lib/useOnline";
import { useParams } from "next/navigation";
import {
  calculateNetBalances,
  simplifyDebts,
  ExpenseInput,
} from "@/lib/simplifyDebts";

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
  deleted?: boolean;
  name?: string | null;
};

type LocalSettlement = {
  id: string;
  fromUserId: string;
  toUserId: string;
  groupId: string;
  amount: number;
  status: "pending" | "paid";
  createdAt: string;
  updatedAt: string;
  synced: boolean;
  deleted?: boolean;
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
  const id = typeof params?.id === "string" ? params.id : undefined;
  const online = useOnline();
  const [group, setGroup] = useState<LocalGroup | null>(null);
  const [members, setMembers] = useState<LocalGroupMember[]>([]);
  const [expenses, setExpenses] = useState<LocalExpense[]>([]);
  const [settlements, setSettlements] = useState<LocalSettlement[]>([]);
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
      const [localGroup, localMembers, localExpenses, localSettlements] = await Promise.all([
        db.groups.get(id),
        db.members.where("groupId").equals(id).toArray(),
        db.expenses.where("groupId").equals(id).reverse().sortBy("createdAt"),
        db.settlements.where("groupId").equals(id).reverse().sortBy("createdAt"),
      ]);

      setGroup(localGroup ?? null);
      setMembers(dedupeMembersByUserId(localMembers ?? []));
      setExpenses(localExpenses ?? []);
      setSettlements(localSettlements ?? []);

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
      setSettlements([]);
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

  const memberMap = useMemo(
    () =>
      new Map(members.map((member) => [member.userId, member.name ?? member.userId])),
    [members],
  );

  const balanceEntries = useMemo(() => {
    const map = new Map<string, { paid: number; owed: number }>();

    for (const expense of expenses) {
      const payer = expense.users[0] ?? "unknown";
      const payerStats = map.get(payer) ?? { paid: 0, owed: 0 };
      map.set(payer, {
        paid: payerStats.paid + expense.amount,
        owed: payerStats.owed,
      });

      if (expense.splitType === "custom") {
        for (const split of expense.customSplits) {
          const current = map.get(split.userId) ?? { paid: 0, owed: 0 };
          map.set(split.userId, {
            paid: current.paid,
            owed: current.owed + split.amount,
          });
        }
      } else {
        const share = expense.users.length
          ? expense.amount / expense.users.length
          : 0;
        for (const userId of expense.users) {
          const current = map.get(userId) ?? { paid: 0, owed: 0 };
          map.set(userId, {
            paid: current.paid,
            owed: current.owed + share,
          });
        }
      }
    }

    return Array.from(map.entries()).map(([userId, stats]) => ({
      userId,
      name: memberMap.get(userId) ?? userId,
      paid: Number(stats.paid.toFixed(2)),
      owed: Number(stats.owed.toFixed(2)),
      net: Number((stats.paid - stats.owed).toFixed(2)),
    }));
  }, [expenses, memberMap]);

  const chartContributions = useMemo(() => {
    const contributions = new Map<string, number>();
    for (const expense of expenses) {
      const payer = expense.users[0] ?? "unknown";
      contributions.set(payer, (contributions.get(payer) ?? 0) + expense.amount);
    }
    return Array.from(contributions.entries()).map(([userId, amount]) => ({
      name: memberMap.get(userId) ?? userId,
      amount: Number(amount.toFixed(2)),
    }));
  }, [expenses, memberMap]);

  const settlementSuggestions = useMemo(() => {
    const expenseInputs: ExpenseInput[] = expenses.map((expense) => ({
      id: expense.id,
      amount: expense.amount,
      paidById: expense.users[0] ?? "unknown",
      splitType: expense.splitType,
      users: expense.users,
      customSplits: expense.customSplits,
    }));

    const balances = calculateNetBalances(expenseInputs);
    return simplifyDebts(balances).map((plan) => ({
      ...plan,
      fromName: memberMap.get(plan.from) ?? plan.from,
      toName: memberMap.get(plan.to) ?? plan.to,
    }));
  }, [expenses, memberMap]);

  const pendingCount = settlements.filter((item) => item.status === "pending").length;
  const paidCount = settlements.filter((item) => item.status === "paid").length;

  const settlementStatusData = [
    { name: "Pending", value: pendingCount },
    { name: "Paid", value: paidCount },
  ];

  const mostActiveMember = useMemo(() => {
    const activity = new Map<string, number>();
    for (const expense of expenses) {
      const payer = expense.users[0] ?? "unknown";
      activity.set(payer, (activity.get(payer) ?? 0) + 1);
    }
    const top = Array.from(activity.entries()).sort((a, b) => b[1] - a[1])[0];
    return top ? memberMap.get(top[0]) ?? top[0] : "—";
  }, [expenses, memberMap]);

  const totalPaid = balanceEntries.reduce((sum, item) => sum + item.paid, 0);

  const saveSettlementSuggestions = async () => {
    if (!id || settlementSuggestions.length === 0) return;
    const existing = await db.settlements.where("groupId").equals(id).toArray();
    const now = new Date().toISOString();
    const toAdd: LocalSettlement[] = [];

    for (const suggestion of settlementSuggestions) {
      const duplicate = existing.some(
        (item) =>
          item.fromUserId === suggestion.from &&
          item.toUserId === suggestion.to &&
          item.amount === suggestion.amount &&
          !item.deleted,
      );
      if (duplicate) continue;

      toAdd.push({
        id: crypto.randomUUID(),
        fromUserId: suggestion.from,
        toUserId: suggestion.to,
        groupId: id,
        amount: suggestion.amount,
        status: "pending",
        createdAt: now,
        updatedAt: now,
        synced: false,
      });
    }

    if (toAdd.length > 0) {
      await db.settlements.bulkAdd(toAdd);
      setSyncMessage("Saved suggested settlements locally.");
      await loadData();
    } else {
      setSyncMessage("No new settlement suggestions to save.");
    }
  };

  const markSettlementPaid = async (settlementId: string) => {
    await db.settlements.update(settlementId, {
      status: "paid",
      synced: false,
      updatedAt: new Date().toISOString(),
    });
    if (online) {
      await syncPendingData();
    }
    await loadData();
    setSyncMessage("Settlement marked paid.");
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/" className="text-sm font-medium text-emerald-700 hover:underline">
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

      <div className="mt-8 grid gap-4 lg:grid-cols-[1.5fr_0.9fr]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-zinc-500">Total expenses</p>
              <p className="mt-1 text-xl font-semibold text-zinc-900">
                {currency.format(totalExpenses)}
              </p>
            </div>
            <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-zinc-500">Total paid</p>
              <p className="mt-1 text-xl font-semibold text-zinc-900">
                {currency.format(totalPaid)}
              </p>
            </div>
            <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-zinc-500">Pending settlements</p>
              <p className="mt-1 text-xl font-semibold text-zinc-900">
                {pendingCount}
              </p>
            </div>
            <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-zinc-500">Most active</p>
              <p className="mt-1 text-xl font-semibold text-zinc-900">
                {mostActiveMember}
              </p>
            </div>
          </div>

          <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900">Expenses</h2>
                <p className="mt-1 text-sm text-zinc-500">Records of every shared cost.</p>
              </div>
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">
                {expenses.length} items
              </span>
            </div>

            {expenses.length === 0 ? (
              <div className="mt-6 rounded-3xl border border-dashed border-zinc-200 bg-zinc-50 px-6 py-10 text-center">
                <p className="text-sm font-medium text-zinc-800">No expenses available.</p>
                <p className="mt-2 text-sm text-zinc-500">
                  Add your first expense from the home page.
                </p>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                {expenses.map((expense) => (
                  <div key={expense.id} className="rounded-3xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-base font-semibold text-zinc-900">{expense.title}</p>
                        <p className="text-xs text-zinc-500">{formatDate(expense.createdAt)}</p>
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
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-2xl bg-white p-3 text-sm text-zinc-700">
                        <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Split type</p>
                        <p className="mt-2 font-medium text-zinc-900">{expense.splitType}</p>
                      </div>
                      <div className="rounded-2xl bg-white p-3 text-sm text-zinc-700">
                        <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Participants</p>
                        <p className="mt-2 font-medium text-zinc-900">{expense.users.length}</p>
                      </div>
                    </div>
                    {expense.splitType === "custom" ? (
                      <div className="mt-3 rounded-2xl bg-white p-3 text-sm text-zinc-700">
                        <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Custom splits</p>
                        <ul className="mt-2 space-y-1">
                          {expense.customSplits.map((split) => (
                            <li key={split.userId} className="flex items-center justify-between">
                              <span>{memberMap.get(split.userId) ?? split.userId}</span>
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

          <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900">Settlement plan</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Optimized payments to settle group balances.
                </p>
              </div>
              <button
                type="button"
                onClick={saveSettlementSuggestions}
                className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
              >
                Save suggestions
              </button>
            </div>

            {settlementSuggestions.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-500">
                Group is balanced or there is not enough data to compute settlements.
              </p>
            ) : (
              <ul className="mt-4 space-y-3 text-sm text-zinc-700">
                {settlementSuggestions.map((item) => (
                  <li key={`${item.from}-${item.to}-${item.amount}`} className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-zinc-900">{item.fromName} → {item.toName}</p>
                        <p className="mt-1 text-sm text-zinc-600">Pay {currency.format(item.amount)}</p>
                      </div>
                      <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">
                        Suggested
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900">Settlement history</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Tracked payments and settlement status.
                </p>
              </div>
            </div>

            {settlements.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-500">
                No saved settlements yet. Save suggested settlements to track them.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {settlements.map((item) => (
                  <div key={item.id} className="rounded-3xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium text-zinc-900">
                          {memberMap.get(item.fromUserId) ?? item.fromUserId} → {memberMap.get(item.toUserId) ?? item.toUserId}
                        </p>
                        <p className="mt-1 text-sm text-zinc-600">
                          {currency.format(item.amount)} • {formatDate(item.createdAt)}
                        </p>
                      </div>
                      <div className="flex flex-col items-start gap-2 sm:items-end">
                        <span className={
                          item.status === "paid"
                            ? "rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase text-emerald-700"
                            : "rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase text-amber-700"
                        }>
                          {item.status}
                        </span>
                        {item.status === "pending" ? (
                          <button
                            type="button"
                            onClick={() => void markSettlementPaid(item.id)}
                            className="rounded-full border border-emerald-600 px-3 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50"
                          >
                            Mark paid
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-zinc-900">Balance summary</h2>
            {balanceEntries.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-500">No balance data yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {balanceEntries.map((item) => (
                  <li key={item.userId} className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                    <span>{item.name}</span>
                    <span className={item.net >= 0 ? "text-emerald-700 font-semibold" : "text-red-700 font-semibold"}>
                      {item.net >= 0 ? "+" : ""}{currency.format(item.net)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-zinc-900">Expense distribution</h2>
            {chartContributions.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-500">No expense data ready for charting.</p>
            ) : (
              <div className="mt-4 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartContributions} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value) => typeof value === "number" ? currency.format(value) : ""} />
                    <Bar dataKey="amount" fill="#16a34a">
                      {chartContributions.map((entry) => (
                        <Cell key={entry.name} fill="#16a34a" />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-zinc-900">Settlement status</h2>
            {settlementStatusData.every((item) => item.value === 0) ? (
              <p className="mt-4 text-sm text-zinc-500">No tracked settlements yet.</p>
            ) : (
              <div className="mt-4 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={settlementStatusData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={42}
                      outerRadius={70}
                      paddingAngle={4}
                    >
                      {settlementStatusData.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={entry.name === "Paid" ? "#16a34a" : "#f59e0b"}
                        />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => typeof value === "number" ? `${value} settlements` : ""} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
