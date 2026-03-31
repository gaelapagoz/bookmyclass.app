import { Extension } from "@tiptap/core";

type FontSizeOptions = {
  allowedSizes: readonly string[];
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

export const FontSize = Extension.create<FontSizeOptions>({
  name: "fontSize",

  addOptions() {
    return {
      allowedSizes: [],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const fontSize = element.style.fontSize?.toLowerCase();
              if (!fontSize) {
                return null;
              }
              return this.options.allowedSizes.includes(fontSize) ? fontSize : null;
            },
            renderHTML: (attributes: { fontSize?: string | null }) => {
              const fontSize = attributes.fontSize?.toLowerCase();
              if (!fontSize || !this.options.allowedSizes.includes(fontSize)) {
                return {};
              }
              return { style: `font-size: ${fontSize}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }) => {
          const normalized = size.toLowerCase();
          if (!this.options.allowedSizes.includes(normalized)) {
            return false;
          }
          return chain().setMark("textStyle", { fontSize: normalized }).run();
        },
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

