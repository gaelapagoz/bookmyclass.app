export type CampaignScaffoldSegment = {
  id: string;
  name: string;
};

export type CampaignScaffoldRecipient = {
  id: string;
  name: string;
  email: string;
  marketingSubscriptionStatus: "SUBSCRIBED" | "UNSUBSCRIBED" | "NEVER_SUBSCRIBED";
  segmentIds: string[];
};

export const CAMPAIGN_SCAFFOLD_PAGE_SIZE = 4;

export const CAMPAIGN_SCAFFOLD_SEGMENTS: CampaignScaffoldSegment[] = [
  { id: "active-subscribers", name: "Active subscribers" },
  { id: "new-clients", name: "New clients (last 30 days)" },
  { id: "loyal-members", name: "Loyal members" },
  { id: "at-risk", name: "At-risk members" },
];

export const CAMPAIGN_SCAFFOLD_RECIPIENTS: CampaignScaffoldRecipient[] = [
  {
    id: "u-1",
    name: "Sophie Martin",
    email: "sophie@example.com",
    marketingSubscriptionStatus: "SUBSCRIBED",
    segmentIds: ["active-subscribers", "loyal-members"],
  },
  {
    id: "u-2",
    name: "Alex Novak",
    email: "alex@example.com",
    marketingSubscriptionStatus: "SUBSCRIBED",
    segmentIds: ["new-clients", "active-subscribers"],
  },
  {
    id: "u-3",
    name: "Mina Verhoeven",
    email: "mina@example.com",
    marketingSubscriptionStatus: "SUBSCRIBED",
    segmentIds: ["at-risk"],
  },
  {
    id: "u-4",
    name: "Jonas Peeters",
    email: "jonas@example.com",
    marketingSubscriptionStatus: "SUBSCRIBED",
    segmentIds: ["loyal-members"],
  },
  {
    id: "u-5",
    name: "Layla Hassan",
    email: "layla@example.com",
    marketingSubscriptionStatus: "SUBSCRIBED",
    segmentIds: ["active-subscribers"],
  },
  {
    id: "u-6",
    name: "Nora Dumont",
    email: "nora@example.com",
    marketingSubscriptionStatus: "SUBSCRIBED",
    segmentIds: ["new-clients"],
  },
  {
    id: "u-7",
    name: "Amir El Khouri",
    email: "amir@example.com",
    marketingSubscriptionStatus: "SUBSCRIBED",
    segmentIds: ["active-subscribers", "at-risk"],
  },
  {
    id: "u-8",
    name: "Lotte Janssen",
    email: "lotte@example.com",
    marketingSubscriptionStatus: "SUBSCRIBED",
    segmentIds: ["loyal-members"],
  },
];

export function getSelectedScaffoldSegments(selectedIds: string[]): CampaignScaffoldSegment[] {
  const selectedIdSet = new Set(selectedIds);
  return CAMPAIGN_SCAFFOLD_SEGMENTS.filter((segment) => selectedIdSet.has(segment.id));
}

export function getScaffoldRecipientsForSegments(selectedIds: string[]): CampaignScaffoldRecipient[] {
  if (!selectedIds.length) {
    return [];
  }
  const selectedIdSet = new Set(selectedIds);
  return CAMPAIGN_SCAFFOLD_RECIPIENTS.filter((recipient) =>
    recipient.segmentIds.some((segmentId) => selectedIdSet.has(segmentId)),
  );
}

export function buildCampaignFlowScaffoldHref(
  campaignId: string,
  step: "target" | "review" | "confirm" | "sent",
  segmentIds: string[],
  page?: number,
): string {
  const params = new URLSearchParams();
  segmentIds.forEach((segmentId) => params.append("segments", segmentId));
  if (typeof page === "number" && Number.isFinite(page) && page > 0) {
    params.set("page", String(page));
  }
  const query = params.toString();
  return `/admin/marketing/campaigns/${campaignId}/${step}${query ? `?${query}` : ""}`;
}
