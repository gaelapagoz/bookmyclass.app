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
    key: "schedule",
    label: "Schedule",
    children: [
      { type: "link", href: "/admin/sessions", label: "Calendar" },
      { type: "link", href: "/admin/bookings", label: "Bookings" },
    ],
  },
  {
    type: "group",
    key: "people",
    label: "People",
    children: [
      { type: "link", href: "/admin/users/clients", label: "Clients" },
      { type: "link", href: "/admin/users/teachers", label: "Teachers" },
      { type: "link", href: "/admin/users/admins", label: "Staff" },
    ],
  },
  {
    type: "group",
    key: "sales",
    label: "Sales",
    children: [
      { type: "link", href: "/admin/orders", label: "Orders" },
      { type: "link", href: "/admin/subscriptions", label: "Memberships" },
      { type: "link", href: "/admin/gift-cards", label: "Gift Cards" },
      { type: "link", href: "/admin/sales/coupons", label: "Discounts" },
      { type: "link", href: "/admin/sales/loyalty", label: "Rewards" },
    ],
  },
  {
    type: "group",
    key: "catalog",
    label: "Catalog",
    children: [
      { type: "link", href: "/admin/classes", label: "Classes" },
      { type: "link", href: "/admin/plans", label: "Memberships & Packs" },
      {
        type: "link",
        href: "/admin/store",
        label: "Store Products",
        matchPrefixes: ["/admin/store/merchandise", "/admin/store/gift-cards"],
      },
    ],
  },
  {
    type: "group",
    key: "communications",
    label: "Communications",
    children: [
      { type: "link", href: "/admin/inbox", label: "Client Messages", badgeKey: "inboxUnread" },
      { type: "link", href: "/admin/automations", label: "Email Automations" },
      { type: "link", href: "/admin/marketing/campaigns", label: "Campaigns" },
      { type: "link", href: "/admin/marketing/segments", label: "Audiences" },
    ],
  },
  {
    type: "group",
    key: "content",
    label: "Content",
    children: [
      { type: "link", href: "/admin/manage-site", label: "Website Content" },
      {
        type: "link",
        href: "/admin/online-learning",
        label: "Video Library",
        matchPrefixes: ["/admin/learning-programs", "/admin/learning-videos"],
      },
    ],
  },
];
