import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Elroq Ladeoverblik",
  description: "Ladeøkonomi, rækkevidde og intelligente ladeprognoser for din Škoda Elroq.",
  other: { "codex-preview": "development" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="da"><body>{children}</body></html>;
}
