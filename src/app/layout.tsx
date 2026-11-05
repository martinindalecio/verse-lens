import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Verse Lens",
  description: "Read the Bible and see who each person is, where they've been, and what's happening around them.",
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#172227" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="border-b border-line bg-card pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
            <Link href="/" className="text-xl font-bold">
              Verse Lens
            </Link>
            <span className="text-sm text-muted">Berean Standard Bible</span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-6 pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))]">
          {children}
        </main>
      </body>
    </html>
  );
}
