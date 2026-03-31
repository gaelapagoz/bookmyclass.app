"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { adminNavConfig, type AdminNavGroupItem, type AdminNavLinkItem } from "@/lib/navigation/admin-nav";

type AdminSidebarProps = {
  unreadInboxCount?: number;
};

function isActiveLink(pathname: string, item: AdminNavLinkItem) {
  if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
    return true;
  }

  return item.matchPrefixes?.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ?? false;
}

function isActiveGroup(pathname: string, group: AdminNavGroupItem) {
  return group.children.some((child) => isActiveLink(pathname, child));
}

export default function AdminSidebar({ unreadInboxCount = 0 }: AdminSidebarProps) {
  const pathname = usePathname();

  const activeGroupKeys = useMemo(() => {
    return new Set(
      adminNavConfig
        .filter((item): item is AdminNavGroupItem => item.type === "group")
        .filter((group) => isActiveGroup(pathname, group))
        .map((group) => group.key),
    );
  }, [pathname]);

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (activeGroupKeys.size === 0) {
      return;
    }

    setExpandedGroups((previous) => {
      const next = { ...previous };
      for (const key of activeGroupKeys) {
        next[key] = true;
      }
      return next;
    });
  }, [activeGroupKeys]);

  return (
    <aside className="w-full border-r border-[#223046] bg-[#0f1f31] text-[#f4eee8] md:w-64">
      <div className="border-b border-[#223046] px-5 py-5">
        <p className="text-xs uppercase tracking-[0.2em] text-[#d9c8be]">Yoga Pilates Fitness Studio</p>
        <h2 className="mt-1 text-lg font-semibold">Admin</h2>
      </div>

      <nav className="p-3">
        <ul className="space-y-1">
          {adminNavConfig.map((item) => {
            if (item.type === "link") {
              const active = isActiveLink(pathname, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                      active
                        ? "bg-[#1d3652] text-[#f4eee8]"
                        : "text-[#d9c8be] hover:bg-[#1b2f47] hover:text-[#f4eee8]"
                    }`}
                  >
                    <span>{item.label}</span>
                    {item.badgeKey === "inboxUnread" && unreadInboxCount > 0 ? (
                      <span className="rounded-full bg-[#d56a6a] px-2 py-0.5 text-xs font-semibold text-white" aria-label={`Inbox unread ${unreadInboxCount}`}>
                        {unreadInboxCount}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            }

            const groupActive = isActiveGroup(pathname, item);
            const open = groupActive || Boolean(expandedGroups[item.key]);

            return (
              <li key={item.key}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => {
                    setExpandedGroups((previous) => ({
                      ...previous,
                      [item.key]: !open,
                    }));
                  }}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                    groupActive
                      ? "bg-[#1d3652] text-[#f4eee8]"
                      : "text-[#d9c8be] hover:bg-[#1b2f47] hover:text-[#f4eee8]"
                  }`}
                >
                  <span>{item.label}</span>
                  <span className="text-xs">{open ? "-" : "+"}</span>
                </button>

                {open ? (
                  <ul className="mt-1 space-y-1 pl-2">
                    {item.children.map((child) => {
                      const childActive = isActiveLink(pathname, child);
                      return (
                        <li key={child.href}>
                          <Link
                            href={child.href}
                            className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                              childActive
                                ? "bg-[#264664] text-[#f4eee8]"
                                : "text-[#d9c8be] hover:bg-[#1b2f47] hover:text-[#f4eee8]"
                            }`}
                          >
                            {child.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
