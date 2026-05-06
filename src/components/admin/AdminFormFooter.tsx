type Props = {
  checkboxName: string;
  checkboxLabel: string;
  defaultChecked?: boolean;
  buttonLabel: string;
  buttonTestId?: string;
  disabled?: boolean;
};

export default function AdminFormFooter({
  checkboxName,
  checkboxLabel,
  defaultChecked,
  buttonLabel,
  buttonTestId,
  disabled,
}: Props) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e2e8f0] pt-3"
      data-testid="admin-form-footer"
    >
      <label className="inline-flex items-center gap-2 text-sm text-[#334155]" data-testid="admin-form-footer-checkbox">
        <input type="checkbox" name={checkboxName} defaultChecked={defaultChecked} /> {checkboxLabel}
      </label>
      <button
        type="submit"
        className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
        data-testid={buttonTestId}
        disabled={disabled}
      >
        {buttonLabel}
      </button>
    </div>
  );
}
