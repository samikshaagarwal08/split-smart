"use client";

import { GroupCard } from "@/components/GroupCard";
import { db, type LocalExpense } from "@/lib/db";
import { pullGroupsToLocal, syncPendingData } from "@/lib/sync";
import { useOnline } from "@/lib/useOnline";
import type { GroupListItem } from "@/types/group";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

function readErrorMessage(data: unknown, fallback: string) {
  if (
    data &&
    typeof data === "object" &&
    "error" in data &&
    typeof (data as { error: unknown }).error === "string"
  ) {
    return (data as { error: string }).error;
  }
  return fallback;
}

async function assertOk(res: Response, fallback: string) {
  const data: unknown = await res.json();
  if (!res.ok) throw new Error(readErrorMessage(data, fallback));
  return data;
}

export default function Home() {
  const online = useOnline();

  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [expenseTitle, setExpenseTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [splitType, setSplitType] = useState<"equal" | "custom">("equal");
  const [customUserId, setCustomUserId] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [customSplits, setCustomSplits] = useState<{ userId: string; amount: number }[]>([]);

  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [expenses, setExpenses] = useState<LocalExpense[]>([]);

  const [loadingList, setLoadingList] = useState(true);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [addingExpense, setAddingExpense] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [listError, setListError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [expenseSuccess, setExpenseSuccess] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const loadLocalData = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const [localGroups, localExpenses] = await Promise.all([
        db.groups.orderBy("createdAt").reverse().toArray(),
        db.expenses.orderBy("createdAt").reverse().toArray(),
      ]);
      setGroups(localGroups as GroupListItem[]);
      setExpenses(localExpenses);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Could not load local data");
      setGroups([]);
      setExpenses([]);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const runSync = useCallback(async () => {
    if (!online) return;
    setSyncing(true);
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
      await loadLocalData();
    } catch {
      setSyncMessage("Sync failed. Pending data will retry automatically.");
    } finally {
      setSyncing(false);
    }
  }, [loadLocalData, online]);

  useEffect(() => {
    startTransition(() => {
      void loadLocalData();
    });
  }, [loadLocalData, startTransition]);

  useEffect(() => {
    if (!online) return;
    void (async () => {
      await pullGroupsToLocal();
      await runSync();
      await loadLocalData();
    })();
  }, [online, loadLocalData, runSync]);

  const createGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setFormError("Enter a group name first.");
      return;
    }

    setCreating(true);
    try {
      const groupId = crypto.randomUUID();
      await db.groups.put({
        id: groupId,
        name: trimmed,
        code: "PENDING",
        createdAt: new Date().toISOString(),
        ownerId: "me",
        membersCount: 0,
        memberIds: [],
        synced: !online,
        pendingAction: "create",
      });
      await db.members.put({
        id: `${groupId}:me`,
        userId: "me",
        groupId,
        joinedAt: new Date().toISOString(),
        synced: !online,
      });
      setName("");
      await loadLocalData();
      if (online) await runSync();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not create group");
    } finally {
      setCreating(false);
    }
  };

  const joinGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError(null);
    if (!joinCode.trim()) {
      setJoinError("Enter a join code.");
      return;
    }
    if (!online) {
      setJoinError("Join needs internet. Cached groups are still available offline.");
      return;
    }

    setJoining(true);
    try {
      const res = await fetch("/api/groups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: joinCode.trim().toUpperCase() }),
      });
      await assertOk(res, "Could not join group");
      setJoinCode("");
      await pullGroupsToLocal();
      await loadLocalData();
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : "Could not join group");
    } finally {
      setJoining(false);
    }
  };

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  const selectedGroupExpenses = useMemo(() => {
    if (!selectedGroupId) return expenses;
    return expenses.filter((exp) => exp.groupId === selectedGroupId);
  }, [expenses, selectedGroupId]);

  const localBalances = useMemo(() => {
    const map = new Map<string, number>();
    const source = selectedGroupId
      ? expenses.filter((exp) => exp.groupId === selectedGroupId)
      : expenses;

    for (const exp of source) {
      const payer = exp.users[0] ?? "member";
      map.set(payer, (map.get(payer) ?? 0) + exp.amount);
      if (exp.splitType === "custom") {
        for (const split of exp.customSplits) {
          map.set(split.userId, (map.get(split.userId) ?? 0) - split.amount);
        }
      } else {
        const share = exp.users.length ? exp.amount / exp.users.length : 0;
        for (const userId of exp.users) {
          map.set(userId, (map.get(userId) ?? 0) - share);
        }
      }
    }

    return Array.from(map.entries()).map(([userId, balance]) => ({
      userId,
      balance: Number(balance.toFixed(2)),
    }));
  }, [expenses, selectedGroupId]);

  const addCustomSplit = () => {
    if (!customUserId) return;
    const parsed = Number(customAmount);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    setCustomSplits((prev) => {
      const filtered = prev.filter((item) => item.userId !== customUserId);
      return [...filtered, { userId: customUserId, amount: parsed }];
    });
    setCustomAmount("");
  };

  const createExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setExpenseError(null);
    setExpenseSuccess(null);

    const parsedAmount = Number(amount);
    if (!selectedGroupId) return setExpenseError("Select a group first.");
    if (selectedGroup && selectedGroup.synced === false) {
      return setExpenseError("Wait for this group to sync before adding expenses.");
    }
    if (!expenseTitle.trim()) return setExpenseError("Expense title is required.");
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return setExpenseError("Amount must be greater than 0.");
    }

    setAddingExpense(true);
    try {
      const localExpense: LocalExpense = {
        id: crypto.randomUUID(),
        title: expenseTitle.trim(),
        amount: Number(parsedAmount.toFixed(2)),
        groupId: selectedGroupId,
        splitType,
        users: selectedGroup?.memberIds ?? [],
        customSplits: splitType === "custom" ? customSplits : [],
        createdAt: new Date().toISOString(),
        synced: !online,
      };

      await db.expenses.put(localExpense);
      setExpenseSuccess(
        online ? "Expense saved locally and queued for sync." : "Expense saved offline.",
      );
      setExpenseTitle("");
      setAmount("");
      setCustomSplits([]);
      await loadLocalData();
      if (online) await runSync();
    } catch (e) {
      setExpenseError(e instanceof Error ? e.message : "Could not add expense");
    } finally {
      setAddingExpense(false);
    }
  };

  const pendingCount = useMemo(() => {
    const unsyncedGroups = groups.filter((g) => !g.synced).length;
    const unsyncedExpenses = expenses.filter((e) => !e.synced).length;
    return unsyncedGroups + unsyncedExpenses;
  }, [groups, expenses]);

  return (
    <div className="flex flex-1 flex-col">
      <div suppressHydrationWarning>
        {!online ? (
          <div className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-center text-sm font-medium text-amber-900">
            Offline mode active. Changes are saved locally and will sync automatically.
          </div>
        ) : null}
      </div>

      <section className="border-b border-zinc-200 bg-linear-to-br from-zinc-50 via-white to-emerald-50/50">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-emerald-700">SplitSmart Premium</p>
            <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-xs text-white">
              {online ? "Online" : "Offline"}
            </span>
            {syncing ? (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                Syncing...
              </span>
            ) : null}
            {pendingCount > 0 ? (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700">
                {pendingCount} pending
              </span>
            ) : null}
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            Local-first expense splitting
          </h1>
          <p className="mt-3 max-w-2xl text-base text-zinc-600">
            UI always reads from IndexedDB first. You can keep adding data in airplane mode.
          </p>
          {syncMessage ? <p className="mt-3 text-sm text-zinc-600">{syncMessage}</p> : null}

          <form onSubmit={createGroup} className="mt-8 flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label htmlFor="group-name" className="sr-only">Group name</label>
              <input
                id="group-name"
                type="text"
                autoComplete="off"
                placeholder="e.g. Goa Trip 2026"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={creating}
                className="w-full rounded-xl border border-zinc-300 bg-white/90 px-4 py-3 text-sm text-zinc-900 shadow-sm outline-none ring-emerald-500/20 transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-4 disabled:opacity-60"
              />
              {formError ? <p className="mt-2 text-sm text-red-600">{formError}</p> : null}
            </div>
            <button
              type="submit"
              disabled={creating}
              className="inline-flex shrink-0 items-center justify-center rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:opacity-50"
            >
              {creating ? "Saving..." : "Create group"}
            </button>
          </form>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl flex-1 space-y-8 px-4 py-10 sm:px-6">
        <div className="grid gap-4 md:grid-cols-2">
          <form onSubmit={joinGroup} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h3 className="text-base font-semibold text-zinc-900">Join with code</h3>
            <p className="mt-1 text-sm text-zinc-600">Joining requires internet.</p>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="e.g. A1B2C3"
              className="mt-4 w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-500"
            />
            {joinError ? <p className="mt-2 text-sm text-red-600">{joinError}</p> : null}
            <button
              type="submit"
              disabled={joining || !online}
              className="mt-4 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {joining ? "Joining..." : "Join group"}
            </button>
          </form>

          <form onSubmit={createExpense} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h3 className="text-base font-semibold text-zinc-900">Add expense</h3>
            <p className="mt-1 text-sm text-zinc-600">Always writes local first, then syncs.</p>
            <div className="mt-4 grid gap-3">
              <select
                value={selectedGroupId}
                onChange={(e) => setSelectedGroupId(e.target.value)}
                className="rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-500"
              >
                <option value="">Select group</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
              <input
                value={expenseTitle}
                onChange={(e) => setExpenseTitle(e.target.value)}
                placeholder="Expense title"
                className="rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-500"
              />
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount"
                type="number"
                step="0.01"
                className="rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-500"
              />
              <div className="flex gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => setSplitType("equal")}
                  className={`rounded-md px-3 py-1.5 ${splitType === "equal" ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-700"}`}
                >
                  Equal
                </button>
                <button
                  type="button"
                  onClick={() => setSplitType("custom")}
                  className={`rounded-md px-3 py-1.5 ${splitType === "custom" ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-700"}`}
                >
                  Custom
                </button>
              </div>

              {splitType === "custom" && selectedGroup ? (
                <div className="rounded-lg border border-zinc-200 p-3">
                  <div className="flex gap-2">
                    <select
                      value={customUserId}
                      onChange={(e) => setCustomUserId(e.target.value)}
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                    >
                      <option value="">Select user</option>
                      {selectedGroup.memberIds.map((memberId) => (
                        <option key={memberId} value={memberId}>{memberId}</option>
                      ))}
                    </select>
                    <input
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value)}
                      type="number"
                      step="0.01"
                      placeholder="Split"
                      className="w-28 rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                    />
                    <button type="button" onClick={addCustomSplit} className="rounded-lg bg-zinc-100 px-3 py-2 text-sm">
                      Add
                    </button>
                  </div>
                  {customSplits.length > 0 ? (
                    <ul className="mt-2 text-xs text-zinc-600">
                      {customSplits.map((item) => (
                        <li key={item.userId}>{item.userId}: {item.amount.toFixed(2)}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>

            {expenseError ? <p className="mt-2 text-sm text-red-600">{expenseError}</p> : null}
            {expenseSuccess ? <p className="mt-2 text-sm text-emerald-700">{expenseSuccess}</p> : null}
            <button
              type="submit"
              disabled={addingExpense}
              className="mt-4 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {addingExpense ? "Saving..." : "Add expense"}
            </button>
          </form>
        </div>

        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold text-zinc-900">Your groups (from IndexedDB)</h2>
          {!loadingList && groups.length > 0 ? <span className="text-sm text-zinc-500">{groups.length} total</span> : null}
        </div>

        <div>
          {loadingList ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50 py-16 text-center">
              <span className="size-8 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-600" aria-hidden />
              <p className="mt-4 text-sm font-medium text-zinc-600">Loading local data...</p>
            </div>
          ) : listError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center">
              <p className="text-sm font-medium text-red-800">{listError}</p>
              <button type="button" onClick={() => void loadLocalData()} className="mt-4 text-sm font-semibold text-red-900 underline-offset-2 hover:underline">
                Try again
              </button>
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/80 px-6 py-14 text-center">
              <p className="text-base font-medium text-zinc-800">No groups yet</p>
              <p className="mx-auto mt-2 max-w-sm text-sm text-zinc-600">Create your first group above. It will be stored locally immediately.</p>
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {groups.map((g) => (
                <li key={g.id}><GroupCard group={g} /></li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h3 className="text-base font-semibold text-zinc-900">Local expenses</h3>
            <p className="mt-1 text-sm text-zinc-600">Persisted across refresh (IndexedDB).</p>
            {selectedGroupExpenses.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-500">No local expenses yet.</p>
            ) : (
              <ul className="mt-4 space-y-2 text-sm">
                {selectedGroupExpenses.slice(0, 8).map((exp) => (
                  <li key={exp.id} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2">
                    <div>
                      <p className="font-medium text-zinc-900">{exp.title}</p>
                      <p className="text-xs text-zinc-500">{new Date(exp.createdAt).toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-zinc-900">{exp.amount.toFixed(2)}</p>
                      <p className={`text-xs ${exp.synced ? "text-emerald-700" : "text-orange-700"}`}>
                        {exp.synced ? "Synced" : "Pending"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h3 className="text-base font-semibold text-zinc-900">Local net balances</h3>
            {localBalances.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-500">No balance data yet.</p>
            ) : (
              <ul className="mt-4 space-y-2 text-sm text-zinc-700">
                {localBalances.map((b) => (
                  <li key={b.userId} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2">
                    <span>{b.userId}</span>
                    <span className={b.balance >= 0 ? "text-emerald-700 font-semibold" : "text-red-700 font-semibold"}>
                      {b.balance >= 0 ? "+" : ""}
                      {b.balance.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
