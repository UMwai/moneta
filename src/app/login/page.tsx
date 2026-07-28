import { connection } from "next/server";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  await connection();
  return <LoginForm demo={process.env.DEMO === "1"} />;
}
