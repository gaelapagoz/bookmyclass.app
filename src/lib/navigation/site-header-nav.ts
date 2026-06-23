export type HeaderNavLink = {
  href: string;
  label: string;
  type: "link";
};

export type HeaderNavDisclosure = {
  id: string;
  label: string;
  links: HeaderNavLink[];
  type: "disclosure";
};

export type HeaderPrimaryNavItem = HeaderNavLink | HeaderNavDisclosure;

export type HeaderAccountNavItem =
  | HeaderNavLink
  | {
      id: "logout";
      label: "Log Out";
      type: "action";
    };

const PRIMARY_ITEMS: HeaderPrimaryNavItem[] = [
  { href: "/", label: "Home", type: "link" },
  { href: "/book-a-class", label: "Book a Class", type: "link" },
  { href: "/subscription", label: "Subscription", type: "link" },
  { href: "/store", label: "Store", type: "link" },
  {
    id: "promos",
    label: "Promos",
    type: "disclosure",
    links: [
      { href: "/promos/loyalty-points", label: "Loyalty Points", type: "link" },
    ],
  },
  { href: "/learning", label: "Online Learning", type: "link" },
  {
    id: "about-us",
    label: "About Us",
    type: "disclosure",
    links: [
      { href: "/about/studio", label: "Our Studio", type: "link" },
      { href: "/about/team", label: "Our Team", type: "link" },
      { href: "/about/terms-and-conditions", label: "Terms and Conditions", type: "link" },
      { href: "/about/faq", label: "FAQ", type: "link" },
    ],
  },
];

export function getHeaderPrimaryNavigation(): HeaderPrimaryNavItem[] {
  return PRIMARY_ITEMS;
}

export function getHeaderAccountNavigation(params: {
  isAuthenticated: boolean;
}): HeaderAccountNavItem[] {
  if (params.isAuthenticated) {
    return [
      { href: "/cart", label: "Cart", type: "link" },
      { href: "/dashboard", label: "Dashboard", type: "link" },
      { id: "logout", label: "Log Out", type: "action" },
    ];
  }

  return [
    { href: "/cart", label: "Cart", type: "link" },
    { href: "/sign-in", label: "Sign In", type: "link" },
    { href: "/sign-up", label: "Sign Up", type: "link" },
  ];
}
