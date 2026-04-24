/** Group fields exposed by the Phase 1 API (matches Prisma `select` on Group). */
export type GroupListItem = {
  id: string;
  name: string;
  createdAt: string;
  code: string;
  ownerId: string;
  membersCount: number;
  memberIds: string[];
  synced?: boolean;
  pendingAction?: "create" | "join";
};
