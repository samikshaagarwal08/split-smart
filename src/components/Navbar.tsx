import Link from "next/link";
import LogoutButton from "./Logout";

export function Navbar() {
  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200/80 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2">
        <Link
          href="/"
          className="text-base font-bold tracking-tight text-zinc-900"
        >
          SplitSmart
        </Link>
        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
          Phase 1
        </span>
        </div>
        <LogoutButton />
      </div>
    </header>
  );
}
