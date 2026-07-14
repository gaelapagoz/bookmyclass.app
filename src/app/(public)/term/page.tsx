import { permanentRedirect } from "next/navigation";

export default function TermLegacyEntryPage() {
  permanentRedirect("/about/terms-and-conditions");
}
