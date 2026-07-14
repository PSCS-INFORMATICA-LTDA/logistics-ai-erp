import { DreSubNav } from "@/components/dre/DreSubNav";

export default function DreLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4 p-1">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">DRE</h1>
        <p className="mt-1 text-sm text-slate-600">
          Lançamentos da empresa, motorista e veículo. No celular, use o menu ☰ no topo.
        </p>
      </div>
      <DreSubNav />
      {children}
    </div>
  );
}
