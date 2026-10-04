"use client";

import { ArrowLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const navigationStorageKey = "controle-vtr:protected-navigation";

function readNavigationStack() {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(navigationStorageKey) ?? "[]");
    return Array.isArray(value)
      ? value.filter((path): path is string => typeof path === "string" && path.startsWith("/protected"))
      : [];
  } catch {
    return [];
  }
}

export function BackButton() {
  const pathname = usePathname();
  const router = useRouter();
  const initialized = useRef(false);

  useEffect(() => {
    let stack = readNavigationStack();
    if (!initialized.current) {
      const navigationType = performance.getEntriesByType("navigation")[0]?.toJSON().type;
      const storedStackMatches = stack.at(-1) === pathname;
      if (navigationType === "reload" && storedStackMatches) {
        initialized.current = true;
      } else {
        let referrerPath: string | null = null;
        try {
          const referrer = new URL(document.referrer);
          if (referrer.origin === window.location.origin && referrer.pathname.startsWith("/protected")) {
            referrerPath = referrer.pathname;
          }
        } catch {
          referrerPath = null;
        }
        stack = referrerPath && referrerPath !== pathname
          ? [referrerPath, pathname]
          : [pathname];
        initialized.current = true;
      }
    } else if (stack.at(-1) !== pathname) {
      if (stack.at(-2) === pathname) stack.pop();
      else stack.push(pathname);
    }
    if (stack.length > 30) stack.splice(0, stack.length - 30);
    try {
      sessionStorage.setItem(navigationStorageKey, JSON.stringify(stack));
    } catch {
      return;
    }
  }, [pathname]);

  function goBack() {
    const stack = readNavigationStack();
    const hasValidPrevious = stack.at(-1) === pathname
      && stack.length > 1
      && stack.at(-2)?.startsWith("/protected");

    if (hasValidPrevious) router.back();
    else if (pathname !== "/protected") router.push("/protected");
  }

  if (pathname === "/protected") return null;

  return (
    <button
      type="button"
      onClick={goBack}
      className="mb-6 inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-medium text-[#a9b8b1] transition-colors hover:bg-white/5 hover:text-[#f3f4ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d5b45d]"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      Voltar
    </button>
  );
}