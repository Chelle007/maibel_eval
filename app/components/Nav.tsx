"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserMenu } from "./UserMenu";

const links = [
  { href: "/", label: "Evaluate" },
  { href: "/test-cases", label: "Test cases" },
  { href: "/sessions", label: "Sessions" },
  { href: "/settings", label: "Settings" },
  { href: "/archive/run-batch", label: "Archive" },
];

export function Nav() {
  const pathname = usePathname();
  if (pathname === "/login" || pathname === "/signup") return null;
  return (
    <nav className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-4xl items-center gap-8 px-4 py-4">
        <Link href="/" className="text-lg font-semibold text-stone-900">
          Maibel Eval
        </Link>
        <div className="flex gap-6">
          {links.map(({ href, label }) => {
            const active = pathname === href || (href !== "/" && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={`text-sm font-medium ${
                  active ? "text-stone-900" : "text-stone-500 hover:text-stone-700"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>
        <UserMenu />
      </div>
    </nav>
  );
}
