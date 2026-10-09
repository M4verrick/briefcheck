import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "BriefCheck — Scope review", description: "Compare a client brief with a delivery plan, with exact evidence and recorded decisions." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
