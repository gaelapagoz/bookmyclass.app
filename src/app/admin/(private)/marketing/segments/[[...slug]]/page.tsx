import { redirect } from "next/navigation";

type RedirectSearchParams = Promise<Record<string, string | string[] | undefined>>;
type RedirectParams = Promise<{ slug?: string[] }>;

function buildQueryString(searchParams: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => query.append(key, entry));
    } else if (value !== undefined) {
      query.set(key, value);
    }
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}

export default async function LegacyAdminMarketingSegmentsRedirect({
  params,
  searchParams,
}: {
  params: RedirectParams;
  searchParams: RedirectSearchParams;
}) {
  const [{ slug }, queryParams] = await Promise.all([params, searchParams]);
  const suffix = slug?.length ? `/${slug.map(encodeURIComponent).join("/")}` : "";
  redirect(`/admin/segments${suffix}${buildQueryString(queryParams)}`);
}
