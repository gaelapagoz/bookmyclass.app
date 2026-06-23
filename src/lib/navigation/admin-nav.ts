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
  {
    type: "group",
    key: "users",
    label: "Users",
    children: [
      { type: "link", href: "/admin/users/admins", label: "Admins" },
      { type: "link", href: "/admin/users/teachers", label: "Teachers" },
      { type: "link", href: "/admin/users/clients", label: "Clients" },
    ],
  },
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
      { type: "link", href: "/admin/sales/coupons", label: "Coupons" },
      { type: "link", href: "/admin/sales/loyalty", label: "Loyalty Points" },
      { type: "link", href: "/admin/gift-cards", label: "Gift Cards" },
    ],
  },
  {
    type: "group",
    key: "catalog",
    label: "Catalog",
    children: [
      { type: "link", href: "/admin/classes", label: "Booking Services" },
      { type: "link", href: "/admin/plans", label: "Plans" },
      { type: "link", href: "/admin/coupons", label: "Coupons" },
      { type: "link", href: "/admin/catalog/loyalty", label: "Loyalty Points" },
      {
        type: "link",
        href: "/admin/store",
        label: "Store",
        matchPrefixes: ["/admin/store/merchandise", "/admin/store/gift-cards"],
      },
    ],
  },
  {
    type: "group",
    key: "marketing",
    label: "Marketing",
    children: [
      { type: "link", href: "/admin/marketing/campaigns", label: "Campaigns" },
      { type: "link", href: "/admin/marketing/segments", label: "Segments" },
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
  { type: "link", href: "/admin/automations", label: "Automations" },
];
