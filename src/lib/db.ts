import Dexie, { Table } from "dexie";

export interface LocalGroup {
  id: string;
  name: string;
  code: string;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  membersCount: number;
  memberIds: string[];
  synced: boolean;
  deleted?: boolean;
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
  updatedAt: string;
  synced: boolean;
  deleted?: boolean;
}

export interface LocalSettlement {
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
}

export interface LocalGroupMember {
  id: string;
  userId: string;
  groupId: string;
  joinedAt: string;
  updatedAt: string;
  synced: boolean;
  deleted?: boolean;
  name?: string | null;
}

class AppDB extends Dexie {
  groups!: Table<LocalGroup>;
  expenses!: Table<LocalExpense>;
  members!: Table<LocalGroupMember>;
  settlements!: Table<LocalSettlement>;

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

    // v4 adds updatedAt and deleted flags to support sync metadata.
    this.version(4).stores({
      groups: "id, synced, pendingAction, createdAt, updatedAt, deleted",
      expenses: "id, groupId, synced, createdAt, updatedAt, deleted",
      members: "id, groupId, userId, synced, updatedAt, deleted",
    });

    // v5 adds settlement support for offline tracking and sync.
    this.version(5).stores({
      groups: "id, synced, pendingAction, createdAt, updatedAt, deleted",
      expenses: "id, groupId, synced, createdAt, updatedAt, deleted",
      members: "id, groupId, userId, synced, updatedAt, deleted",
      settlements: "id, groupId, fromUserId, toUserId, synced, createdAt, updatedAt, deleted",
    });
  }
}

export const db = new AppDB();