export type AdminNavBadgeKey = "inboxUnread";

export type AdminNavLinkItem = {
  type: "link";
  href: string;
  label: string;
  matchPrefixes?: string[];
  badgeKey?: AdminNavBadgeKey;
};

export type AdminNavGroupItem = {
  type: "group";
  key: string;
  label: string;
  children: AdminNavLinkItem[];
};

export type AdminNavItem = AdminNavLinkItem | AdminNavGroupItem;

export const adminNavConfig: AdminNavItem[] = [
  { type: "link", href: "/admin/dashboard", label: "Dashboard" },
  { type: "link", href: "/admin/users", label: "Users" },
  { type: "link", href: "/admin/inbox", label: "Inbox", badgeKey: "inboxUnread" },
  {
    type: "group",
    key: "booking",
    label: "Booking",
    children: [
      { type: "link", href: "/admin/sessions", label: "Calendar" },
      { type: "link", href: "/admin/bookings", label: "Booking List" },
    ],
  },
  {
    type: "group",
    key: "sales",
    label: "Sales",
    children: [
      { type: "link", href: "/admin/orders", label: "Orders" },
      { type: "link", href: "/admin/subscriptions", label: "Subscriptions" },
    ],
  },
  {
    type: "group",
    key: "catalog",
    label: "Catalog",
    children: [
      { type: "link", href: "/admin/classes", label: "Booking Services" },
      { type: "link", href: "/admin/plans", label: "Plans" },
    ],
  },
  {
    type: "group",
    key: "marketing",
    label: "Marketing",
    children: [
      { type: "link", href: "/admin/marketing/campaigns", label: "Campaigns" },
      { type: "link", href: "/admin/marketing/campaigns/new", label: "Create Campaign" },
      { type: "link", href: "/admin/marketing/audiences", label: "Audiences" },
      { type: "link", href: "/admin/marketing/categories", label: "Categories" },
    ],
  },
  {
    type: "link",
    href: "/admin/online-learning",
    label: "Online Learning",
    matchPrefixes: ["/admin/learning-programs", "/admin/learning-videos"],
  },
  { type: "link", href: "/admin/manage-site", label: "Manage Site" },
];
