"use client";

export default function LogoutButton() {
  const logout = async () => {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    window.location.href = "/login";
  };

  return (
    <button
      onClick={logout}
      className="rounded-lg cursor-pointer bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800"
    >
      Logout
    </button>
  );
}