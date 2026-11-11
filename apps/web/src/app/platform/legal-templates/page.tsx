import { redirect } from "next/navigation";

export default function LegacyLegalTemplatesPage() {
  redirect("/platform/dashboard?tab=legalDocuments");
}
