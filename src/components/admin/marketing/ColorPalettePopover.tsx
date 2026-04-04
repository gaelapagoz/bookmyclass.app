"use client";

import { useId, useState } from "react";

type ColorPalettePopoverProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  swatches: readonly string[];
  testId: string;
};

export default function ColorPalettePopover({
  label,
  value,
  onChange,
  swatches,
  testId,
}: ColorPalettePopoverProps) {
  const [open, setOpen] = useState(false);
  const inputId = useId();

  return (
    <div className="relative" data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-2 rounded border border-[#d3dbe5] bg-white px-2 py-1 text-xs text-[#334155] hover:bg-[#f3f6fb]"
        data-testid={`${testId}-trigger`}
      >
        <span className="h-4 w-4 rounded border border-[#cbd5e1]" style={{ backgroundColor: value }} />
        <span>{label}</span>
      </button>

      {open ? (
        <div
          className="absolute left-0 top-[calc(100%+6px)] z-20 w-56 rounded-lg border border-[#d3dbe5] bg-white p-3 shadow-md"
          data-testid={`${testId}-popover`}
        >
          <div className="grid grid-cols-8 gap-1.5">
            {swatches.map((swatch) => {
              const selected = swatch.toLowerCase() === value.toLowerCase();
              return (
                <button
                  key={`${label}-${swatch}`}
                  type="button"
                  aria-label={`${label} ${swatch}`}
                  onClick={() => {
                    onChange(swatch);
                    setOpen(false);
                  }}
                  className={`h-5 w-5 rounded-full border ${selected ? "border-[#0f172a] ring-1 ring-[#0f172a]" : "border-[#cbd5e1]"}`}
                  style={{ backgroundColor: swatch }}
                />
              );
            })}
          </div>

          <label htmlFor={inputId} className="mt-3 block text-xs text-[#5a6d86]">
            Custom color
          </label>
          <input
            id={inputId}
            type="color"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="mt-1 h-8 w-full cursor-pointer rounded border border-[#d3dbe5] bg-white p-0.5"
          />
        </div>
      ) : null}
    </div>
  );
}

