import LogoutButton from "@/components/Logout";
import { getSession } from "@/lib/getSession";
import { redirect } from "next/navigation";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <div>
          <p className="text-xs text-zinc-500">Signed in as</p>
          <p className="text-sm font-semibold text-zinc-900">{session.user.email}</p>
        </div>
        <LogoutButton />
      </div>
      {children}
    </div>
  );
}
