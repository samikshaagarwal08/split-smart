"use client";

import { useState } from "react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");

  const handleReset = async () => {
    await fetch("/api/auth/request-reset", {
      method: "POST",
      body: JSON.stringify({ email }),
    });

    alert("Reset link sent (demo)");
  };

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="p-6 border rounded w-80">
        <h2 className="text-xl mb-4">Forgot Password</h2>

        <input
          className="border p-2 w-full mb-4"
          placeholder="Email"
          onChange={(e) => setEmail(e.target.value)}
        />

        <button
          onClick={handleReset}
          className="bg-black cursor-pointer text-white w-full py-2"
        >
          Send Reset Link
        </button>
      </div>
    </div>
  );
}