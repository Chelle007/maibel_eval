"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AddUserModal } from "./AddUserModal";

type AppUser = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  is_owner: boolean;
} | null;

export function UserMenu() {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string; email?: string | null } | null>(null);
  const [appUser, setAppUser] = useState<AppUser>(null);
  const [open, setOpen] = useState(false);
  const [addUserOpen, setAddUserOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        setUser(data?.user ?? null);
        setAppUser(data?.appUser ?? null);
      })
      .catch(() => {
        setUser(null);
        setAppUser(null);
      });
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [open]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setOpen(false);
    router.push("/login");
    router.refresh();
  }

  const displayName = appUser?.full_name || appUser?.email || user?.email || "Account";

  return (
    <div className="relative ml-auto" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-stone-200 text-stone-600 transition hover:bg-stone-300 hover:text-stone-800"
        aria-label="Profile and logout"
      >
        <svg
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-48 rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
          <div className="border-b border-stone-100 px-3 py-2">
            <p className="truncate text-sm font-medium text-stone-900">{displayName}</p>
            {(appUser?.email ?? user?.email) && (
              <p className="truncate text-xs text-stone-500">{appUser?.email ?? user?.email}</p>
            )}
          </div>
          {appUser?.is_owner && (
            <button
              type="button"
              onClick={() => {
                setAddUserOpen(true);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-indigo-700 hover:bg-indigo-50"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a7 7 0 0114 0H3z" />
              </svg>
              Add user
            </button>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Log out
          </button>
        </div>
      )}
      <AddUserModal
        open={addUserOpen}
        onClose={() => setAddUserOpen(false)}
        onSuccess={() => setAddUserOpen(false)}
      />
    </div>
  );
}
