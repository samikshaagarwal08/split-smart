import { getSession } from "@/lib/getSession";
import { redirect } from "next/navigation";
import ProtectedHome from "./(protected)/page";

export default async function Home() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  // If session exists, show the protected home UI
  return <ProtectedHome />;
}