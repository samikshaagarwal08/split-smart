export type ExpenseSplitRow = {
  userId: string;
  amount: number;
};

export type ExpenseInput = {
  id: string;
  amount: number;
  paidById: string;
  splitType: "equal" | "custom";
  users: string[];
  customSplits: ExpenseSplitRow[];
};

export type BalanceEntry = {
  userId: string;
  paid: number;
  owed: number;
  net: number;
};

export type SettlementSuggestion = {
  from: string;
  to: string;
  amount: number;
};

const toCents = (value: number) => Math.round(value * 100);
const fromCents = (value: number) => Number((value / 100).toFixed(2));

function roundShareCents(totalCents: number, count: number) {
  const base = Math.floor(totalCents / Math.max(count, 1));
  const remainder = totalCents - base * Math.max(count, 1);
  return { base, remainder };
}

function addAmount(map: Map<string, { paid: number; owed: number }>, userId: string, paidCents: number, owedCents: number) {
  const stats = map.get(userId) ?? { paid: 0, owed: 0 };
  stats.paid += paidCents;
  stats.owed += owedCents;
  map.set(userId, stats);
}

export function calculateNetBalances(expenses: ExpenseInput[]) {
  const totals = new Map<string, { paid: number; owed: number }>();

  for (const expense of expenses) {
    const amountCents = toCents(expense.amount);
    const payer = expense.paidById || expense.users[0] || "";
    if (payer) {
      addAmount(totals, payer, amountCents, 0);
    }

    if (expense.splitType === "custom") {
      const splits = expense.customSplits.map((split) => ({
        userId: split.userId,
        cents: toCents(split.amount),
      }));
      const amountAllocated = splits.reduce((sum, split) => sum + split.cents, 0);
      const remainderCents = amountCents - amountAllocated;
      if (splits.length > 0) {
        splits[splits.length - 1].cents += remainderCents;
      }

      for (const split of splits) {
        addAmount(totals, split.userId, 0, split.cents);
      }
    } else {
      const participants = Array.from(new Set(expense.users));
      const { base, remainder } = roundShareCents(amountCents, participants.length);
      for (let index = 0; index < participants.length; index += 1) {
        const userId = participants[index];
        const owedCents = index === participants.length - 1 ? base + remainder : base;
        addAmount(totals, userId, 0, owedCents);
      }
    }
  }

  return Array.from(totals.entries()).map(([userId, totalsForUser]) => ({
    userId,
    paid: fromCents(totalsForUser.paid),
    owed: fromCents(totalsForUser.owed),
    net: fromCents(totalsForUser.paid - totalsForUser.owed),
  }));
}

export function simplifyDebts(balances: BalanceEntry[]) {
  const creditors = balances
    .filter((item) => item.net > 0)
    .map((item) => ({ userId: item.userId, cents: toCents(item.net) }))
    .sort((a, b) => b.cents - a.cents);

  const debtors = balances
    .filter((item) => item.net < 0)
    .map((item) => ({ userId: item.userId, cents: Math.abs(toCents(item.net)) }))
    .sort((a, b) => b.cents - a.cents);

  const settlements: SettlementSuggestion[] = [];

  let creditorIndex = 0;
  let debtorIndex = 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const settleCents = Math.min(creditor.cents, debtor.cents);

    settlements.push({
      from: debtor.userId,
      to: creditor.userId,
      amount: fromCents(settleCents),
    });

    creditor.cents -= settleCents;
    debtor.cents -= settleCents;

    if (creditor.cents === 0) creditorIndex += 1;
    if (debtor.cents === 0) debtorIndex += 1;
  }

  return settlements;
}

export function computeSettlementPlan(expenses: ExpenseInput[]) {
  const balances = calculateNetBalances(expenses);
  return simplifyDebts(balances);
}
