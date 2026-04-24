"use client";

import Link from "next/link";
import { useState } from "react";
import { EyeIcon, EyeOffIcon, Loader2Icon } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const login = async () => {
    if (!email || !password) {
      alert("Please fill all fields");
      return;
    }

    setLoading(true);
    const { error } = await authClient.signIn.email(
      { email, password },
      {
        onSuccess: () => {
          window.location.href = "/";
        },
      },
    );
    setLoading(false);

    if (error) {
      alert(error.message ?? "Login failed");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-gray-100 to-gray-200 px-4">

      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8 space-y-6">

        {/* Header */}
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-800">
            Welcome Back 👋
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Login to manage your expenses
          </p>
        </div>

        {/* Inputs */}
        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-600">Email</label>
            <input
              type="email"
              placeholder="you@example.com"
              className="mt-1 w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-black transition"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm text-gray-600">Password</label>
            <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              className="mt-1 w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-black transition"
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute cursor-pointer right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
            >
                {showPassword ? <EyeIcon className="w-5 h-5" /> : <EyeOffIcon className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Button */}
        <button
          onClick={login}
          className="w-full cursor-pointer bg-black text-white py-2.5 rounded-lg hover:bg-gray-800 transition font-medium"
        >
          {loading ? <Loader2Icon className="w-5 h-5 animate-spin" /> : "Sign In"}
        </button>

        {/* Footer */}
        <p className="text-center text-sm text-gray-500">
          Don’t have an account?{" "}
          <Link href="/signup" className="text-black font-medium cursor-pointer hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}