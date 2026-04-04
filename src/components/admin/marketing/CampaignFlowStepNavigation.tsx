import Link from "next/link";

type CampaignFlowStepNavigationProps = {
  backHref?: string;
  nextHref?: string;
  nextFormAction?: (formData: FormData) => void | Promise<void>;
  backLabel?: string;
  nextLabel?: string;
};

export default function CampaignFlowStepNavigation({
  backHref,
  nextHref,
  nextFormAction,
  backLabel = "Back",
  nextLabel = "Next",
}: CampaignFlowStepNavigationProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      {backHref ? (
        <Link href={backHref} className="rounded border border-[#d3dbe5] px-3 py-1.5 text-sm text-[#1f2735]">
          {backLabel}
        </Link>
      ) : (
        <span />
      )}
      {nextFormAction ? (
        <button formAction={nextFormAction} className="rounded-md bg-[#1d3652] px-3 py-1.5 text-sm text-white">
          {nextLabel}
        </button>
      ) : null}
      {!nextFormAction && nextHref ? (
        <Link href={nextHref} className="rounded-md bg-[#1d3652] px-3 py-1.5 text-sm text-white">
          {nextLabel}
        </Link>
      ) : null}
    </div>
  );
}
