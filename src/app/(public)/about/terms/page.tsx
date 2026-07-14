import { permanentRedirect } from "next/navigation";

export default function AboutTermsPage() {
  permanentRedirect("/about/terms-and-conditions");
}
