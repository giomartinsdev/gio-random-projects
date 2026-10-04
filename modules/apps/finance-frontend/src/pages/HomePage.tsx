import { DashboardPage } from "@/pages/DashboardPage";
import { OpenFinancePage } from "@/pages/OpenFinancePage";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// As duas telas do app depois do login: o painel (o que já existia) e a seção
// de Open Finance (conectar contas + saldos + extrato importado).
export function HomePage() {
  return (
    <Tabs defaultValue="painel">
      <TabsList className="grid w-full max-w-xs grid-cols-2">
        <TabsTrigger value="painel">Painel</TabsTrigger>
        <TabsTrigger value="openfinance">Open Finance</TabsTrigger>
      </TabsList>
      <TabsContent value="painel">
        <DashboardPage />
      </TabsContent>
      <TabsContent value="openfinance">
        <OpenFinancePage />
      </TabsContent>
    </Tabs>
  );
}
