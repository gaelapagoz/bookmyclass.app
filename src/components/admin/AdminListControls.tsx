type AdminListFilterOption = {
  value: string;
  label: string;
};

type AdminListControlsProps = {
  basePath: string;
  filterName: string;
  filterLabel?: string;
  filterValue: string;
  filterOptions: AdminListFilterOption[];
  searchName: string;
  searchValue: string;
  searchPlaceholder: string;
  searchAriaLabel: string;
};

export default function AdminListControls({
  basePath,
  filterName,
  filterLabel = "Filter",
  filterValue,
  filterOptions,
  searchName,
  searchValue,
  searchPlaceholder,
  searchAriaLabel,
}: AdminListControlsProps) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <form method="get" action={basePath} className="flex items-end gap-2">
        <div>
          <label htmlFor={`${filterName}-filter`} className="text-xs uppercase tracking-wide text-[#5a6d86]">
            {filterLabel}
          </label>
          <select
            id={`${filterName}-filter`}
            name={filterName}
            defaultValue={filterValue}
            className="mt-1 block rounded-md border border-[#d3dbe5] bg-white px-3 py-2 text-sm text-[#1f2735]"
          >
            {filterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input type="hidden" name="page" value="1" />
          {searchValue ? <input type="hidden" name={searchName} value={searchValue} /> : null}
        </div>
        <button type="submit" className="rounded-md bg-[#1d3652] px-3 py-2 text-sm text-white">
          Apply
        </button>
      </form>

      <form method="get" action={basePath} className="flex items-center gap-2">
        <input type="hidden" name={filterName} value={filterValue} />
        <input type="hidden" name="page" value="1" />
        <input
          type="search"
          name={searchName}
          defaultValue={searchValue}
          placeholder={searchPlaceholder}
          aria-label={searchAriaLabel}
          className="w-64 rounded-md border border-[#d3dbe5] bg-white px-3 py-2 text-sm text-[#1f2735]"
        />
        <button type="submit" className="rounded-md bg-[#1d3652] px-3 py-2 text-sm text-white">
          Search
        </button>
      </form>
    </div>
  );
}

