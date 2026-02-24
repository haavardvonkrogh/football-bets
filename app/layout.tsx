import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Football Betting Advisor",
  description: "Match odds, value bets, and weekly P/L tracking",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="no" className="dark">
      <body className={`${inter.variable} font-sans antialiased bg-[var(--bg)] text-[var(--fg)]`}>
        {children}
      </body>
    </html>
  );
}
