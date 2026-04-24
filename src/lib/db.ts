import Dexie, { Table } from "dexie";

export interface LocalGroup {
  id: string;
  name: string;
  code: string;
  createdAt: string;
  ownerId: string;
  membersCount: number;
  memberIds: string[];
  synced: boolean;
  pendingAction?: "create" | "join";
}

export interface LocalExpense {
  id: string;
  title: string;
  amount: number;
  groupId: string;
  splitType: "equal" | "custom";
  users: string[];
  customSplits: { userId: string; amount: number }[];
  createdAt: string;
  synced: boolean;
}

export interface LocalGroupMember {
  id: string;
  userId: string;
  groupId: string;
  joinedAt: string;
  synced: boolean;
}

class AppDB extends Dexie {
  groups!: Table<LocalGroup>;
  expenses!: Table<LocalExpense>;
  members!: Table<LocalGroupMember>;

  constructor() {
    super("SplitSmartDB");

    this.version(2).stores({
      groups: "id, synced, pendingAction, createdAt",
      expenses: "id, groupId, synced",
      members: "id, groupId, userId, synced",
    });

    // v3 adds createdAt index for local-first sorting of expenses.
    this.version(3).stores({
      groups: "id, synced, pendingAction, createdAt",
      expenses: "id, groupId, synced, createdAt",
      members: "id, groupId, userId, synced",
    });
  }
}

export const db = new AppDB();