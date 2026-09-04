import { useState } from "react";
import Layout from "./components/Layout";
import LoginGate, { estaAutenticado } from "./components/LoginGate";
import Pedidos from "./pages/Pedidos";
import ValesRecebidos from "./pages/ValesRecebidos";
import Pagamentos from "./pages/Pagamentos";
import Analises from "./pages/Analises";
import BaseDados from "./pages/BaseDados";
import Prospeccao from "./pages/Prospeccao";

export default function App() {
  const [autenticado, setAutenticado] = useState(estaAutenticado());
  const [tab, setTab] = useState("pedidos");
  const [alvoVales, setAlvoVales] = useState(null); // pedido atrasado clicado nas Análises

  const WIDE_TABS = ["pedidos", "vales", "analises", "base", "prospeccao"];
  const FULL_TABS = ["vales"];

  if (!autenticado) {
    return <LoginGate onEntrar={() => setAutenticado(true)} />;
  }

  function abrirNoVales(pedido) {
    setAlvoVales(pedido);
    setTab("vales");
  }

  return (
    <Layout active={tab} onChange={setTab} wide={WIDE_TABS.includes(tab)} full={FULL_TABS.includes(tab)}>
      {tab === "pedidos" && <Pedidos />}
      {tab === "vales" && (
        <ValesRecebidos alvoAbrir={alvoVales} onAlvoConsumido={() => setAlvoVales(null)} />
      )}
      {tab === "pagamentos" && <Pagamentos />}
      {tab === "analises" && <Analises onAbrirNoVales={abrirNoVales} />}
      {tab === "base" && <BaseDados />}
      {tab === "prospeccao" && <Prospeccao />}
    </Layout>
  );
}
