import { useState } from "react";
import Layout from "./components/Layout";
import Pedidos from "./pages/Pedidos";
import ValesRecebidos from "./pages/ValesRecebidos";
import Pagamentos from "./pages/Pagamentos";
import Analises from "./pages/Analises";
import BaseDados from "./pages/BaseDados";

export default function App() {
  const [tab, setTab] = useState("pedidos");

  return (
    <Layout active={tab} onChange={setTab}>
      {tab === "pedidos" && <Pedidos />}
      {tab === "vales" && <ValesRecebidos />}
      {tab === "pagamentos" && <Pagamentos />}
      {tab === "analises" && <Analises />}
      {tab === "base" && <BaseDados />}
    </Layout>
  );
}
