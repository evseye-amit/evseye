import { redirect } from "next/navigation";

export default function ClientLegalDocumentsPage() {
  redirect("/?workspace=operations&tab=legal-documents");
}
