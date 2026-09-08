export const FORMAS_PAGAMENTO = [
  { value: "vale", label: "Vale" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "pix_ted", label: "PIX/TED" },
  { value: "deposito", label: "Depósito" },
  { value: "conta_terceiros", label: "Conta de 3º" },
  { value: "cheque", label: "Cheque" },
  { value: "boleto", label: "Boleto" },
];

// Formas que são creditadas imediatamente como recebidas ao lançar o pedido
// (cheque conta como recebido pois já está fisicamente em mãos, mesmo com data
// futura; conta de 3º também, pois já entrou o dinheiro, só precisa saber de quem).
// PIX/TED e Depósito ficam de fora — precisam de conferência no extrato antes de
// contar como recebido, por isso sempre passam por Vales primeiro.
export const FORMAS_RECEBIMENTO_IMEDIATO = ["dinheiro", "cheque", "conta_terceiros"];

// Formas que precisam de confirmação futura (checar no extrato) antes de
// contar como realmente recebidas — nunca vão direto pra Recebidos.
export const FORMAS_QUE_PRECISAM_CONFIRMACAO = ["pix_ted", "deposito"];

// Um pedido recém-lançado pode ir direto pra Recebidos (sem passar por Vales)
// quando: sobrou 5% ou menos em aberto E nenhuma das formas de pagamento usadas
// é PIX/Depósito (essas sempre precisam de confirmação futura no extrato).
export function podeIrDireitoParaRecebidos(percentualAberto, formasPagamento) {
  const temFormaQuePrecisaConfirmar = formasPagamento.some((f) => FORMAS_QUE_PRECISAM_CONFIRMACAO.includes(f.tipo));
  return percentualAberto <= 5.0001 && !temFormaQuePrecisaConfirmar;
}

// Divide um valor total em N parcelas iguais, ajustando centavos na última parcela.
export function dividirValorIgualmente(valorTotal, numParcelas) {
  const total = Math.round(Number(valorTotal) * 100);
  const n = Math.max(1, Number(numParcelas) || 1);
  const base = Math.floor(total / n);
  const resto = total - base * n;
  const valores = Array.from({ length: n }, (_, i) => base + (i < resto ? 1 : 0));
  return valores.map((v) => v / 100);
}

// Gera as datas das parcelas do cheque, igualmente espaçadas entre hoje e o prazo do último cheque.
export function calcularParcelasCheque(prazoUltimoCheque, numFolhas, valorTotal) {
  const n = Math.max(1, Number(numFolhas) || 1);
  const valores = dividirValorIgualmente(valorTotal, n);
  const hoje = new Date();
  const dataFinal = new Date(prazoUltimoCheque + "T00:00:00");
  const diffDias = Math.max(0, Math.round((dataFinal - hoje) / 86400000));
  const passo = n > 1 ? diffDias / (n - 1) : 0;

  return valores.map((valor, i) => {
    const dias = n > 1 ? Math.round(passo * i) : diffDias;
    const data = new Date(hoje.getTime() + dias * 86400000);
    return {
      numero: i + 1,
      valor,
      data: data.toISOString().slice(0, 10),
    };
  });
}

export const ESTADOS_BR = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB",
  "PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];

export function formatCurrency(value) {
  const n = Number(value) || 0;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatDate(dateStr) {
  if (!dateStr) return "-";
  const d = typeof dateStr === "string" ? new Date(dateStr + "T00:00:00") : dateStr;
  return d.toLocaleDateString("pt-BR");
}

// Um pedido em aberto é considerado atrasado se tiver parcela(s) de cheque
// cuja data já passou (assumindo que ainda não foi baixado).
// Atraso agora é baseado no Prazo de pagamento do cliente (dias corridos a partir da
// data do pedido), não mais nas parcelas de cheque — cheque já conta como recebido
// (fica em Recebidos), então não deve ser motivo de "atraso".
// Estrutura de checkpoints de cobrança a partir do prazo do cliente (em dias):
// - sem prazo / "À vista" (0 dias): só 1 checkpoint, com 1 semana de tolerância
//   antes de considerar atrasado (dá tempo do cheque/depósito compensar etc.)
// - "30 dias" (30): 1 checkpoint só, no dia 30, exigindo 100% pago.
// - "30 e 60 dias" (60): 2 checkpoints — no dia 30 espera pelo menos a metade
//   paga (usamos 40% em vez de 50% pra dar uma margem de erro), no dia 60
//   espera 100%.
// - "30, 60 e 90 dias" (90): 3 checkpoints, seguindo a mesma lógica (ideal
//   dividido em partes iguais, com 10 pontos percentuais de margem em cada
//   checkpoint intermediário; o último sempre exige 100%).
const DIAS_TOLERANCIA_A_VISTA = 7;
const MARGEM_PERCENTUAL_CHECKPOINT = 10;

function checkpointsDoPrazo(prazoDias, prazoModelo) {
  // Se o cliente tem um modelo de prazo escolhido, usamos os pontos de
  // cobrança dele. Isso é o que permite prazos como "Entrada + 30 e 60",
  // que não dá pra descrever só com um número de dias.
  const opcao = prazoModelo ? OPCOES_PRAZO.find((o) => o.id === prazoModelo) : null;
  if (opcao) {
    return opcao.checkpoints.map(([dias, percentualMinimo]) => ({ dias, percentualMinimo }));
  }

  // Sem modelo definido, caímos no comportamento por número de dias. Prazo
  // ausente ou zero conta como "à vista": 1 semana de tolerância. Como o prazo
  // é lido do cadastro ATUAL do cliente, basta preencher lá depois que os
  // pedidos antigos dele passam a ser avaliados pelo prazo correto.
  const dias = Number(prazoDias);
  if (!dias || dias <= 0) {
    return [{ dias: DIAS_TOLERANCIA_A_VISTA, percentualMinimo: 100 }];
  }
  const numPassos = Math.max(1, Math.round(dias / 30));
  const checkpoints = [];
  for (let i = 1; i <= numPassos; i++) {
    const ehUltimo = i === numPassos;
    checkpoints.push({
      dias: (dias / numPassos) * i,
      percentualMinimo: ehUltimo ? 100 : Math.max(0, (i / numPassos) * 100 - MARGEM_PERCENTUAL_CHECKPOINT),
    });
  }
  return checkpoints;
}

// Um pedido pode ser marcado como "conferido" — some da lista de atrasados por
// 24h, pra quem já ligou/cobrou não ficar vendo o mesmo nome no dia seguinte.
export function estaConferido(pedido) {
  if (!pedido?.conferidoAte) return false;
  return new Date(pedido.conferidoAte).getTime() > Date.now();
}

// Descobre qual é a PRIMEIRA compra ainda em aberto de um pedido, aplicando os
// pagamentos em ordem cronológica (o dinheiro que entra quita primeiro as
// compras mais antigas). É essa data que vale pra contar atraso — não a data do
// pedido inteiro.
//
// Exemplo: comprou em 01/08, pagou metade; comprou de novo em 01/09. Como a
// metade paga cobre a compra de 01/08 inteira, a referência de atraso passa a
// ser 01/09, não 01/08. Assim o cliente não fica marcado como atrasado por uma
// compra que ele já quitou.
export function situacaoEmAbertoDoPedido(pedido) {
  const itens = [...(pedido.itens || [])]
    .filter((it) => it.data)
    .sort((a, b) => String(a.data).localeCompare(String(b.data)));

  const pago = valorPagoDoPedido(pedido);

  // Pedido sem itens detalhados (legado): cai pro comportamento antigo, usando
  // a data e o total do pedido como um bloco só.
  if (itens.length === 0) {
    const total = valorDevidoDoPedido(pedido);
    if (total <= 0 || pago >= total - 0.01) return null;
    return { dataRef: pedido.data, percentualPago: (pago / total) * 100 };
  }

  let credito = pago;
  let idxPrimeiroAberto = -1;
  for (let i = 0; i < itens.length; i++) {
    const v = Number(itens[i].valor) || 0;
    if (credito >= v - 0.01) { credito -= v; continue; }
    idxPrimeiroAberto = i;
    break;
  }
  if (idxPrimeiroAberto === -1) return null; // tudo quitado

  const restantes = itens.slice(idxPrimeiroAberto);
  const totalRestante = restantes.reduce((s, it) => s + (Number(it.valor) || 0), 0);
  const percentualPago = totalRestante > 0 ? (credito / totalRestante) * 100 : 100;

  return { dataRef: itens[idxPrimeiroAberto].data, percentualPago, totalRestante };
}

// `clienteAtual` é opcional: quando informado, o prazo vem do cadastro de hoje
// em vez da cópia congelada no pedido. Assim, preencher o prazo de um cliente
// passa a valer também pros pedidos antigos dele, sem precisar reeditar cada um.
export function pedidoEstaAtrasado(pedido, clienteAtual) {
  if (pedido.arquivado) return false;
  if (estaConferido(pedido)) return false;

  const situacao = situacaoEmAbertoDoPedido(pedido);
  if (!situacao || !situacao.dataRef) return false;

  const prazoBruto = clienteAtual?.prazo ?? pedido.clientePrazo;
  const modelo = clienteAtual?.prazoModelo ?? pedido.clientePrazoModelo;
  const checkpoints = checkpointsDoPrazo(prazoBruto, modelo);

  const diasPassados = (Date.now() - new Date(situacao.dataRef + "T00:00:00").getTime()) / 86400000;
  return checkpoints.some((cp) => diasPassados >= cp.dias && situacao.percentualPago + 0.01 < cp.percentualMinimo);
}

// Extrai o percentual numérico de um texto livre de desconto, ex: "5% à vista" -> 5
export function parseDescontoPercent(texto) {
  if (!texto) return 0;
  const match = String(texto).match(/([\d]+(?:[.,]\d+)?)\s*%/);
  if (!match) return 0;
  return parseFloat(match[1].replace(",", "."));
}

// Valor efetivamente devido pelo cliente, já descontado o percentual de desconto (se houver).
export function calcularValorDevido(valorBruto, descontoTexto) {
  const percent = parseDescontoPercent(descontoTexto);
  return Number(valorBruto) * (1 - percent / 100);
}

// Opções fixas de prazo — o valor salvo continua sendo um número de dias
// (o "prazo final" da condição), pra não quebrar nada que já lê esse campo
// (atraso, previsão de recebimento em 30 dias etc.)
// Cada modelo de prazo define seus próprios pontos de cobrança:
// [dias após a compra, % mínimo que já deveria ter sido pago].
// O último ponto sempre exige 100%. Nos intermediários deixamos ~10 pontos
// percentuais de folga sobre o ideal, pra dar margem de erro (ex: no "30 e 60",
// no dia 30 o ideal seria 50% pago, mas só cobramos a partir de 40%).
// "Entrada" é tratada como uma parcela que vence em 7 dias.
export const OPCOES_PRAZO = [
  { id: "avista", label: "À vista", dias: 0, checkpoints: [[7, 100]] },
  { id: "30", label: "30 dias", dias: 30, checkpoints: [[30, 100]] },
  { id: "entrada30", label: "Entrada + 30 dias", dias: 30, checkpoints: [[7, 40], [30, 100]] },
  { id: "30-60", label: "30 e 60 dias", dias: 60, checkpoints: [[30, 40], [60, 100]] },
  { id: "entrada30-60", label: "Entrada + 30 e 60 dias", dias: 60, checkpoints: [[7, 23], [30, 57], [60, 100]] },
  { id: "30-45-60", label: "30, 45 e 60 dias", dias: 60, checkpoints: [[30, 23], [45, 57], [60, 100]] },
  { id: "30-60-90", label: "30, 60 e 90 dias", dias: 90, checkpoints: [[30, 23], [60, 57], [90, 100]] },
];

export function opcaoPrazoPorId(id) {
  return OPCOES_PRAZO.find((o) => o.id === id) || null;
}

// Descobre qual opção do dropdown corresponde ao que está gravado. Prioriza o
// modelo salvo (prazoModelo); sem ele (cadastro antigo, de antes desse campo
// existir), tenta achar pelo número de dias — pegando a opção "simples"
// (sem entrada) quando há mais de uma com o mesmo prazo final, pra não supor
// "Entrada" em dados antigos que nunca tiveram esse conceito.
export function idPrazoAtual(prazoModelo, prazoDias) {
  if (prazoModelo && OPCOES_PRAZO.some((o) => o.id === prazoModelo)) return prazoModelo;
  if (prazoDias === undefined || prazoDias === null || prazoDias === "") return "";
  const opcao = OPCOES_PRAZO.find((o) => o.dias === Number(prazoDias));
  return opcao ? opcao.id : "";
}

// O desconto sempre foi guardado como um texto livre (ex: "5% à vista" ou
// "5% fixo"), pra não quebrar o parser que já existe (parseDescontoPercent).
// Essas duas funções só separam a edição em dois campos (número + condição)
// e remontam esse mesmo formato de texto ao salvar.
export function parseDescontoCampos(texto) {
  const match = String(texto || "").match(/([\d]+(?:[.,]\d+)?)\s*%/);
  const numero = match ? match[1].replace(",", ".") : "";
  const condicao = /fixo/i.test(texto || "") ? "fixo" : "avista";
  return { numero, condicao };
}
export function montarDescontoTexto(numero, condicao) {
  if (!numero) return "";
  return `${numero}% ${condicao === "fixo" ? "fixo" : "à vista"}`;
}

// Dias limite pra uma condição "à vista" ainda dar direito ao desconto.
const PRAZO_MAXIMO_DESCONTO_AVISTA = 7;

// Decide se o desconto padrão do cliente vale PRA ESSE pedido específico:
// - condição "fixo" -> sempre vale.
// - condição "à vista" -> só vale se o prazo de pagamento usado nesse pedido
//   for de até 7 dias (ex: cliente escolheu "À vista" no prazo).
// Retorna o texto de desconto a gravar no pedido — vazio quando não se aplica,
// pra não gravar um desconto que na prática não valeu dessa vez.
export function descontoAplicavelAoPedido(descontoPadrao, prazoDias) {
  const { numero, condicao } = parseDescontoCampos(descontoPadrao);
  if (!numero) return "";
  if (condicao === "fixo") return descontoPadrao;
  return Number(prazoDias) <= PRAZO_MAXIMO_DESCONTO_AVISTA ? descontoPadrao : "";
}

// Fonte única de verdade pro "valor total" de um pedido: sempre a soma dos
// itens (compras) daquele pedido, com o desconto aplicado — nunca um campo
// solto que possa ficar desatualizado ou divergir do que está listado em
// "Compras". Pedidos sem itens (não deveria acontecer, mas por segurança)
// caem pro campo valor/valorDevido gravado.
// PROTEÇÃO DE DADOS — só pedidos marcados com `calculoAoVivo` têm o total
// recalculado a partir dos itens. Todo pedido antigo (importado da planilha ou
// criado antes dessa regra existir) NÃO tem essa marca, então usa o valor que
// está gravado e nunca mais muda sozinho por causa de mudança de lógica.
// Quando alguém edita um item/pagamento de um pedido antigo, aí sim ele passa a
// ser marcado como "ao vivo" — porque foi uma alteração deliberada, não um
// efeito colateral de deploy.
export function valorDevidoDoPedido(p) {
  if (p.calculoAoVivo && p.itens?.length > 0) {
    const bruto = p.itens.reduce((s, it) => s + (Number(it.valor) || 0), 0);
    return calcularValorDevido(bruto, p.desconto);
  }
  return Number(p.valorDevido ?? p.valor) || 0;
}

// Mesma filosofia do valorDevidoDoPedido, mas pro lado do que já foi pago:
// sempre a soma do que realmente está registrado — nunca um contador solto.
// Importante: PIX/Depósito confirmado NÃO entra aqui pela formasPagamento,
// porque confirmar sempre cria uma entrada correspondente em "pagamentos"
// (ver confirmarFormaPagamento) — contar os dois lados duplicaria o valor.
// Só dinheiro/cheque/conta de 3º contam direto pela formasPagamento, porque
// esses nunca geram uma entrada em "pagamentos" (já são recebidos na hora).
export function valorPagoDoPedido(p) {
  if (!p.calculoAoVivo) return Number(p.valorPago) || 0;
  const dasFormas = (p.formasPagamento || []).reduce((s, f) => {
    if (FORMAS_RECEBIMENTO_IMEDIATO.includes(f.tipo)) return s + (Number(f.valor) || 0);
    return s;
  }, 0);
  const dasBaixas = (p.pagamentos || []).reduce((s, pg) => s + (Number(pg.valor) || 0), 0);
  return dasFormas + dasBaixas;
}

// Saldo em aberto de um pedido = valor total (soma das compras, já com
// desconto) - o que já foi pago.
export function saldoDoPedido(p) {
  return valorDevidoDoPedido(p) - valorPagoDoPedido(p);
}

export const CONTAS_PADRAO = [
  "Itaú - EGIJJ",
  "Bradesco - EGIJJ",
  "Bradesco - EGI",
  "Stone - EGIJJ",
  "Terceiros",
];

export function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

// Gera o link do WhatsApp com o número já formatado (adiciona 55 se faltar) e a
// mensagem de reengajamento pronta pro cliente inativo.
export function linkWhatsAppInativo(telefone, nomeCliente) {
  let digitos = String(telefone || "").replace(/\D/g, "");
  if (digitos.length <= 11) digitos = "55" + digitos; // adiciona DDI Brasil se faltar
  const mensagem =
    `Olá ${nomeCliente}, tudo bem?\n` +
    `Percebi que faz um tempo que não compra com a gente, como foi a saída do último pedido? ` +
    `Posso estar enviando nosso novo catálogo com muitas novidades? 😁\n` +
    `Aguardo retorno`;
  return `https://wa.me/${digitos}?text=${encodeURIComponent(mensagem)}`;
}

// --- Lógica de status "resumo do cliente" na aba Vales ---------------------
// percentual em aberto = saldo em aberto / valor total devido, em %.
// Negativo = cliente pagou a mais (crédito).
export function calcularPercentualAberto(saldo, totalDevido) {
  if (!totalDevido || totalDevido === 0) return 0;
  return (saldo / totalDevido) * 100;
}

// Tag exibida no resumo do cliente, considerando o percentual em aberto:
// - saldo negativo (pagou a mais) -> "A ver"
// - percentual <= 1% -> "Pago" (mas só sai da lista quando movido manualmente)
// - percentual <= 10% (inclui atrasado) -> continua "Em aberto"/"Atrasado", mas já
//   libera o botão de mover pra recebidos
export function tagResumoCliente(saldo, percentual, atrasado) {
  if (saldo < -0.01) return { texto: "A ver", classe: "badge-aver" };
  if (percentual <= 1.0001) return { texto: "Pago", classe: "badge-pago" };
  if (atrasado) return { texto: "Atrasado", classe: "badge-atraso" };
  return { texto: "Em aberto", classe: "badge-aberto" };
}

// Pode mover manualmente pra Recebidos quando o percentual em aberto (ignorando
// sinal, já que crédito também conta como "resolvido") for <= 10%.
export function podeMoverParaRecebidos(percentual) {
  return percentual <= 10.0001;
}
