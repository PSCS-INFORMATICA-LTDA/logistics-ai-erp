import { redirect } from "next/navigation";

/** Rota antiga: relatório ficou em Operacional. */
export default function DocumentosAVencerRedirectPage() {
  redirect("/operacional/documentos-a-vencer");
}
