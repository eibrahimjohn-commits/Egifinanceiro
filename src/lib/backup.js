import * as XLSX from "xlsx";
import { listarPedidos } from "./pedidos";
import { listarClientes } from "./clientes";
import { valorDevidoDoPedido, valorPagoDoPedido, saldoDoPedido } from "./constants";

// Backup completo em planilha. A ideia não é ser um "export bonito" pra
// analisar — é uma cópia crua e legível de tudo que está no Firestore, pra
// existir uma segunda via fora do sistema. Se algo der muito errado no banco
// (ou numa alteração de lógica), esses números continuam aqui, congelados na
// data do backup.
//
// Três abas:
//  - Clientes: o cadastro inteiro
//  - Pedidos: uma linha por pedido, com os totais como estão hoje
//  - Movimentos: uma linha por compra e por pagamento (o detalhe fino, que é
//    o que permite reconstruir qualquer total do zero se precisar)
export async function gerarBackupPlanilha() {
  const [pedidos, clientes] = await Promise.all([listarPedidos(), listarClientes()]);

  const abaClientes = clientes.map((c) => ({
    Codigo: c.codigo || "",
    Nome: c.nome || "",
    RazaoSocial: c.razaoSocial || "",
    CNPJ: c.cnpj || "",
    Grupo: c.grupo || "",
    Representante: c.representante || "",
    Cidade: c.cidade || "",
    Estado: c.estado || "",
    PrazoDias: c.prazo ?? "",
    DescontoPadrao: c.descontoPadrao || "",
    Telefone: (c.telefones || [])[0] || "",
    TelefoneAlt: (c.telefones || [])[1] || "",
    WhatsApp: c.whatsapp || "",
    SituacaoCadastral: c.infoExtra?.situacaoCadastral || "",
    Observacao: c.observacao || "",
    IdInterno: c.id,
  }));

  const abaPedidos = pedidos.map((p) => ({
    Cliente: p.clienteNome || "",
    Grupo: p.clienteGrupo || "",
    Representante: p.clienteRepresentante || "",
    DataPedido: p.data || "",
    ValorBruto: Number(p.valor) || 0,
    Desconto: p.desconto || "",
    ValorDevido: valorDevidoDoPedido(p),
    ValorPago: valorPagoDoPedido(p),
    SaldoEmAberto: saldoDoPedido(p),
    Status: p.status || "",
    Arquivado: p.arquivado ? "sim" : "nao",
    CalculoAoVivo: p.calculoAoVivo ? "sim" : "nao (congelado)",
    PrazoDias: p.clientePrazo ?? "",
    OrigemImportacao: p.origemImportacao ? `${p.origemImportacao.aba || ""} linha ${p.origemImportacao.linha || ""}` : "",
    TotalOriginalPlanilha: p.origemImportacao?.totalPedidosOriginal ?? "",
    EmAbertoOriginalPlanilha: p.origemImportacao?.emAbertoOriginal ?? "",
    IdInterno: p.id,
  }));

  const abaMovimentos = [];
  pedidos.forEach((p) => {
    (p.itens || []).forEach((it) => {
      abaMovimentos.push({
        Cliente: p.clienteNome || "",
        PedidoId: p.id,
        Tipo: "COMPRA",
        Data: it.data || "",
        Valor: Number(it.valor) || 0,
        Forma: "",
        Conta: "",
        Descricao: "",
      });
    });
    (p.formasPagamento || []).forEach((f) => {
      abaMovimentos.push({
        Cliente: p.clienteNome || "",
        PedidoId: p.id,
        Tipo: "RECEBIDO NA VENDA",
        Data: p.data || "",
        Valor: Number(f.valor) || 0,
        Forma: f.tipo || "",
        Conta: f.conta || "",
        Descricao: f.descricao || "",
      });
    });
    (p.pagamentos || []).forEach((pg) => {
      abaMovimentos.push({
        Cliente: p.clienteNome || "",
        PedidoId: p.id,
        Tipo: "PAGAMENTO",
        Data: pg.data || "",
        Valor: Number(pg.valor) || 0,
        Forma: pg.formaPagamento || "",
        Conta: pg.conta || "",
        Descricao: pg.descricao || "",
      });
    });
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(abaClientes), "Clientes");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(abaPedidos), "Pedidos");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(abaMovimentos), "Movimentos");

  const hoje = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `backup-egi-financeiro-${hoje}.xlsx`);

  return { clientes: abaClientes.length, pedidos: abaPedidos.length, movimentos: abaMovimentos.length };
}
