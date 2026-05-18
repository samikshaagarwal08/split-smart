CREATE TYPE "SettlementStatus" AS ENUM ('pending', 'paid');

ALTER TABLE "Expense" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "ExpenseSplit" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "Group" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "GroupMember" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Settlement_groupId_idx" ON "Settlement"("groupId");

ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
