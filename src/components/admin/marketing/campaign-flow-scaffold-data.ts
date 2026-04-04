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
