"use client";

import { EyeIcon, EyeOffIcon, Loader2Icon } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import Link from "next/link";
import { useState } from "react";

export default function Signup() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);

    const signup = async () => {
        if (!email || !password) {
            alert("Please fill all fields");
            return;
        }

        setLoading(true);
        const { error } = await authClient.signUp.email(
            {
                email,
                password,
                name: email.split("@")[0],
            },
            {
                onSuccess: () => {
                    window.location.href = "/";
                },
            },
        );
        setLoading(false);

        if (error) {
            alert(error.message ?? "Signup failed");
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-gray-100 to-gray-200 px-4">

            <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 space-y-6">

                {/* Header */}
                <div className="text-center">
                    <h1 className="text-2xl font-bold text-gray-800">
                        Create Account 🚀
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Start managing your shared expenses
                    </p>
                </div>

                {/* Form */}
                <div className="space-y-4">

                    {/* Email */}
                    <div>
                        <label className="text-sm text-gray-600">Email</label>
                        <input
                            type="email"
                            placeholder="you@example.com"
                            className="mt-1 w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-black transition"
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </div>

                    {/* Password */}
                    <div>
                        <label className="text-sm text-gray-600">Password</label>

                        <div className="relative mt-1">
                            <input
                                type={showPassword ? "text" : "password"}
                                placeholder="••••••••"
                                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-black pr-10 transition"
                                onChange={(e) => setPassword(e.target.value)}
                            />

                            {/* Toggle Button */}
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute cursor-pointer right-2 top-1/2 -translate-y-1/2 text-sm text-gray-500 hover:text-black"
                            >
                                {showPassword ? <EyeOffIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Button */}
                <button
                    onClick={signup}
                    disabled={loading}
                    className={`w-full py-2.5 cursor-pointer rounded-lg font-medium transition flex items-center justify-center gap-2 ${loading
                            ? "bg-gray-400 text-white cursor-not-allowed"
                            : "bg-black text-white hover:bg-gray-800"
                        }`}
                >
                    {loading ? <Loader2Icon className="w-5 h-5 animate-spin" /> : "Sign Up"}
                </button>

                {/* Footer */}
                <p className="text-center text-sm text-gray-500">
                    Already have an account?{" "}
                    <Link
                        href="/login"
                        className="text-black font-medium hover:underline"
                    >
                        Login
                    </Link>
                </p>
            </div>
        </div>
    );
}