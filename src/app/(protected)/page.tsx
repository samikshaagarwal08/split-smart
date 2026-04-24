"use client";

import { GroupCard } from "@/components/GroupCard";
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

async function parseGroupsResponse(res: Response): Promise<GroupListItem[]> {
  const data: unknown = await res.json();
  if (!res.ok) {
    throw new Error(readErrorMessage(data, "Something went wrong"));
  }
  if (!Array.isArray(data)) {
    throw new Error("Unexpected response from server");
  }
  return data as GroupListItem[];
}

async function assertOk(res: Response, fallback: string): Promise<void> {
  const data: unknown = await res.json();
  if (!res.ok) {
    throw new Error(readErrorMessage(data, fallback));
  }
}

export default function Home() {
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
  const [balances, setBalances] = useState<
    { userId: string; name: string | null; email: string; balance: number }[]
  >([]);
  const [settlements, setSettlements] = useState<
    { fromName: string | null; toName: string | null; amount: number }[]
  >([]);
  const [loadingList, setLoadingList] = useState(true);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [addingExpense, setAddingExpense] = useState(false);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [expenseSuccess, setExpenseSuccess] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const fetchGroups = useCallback(async () => {
    setListError(null);
    setLoadingList(true);
    try {
      const res = await fetch("/api/groups");
      const list = await parseGroupsResponse(res);
      setGroups(list);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Could not load groups");
      setGroups([]);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const fetchBalance = useCallback(async (groupId?: string) => {
    setLoadingBalance(true);
    try {
      const query = groupId ? `?groupId=${encodeURIComponent(groupId)}` : "";
      const res = await fetch(`/api/expenses/balance${query}`);
      const data = (await res.json()) as {
        balances?: { userId: string; name: string | null; email: string; balance: number }[];
        settlements?: { fromName: string | null; toName: string | null; amount: number }[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Could not calculate balances");
      setBalances(Array.isArray(data.balances) ? data.balances : []);
      setSettlements(Array.isArray(data.settlements) ? data.settlements : []);
    } catch (e) {
      setExpenseError(e instanceof Error ? e.message : "Could not calculate balances");
      setBalances([]);
      setSettlements([]);
    } finally {
      setLoadingBalance(false);
    }
  }, []);

  useEffect(() => {
    startTransition(() => {
      void fetchGroups();
      void fetchBalance();
    });
  }, [fetchBalance, fetchGroups, startTransition]);

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
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      await assertOk(res, "Could not create group");
      setName("");
      await fetchGroups();
      await fetchBalance();
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
    setJoining(true);
    try {
      const res = await fetch("/api/groups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: joinCode.trim().toUpperCase() }),
      });
      await assertOk(res, "Could not join group");
      setJoinCode("");
      await fetchGroups();
      await fetchBalance();
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
    if (!expenseTitle.trim()) return setExpenseError("Expense title is required.");
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return setExpenseError("Amount must be greater than 0.");
    }

    setAddingExpense(true);
    try {
      const payload =
        splitType === "equal"
          ? {
              title: expenseTitle.trim(),
              amount: parsedAmount,
              groupId: selectedGroupId,
              splitType,
              users: selectedGroup?.memberIds ?? [],
            }
          : {
              title: expenseTitle.trim(),
              amount: parsedAmount,
              groupId: selectedGroupId,
              splitType,
              customSplits,
            };
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await assertOk(res, "Could not add expense");
      setExpenseSuccess("Expense added successfully.");
      setExpenseTitle("");
      setAmount("");
      setCustomSplits([]);
      await fetchBalance(selectedGroupId);
    } catch (e) {
      setExpenseError(e instanceof Error ? e.message : "Could not add expense");
    } finally {
      setAddingExpense(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <section className="border-b border-zinc-200 bg-linear-to-b from-zinc-50 to-white">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
          <p className="text-sm font-medium text-emerald-700">Expense groups</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            Split bills with your crew
          </h1>
          <p className="mt-3 max-w-2xl text-base text-zinc-600">
            Create a group for each trip, household, or project. Phase 1 keeps it
            simple: name your groups and see them in one place.
          </p>

          <form
            onSubmit={createGroup}
            className="mt-8 flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="min-w-0 flex-1">
              <label htmlFor="group-name" className="sr-only">
                Group name
              </label>
              <input
                id="group-name"
                type="text"
                autoComplete="off"
                placeholder="e.g. Weekend trip, Apartment 4B"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={creating}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 shadow-sm outline-none ring-emerald-500/20 transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-4 disabled:opacity-60"
              />
              {formError ? (
                <p className="mt-2 text-sm text-red-600" role="alert">
                  {formError}
                </p>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={creating}
              className="inline-flex cursor-pointer shrink-0 items-center justify-center rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-50"
            >
              {creating ? (
                <span className="flex items-center gap-2">
                  <span
                    className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                    aria-hidden
                  />
                  Creating…
                </span>
              ) : (
                "Create group"
              )}
            </button>
          </form>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl flex-1 space-y-8 px-4 py-10 sm:px-6">
        <div className="grid gap-4 md:grid-cols-2">
          <form
            onSubmit={joinGroup}
            className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm"
          >
            <h3 className="text-base font-semibold text-zinc-900">Join with code</h3>
            <p className="mt-1 text-sm text-zinc-600">Ask the group owner for the join code.</p>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="e.g. A1B2C3"
              className="mt-4 w-full rounded-lg border border-zinc-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-500"
            />
            {joinError ? <p className="mt-2 text-sm text-red-600">{joinError}</p> : null}
            <button
              type="submit"
              disabled={joining}
              className="mt-4 cursor-pointer rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {joining ? "Joining..." : "Join group"}
            </button>
          </form>

          <form
            onSubmit={createExpense}
            className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm"
          >
            <h3 className="text-base font-semibold text-zinc-900">Add expense</h3>
            <p className="mt-1 text-sm text-zinc-600">Supports equal and custom split.</p>
            <div className="mt-4 grid gap-3">
              <select
                value={selectedGroupId}
                onChange={(e) => setSelectedGroupId(e.target.value)}
                className="rounded-lg border border-zinc-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-500"
              >
                <option value="">Select group</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
              <input
                value={expenseTitle}
                onChange={(e) => setExpenseTitle(e.target.value)}
                placeholder="Expense title"
                className="rounded-lg border border-zinc-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-500"
              />
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount"
                type="number"
                step="0.01"
                className="rounded-lg border border-zinc-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-500"
              />
              <div className="flex gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => setSplitType("equal")}
                  className={`rounded-md cursor-pointer px-3 py-1.5 ${splitType === "equal" ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-700"}`}
                >
                  Equal
                </button>
                <button
                  type="button"
                  onClick={() => setSplitType("custom")}
                  className={`rounded-md cursor-pointer px-3 py-1.5 ${splitType === "custom" ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-700"}`}
                >
                  Custom
                </button>
              </div>

              {splitType === "custom" && selectedGroup ? (
                <div className="rounded-lg border border-zinc-200 p-3">
                  <p className="mb-2 text-xs text-zinc-600">Pick users and their split amounts.</p>
                  <div className="flex gap-2">
                    <select
                      value={customUserId}
                      onChange={(e) => setCustomUserId(e.target.value)}
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                    >
                      <option value="">Select user</option>
                      {selectedGroup.memberIds.map((memberId) => (
                        <option key={memberId} value={memberId}>
                          {memberId}
                        </option>
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
                    <button
                      type="button"
                      onClick={addCustomSplit}
                      className="rounded-lg cursor-pointer bg-zinc-100 px-3 py-2 text-sm"
                    >
                      Add
                    </button>
                  </div>
                  {customSplits.length > 0 ? (
                    <ul className="mt-2 text-xs text-zinc-600">
                      {customSplits.map((item) => (
                        <li key={item.userId}>
                          {item.userId}: {item.amount.toFixed(2)}
                        </li>
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
              className="mt-4 rounded-lg cursor-pointer bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {addingExpense ? "Adding..." : "Add expense"}
            </button>
          </form>
        </div>

        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold text-zinc-900">Your groups</h2>
          {!loadingList && groups.length > 0 ? (
            <span className="text-sm text-zinc-500">{groups.length} total</span>
          ) : null}
        </div>

        <div className="mt-6">
          {loadingList ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50 py-16 text-center">
              <span
                className="size-8 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-600"
                aria-hidden
              />
              <p className="mt-4 text-sm font-medium text-zinc-600">Loading groups…</p>
            </div>
          ) : listError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center">
              <p className="text-sm font-medium text-red-800">{listError}</p>
              <button
                type="button"
                onClick={() => void fetchGroups()}
                className="mt-4 text-sm cursor-pointer font-semibold text-red-900 underline-offset-2 hover:underline"
              >
                Try again
              </button>
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/80 px-6 py-14 text-center">
              <p className="text-base font-medium text-zinc-800">No groups yet</p>
              <p className="mx-auto mt-2 max-w-sm text-sm text-zinc-600">
                Add your first group above. You will see it listed here with the
                date it was created.
              </p>
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {groups.map((g) => (
                <li key={g.id}>
                  <GroupCard group={g} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-zinc-900">Balances</h3>
            <button
              type="button"
              onClick={() => void fetchBalance(selectedGroupId || undefined)}
              className="text-sm cursor-pointer font-medium text-zinc-700 underline-offset-2 hover:underline"
            >
              Refresh
            </button>
          </div>
          {loadingBalance ? (
            <p className="mt-4 text-sm text-zinc-500">Calculating balances...</p>
          ) : balances.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">No balance data yet.</p>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <h4 className="text-sm font-semibold text-zinc-800">Net balance</h4>
                <ul className="mt-2 space-y-1 text-sm text-zinc-700">
                  {balances.map((b) => (
                    <li key={b.userId}>
                      {(b.name || b.email) + ": "}
                      <span className={b.balance >= 0 ? "text-emerald-700" : "text-red-700"}>
                        {b.balance >= 0 ? "+" : ""}
                        {b.balance.toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-zinc-800">Who owes whom</h4>
                {settlements.length === 0 ? (
                  <p className="mt-2 text-sm text-zinc-500">Everyone is settled.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm text-zinc-700">
                    {settlements.map((item, idx) => (
                      <li key={`${item.fromName}-${item.toName}-${idx}`}>
                        {(item.fromName ?? "A member")} owes {(item.toName ?? "a member")}{" "}
                        <span className="font-semibold">{item.amount.toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
