// Calculadora de margem multi-marketplace (Amazon, Mercado Livre, Magalu, Shopee, SHEIN).
// Regras e motor de cálculo portados, SEM alteração de fórmula, da calculadora do
// Henrique Niada (github.com/HN-devs-mentoria/calculadora-margem-hn), que era React+Vite.
// Aqui viram um arquivo só, no mesmo formato do analise.js: o MESMO código roda no
// navegador (<script>) e no Node (require), então o teste confere o que a tela usa.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Margem = fabrica();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /*
   * marketplaces.js
   * ----------------
   * Base de regras (comissões, taxas fixas, frete e impostos) de cada marketplace.
   *
   * ⚠️ Os valores são DEFAULTS realistas baseados nas tabelas públicas vigentes
   * (revisão em agosto/2026). Variam por contrato, logística,
   * reputação, categoria exata e campanhas — por isso TODOS são editáveis na
   * interface ("Regras avançadas"). Última revisão das regras: maio/2026.
   *
   * MODELOS DE COMISSÃO (campo `modeloComissao`):
   *   - "categoria"            : comissão fixa por categoria (Amazon, Magalu, Shein)
   *   - "categoriaTipoAnuncio" : comissão por categoria E tipo de anúncio (Mercado Livre)
   *   - "faixaPreco"           : comissão e taxa fixa variam por faixa de preço (Shopee 2026)
   *
   * Sobre o preço de venda final incidem: comissão (%), taxa fixa do marketplace,
   * imposto (%), frete (quando pago pelo seller), custo do produto e custos extras.
   */

  const FRETE_PADRAO = [
    { ateKg: 0.3, valor: 19.9 },
    { ateKg: 0.5, valor: 22.9 },
    { ateKg: 1, valor: 26.9 },
    { ateKg: 2, valor: 32.9 },
    { ateKg: 5, valor: 42.9 },
    { ateKg: 9, valor: 54.9 },
    { ateKg: Infinity, valor: 74.9 },
  ];

  const MARKETPLACES = {
    mercadolivre: {
      id: "mercadolivre",
      nome: "Mercado Livre",
      cor: "#ffe600",
      corTexto: "#2d3277",
      emoji: "🟡",
      mensalidade: 0,
      modeloComissao: "categoriaTipoAnuncio",
      // Comissão depende da categoria E do tipo de anúncio (Clássico x Premium).
      // Premium embute parcelamento sem juros e tem comissão maior.
      tiposAnuncio: {
        classico: "Clássico",
        premium: "Premium (parcelamento s/ juros)",
      },
      categorias: {
        eletronicos: { nome: "Eletrônicos e Áudio", classico: 0.11, premium: 0.16 },
        celulares: { nome: "Celulares e Smartphones", classico: 0.105, premium: 0.155 },
        informatica: { nome: "Informática e Notebooks", classico: 0.13, premium: 0.18 },
        games: { nome: "Games e Consoles", classico: 0.13, premium: 0.18 },
        eletrodomesticos: { nome: "Eletrodomésticos", classico: 0.11, premium: 0.16 },
        moda: { nome: "Moda / Calçados", classico: 0.14, premium: 0.19 },
        casa: { nome: "Casa, Móveis e Decoração", classico: 0.12, premium: 0.17 },
        beleza: { nome: "Beleza e Cuidado Pessoal", classico: 0.13, premium: 0.18 },
        saude: { nome: "Saúde e Suplementos", classico: 0.14, premium: 0.19 },
        esportes: { nome: "Esportes e Fitness", classico: 0.12, premium: 0.17 },
        ferramentas: { nome: "Ferramentas / Construção", classico: 0.125, premium: 0.175 },
        brinquedos: { nome: "Brinquedos e Hobbies", classico: 0.13, premium: 0.18 },
        bebes: { nome: "Bebês e Maternidade", classico: 0.115, premium: 0.165 },
        pet: { nome: "Pet Shop", classico: 0.13, premium: 0.18 },
        papelaria: { nome: "Papelaria e Escritório", classico: 0.115, premium: 0.165 },
        livros: { nome: "Livros, Filmes e Música", classico: 0.11, premium: 0.16 },
        alimentos: { nome: "Alimentos e Bebidas", classico: 0.11, premium: 0.16 },
        instrumentos: { nome: "Instrumentos Musicais", classico: 0.125, premium: 0.175 },
        joias: { nome: "Joias e Relógios", classico: 0.14, premium: 0.19 },
        automotivo: { nome: "Acessórios para Veículos", classico: 0.14, premium: 0.19 },
        outros: { nome: "Outros", classico: 0.13, premium: 0.18 },
      },
      // Custo fixo por unidade para itens ABAIXO de R$ 79 (some acima disso).
      //  - até R$ 12,50 → 50% do valor do produto (tipo "pct")
      //  - R$ 12,50 a 29 → R$ 6,25 / 29 a 50 → R$ 6,50 / 50 a 79 → R$ 6,75
      custoFixo: [
        { ateValor: 12.5, tipo: "pct", valor: 0.5 },
        { ateValor: 29, tipo: "fixo", valor: 6.25 },
        { ateValor: 50, tipo: "fixo", valor: 6.5 },
        { ateValor: 79, tipo: "fixo", valor: 6.75 },
        { ateValor: Infinity, tipo: "fixo", valor: 0 },
      ],
      // Acima de R$ 79: frete grátis obrigatório pago pelo seller (varia c/ reputação).
      fretePagoPeloSeller: true,
      freteGratisAcimaDe: 79,
      freteTabela: [
        { ateKg: 0.3, valor: 18.95 },
        { ateKg: 0.5, valor: 20.95 },
        { ateKg: 1, valor: 24.95 },
        { ateKg: 2, valor: 30.95 },
        { ateKg: 5, valor: 39.95 },
        { ateKg: 9, valor: 49.95 },
        { ateKg: Infinity, valor: 69.95 },
      ],
    },

    amazon: {
      id: "amazon",
      nome: "Amazon",
      cor: "#ff9900",
      corTexto: "#131921",
      emoji: "🟠",
      mensalidade: 19.0, // Plano Profissional
      modeloComissao: "categoria",
      categorias: {
        eletronicos: { nome: "Eletrônicos", comissao: 0.13 },
        celulares: { nome: "Celulares", comissao: 0.11 },
        informatica: { nome: "Informática", comissao: 0.13 },
        games: { nome: "Games e Consoles", comissao: 0.11 },
        eletrodomesticos: { nome: "Eletrodomésticos", comissao: 0.13 },
        moda: { nome: "Moda / Vestuário", comissao: 0.14 },
        casa: { nome: "Casa e Cozinha", comissao: 0.12 },
        beleza: { nome: "Beleza", comissao: 0.143 },
        saude: { nome: "Saúde e Suplementos", comissao: 0.143 },
        esportes: { nome: "Esportes", comissao: 0.12 },
        ferramentas: { nome: "Ferramentas", comissao: 0.11 },
        brinquedos: { nome: "Brinquedos", comissao: 0.143 },
        bebes: { nome: "Bebês", comissao: 0.143 },
        pet: { nome: "Pet Shop", comissao: 0.143 },
        papelaria: { nome: "Papelaria e Escritório", comissao: 0.13 },
        livros: { nome: "Livros", comissao: 0.15 },
        alimentos: { nome: "Alimentos e Bebidas", comissao: 0.13 },
        instrumentos: { nome: "Instrumentos Musicais", comissao: 0.12 },
        joias: { nome: "Joias e Relógios", comissao: 0.14 },
        automotivo: { nome: "Automotivo", comissao: 0.13 },
        outros: { nome: "Outros", comissao: 0.143 },
      },
      taxaFixa: 0,
      // Produtos a partir de R$ 40 entram por padrão no Parcelamento sem Juros.
      // Desde 16/03/2026, o programa cobra 1,5%; o seller pode desativá-lo e
      // sobrescrever a comissão total nas regras avançadas.
      taxaPercentualAdicional: { aPartirDe: 40, valor: 0.015 },
      fretePagoPeloSeller: true,
      freteGratisAcimaDe: 0,
      freteTabela: FRETE_PADRAO,
    },

    magalu: {
      id: "magalu",
      nome: "Magalu",
      cor: "#0086ff",
      corTexto: "#ffffff",
      emoji: "🔵",
      mensalidade: 0,
      modeloComissao: "categoria",
      categorias: {
        eletronicos: { nome: "Eletrônicos / Eletroportáteis", comissao: 0.13 },
        celulares: { nome: "Celulares", comissao: 0.105 },
        informatica: { nome: "Informática", comissao: 0.13 },
        games: { nome: "Games e Consoles", comissao: 0.135 },
        eletrodomesticos: { nome: "Eletrodomésticos", comissao: 0.12 },
        moda: { nome: "Moda", comissao: 0.18 },
        casa: { nome: "Casa e Decoração", comissao: 0.165 },
        beleza: { nome: "Beleza", comissao: 0.17 },
        saude: { nome: "Saúde e Suplementos", comissao: 0.17 },
        esportes: { nome: "Esportes", comissao: 0.16 },
        ferramentas: { nome: "Ferramentas", comissao: 0.15 },
        brinquedos: { nome: "Brinquedos", comissao: 0.16 },
        bebes: { nome: "Bebês", comissao: 0.155 },
        pet: { nome: "Pet Shop", comissao: 0.16 },
        papelaria: { nome: "Papelaria e Escritório", comissao: 0.16 },
        livros: { nome: "Livros", comissao: 0.15 },
        alimentos: { nome: "Alimentos e Bebidas", comissao: 0.15 },
        instrumentos: { nome: "Instrumentos Musicais", comissao: 0.16 },
        joias: { nome: "Joias e Relógios", comissao: 0.18 },
        automotivo: { nome: "Automotivo", comissao: 0.15 },
        outros: { nome: "Outros", comissao: 0.16 },
      },
      taxaFixa: 0,
      fretePagoPeloSeller: true,
      freteGratisAcimaDe: 0,
      freteTabela: FRETE_PADRAO,
    },

    shopee: {
      id: "shopee",
      nome: "Shopee",
      cor: "#ee4d2d",
      corTexto: "#ffffff",
      emoji: "🔴",
      mensalidade: 0,
      modeloComissao: "faixaPreco",
      // ▶ Modelo vigente desde 1º/mar/2026 (Programa de Frete Grátis OBRIGATÓRIO,
      //   comissão já inclui o subsídio de frete). NÃO há mais teto de R$ 100.
      //   Faixas:
      //     < R$ 8,00            → 50% do valor (sem taxa fixa)
      //     R$ 8,00 a R$ 79,99   → 20% + R$ 4,00
      //     R$ 80,00 a R$ 99,99  → 14% + R$ 16,00
      //     R$ 100,00 a R$199,99 → 14% + R$ 20,00
      //     ≥ R$ 200,00          → 14% + R$ 26,00
      faixasComissao: [
        { ateValor: 8, comissao: 0.5, taxaFixa: 0, rotulo: "menos de R$ 8" },
        { ateValor: 80, comissao: 0.2, taxaFixa: 4, rotulo: "R$ 8 a 79,99" },
        { ateValor: 100, comissao: 0.14, taxaFixa: 16, rotulo: "R$ 80 a 99,99" },
        { ateValor: 200, comissao: 0.14, taxaFixa: 20, rotulo: "R$ 100 a 199,99" },
        { ateValor: Infinity, comissao: 0.14, taxaFixa: 26, rotulo: "acima de R$ 200" },
      ],
      // Vendedor CPF que passa de 450 pedidos / 90 dias paga +R$ 3,00 por item.
      adicionalCpfAlto: 3.0,
      // Frete coberto pelo Programa de Frete Grátis (já embutido na comissão).
      fretePagoPeloSeller: false,
      freteGratisAcimaDe: 0,
      freteTabela: FRETE_PADRAO,
      // Na Shopee a comissão é a mesma em TODAS as categorias (vem das faixas de
      // preço), então aqui só marcamos o fallback. Beleza pode variar 18–22% em
      // algumas subcategorias — ajuste em "Regras avançadas" se for o seu caso.
      categorias: {
        outros: { nome: "Todas as categorias (regra por faixa de preço)" },
      },
    },

    shein: {
      id: "shein",
      nome: "Shein",
      cor: "#222222",
      corTexto: "#ffffff",
      emoji: "⚫",
      mensalidade: 0,
      modeloComissao: "categoria",
      // SHEIN Brasil: desde 01/03/2026, 18% nas demais categorias. Vestuário
      // feminino passou a 20% em 22/10/2025; o agrupamento "moda" usa 20% por
      // segurança. O vendedor pode sobrescrever a taxa para sua subcategoria.
      categorias: {
        moda: { nome: "Moda / Vestuário feminino", comissao: 0.20 },
        outros: { nome: "Padrão SHEIN (demais categorias)", comissao: 0.18 },
      },
      taxaFixa: 0,
      fretePagoPeloSeller: true,
      freteGratisAcimaDe: 0,
      freteTabela: FRETE_PADRAO,
    },
  };

  // Lista canônica de categorias para o seletor (ordenada por afinidade de tema).
  const CATEGORIAS_GLOBAIS = [
    { id: "eletronicos", nome: "Eletrônicos e Áudio" },
    { id: "celulares", nome: "Celulares e Smartphones" },
    { id: "informatica", nome: "Informática e Notebooks" },
    { id: "games", nome: "Games e Consoles" },
    { id: "eletrodomesticos", nome: "Eletrodomésticos" },
    { id: "moda", nome: "Moda, Calçados e Vestuário" },
    { id: "casa", nome: "Casa, Móveis e Decoração" },
    { id: "beleza", nome: "Beleza e Cuidado Pessoal" },
    { id: "saude", nome: "Saúde e Suplementos" },
    { id: "esportes", nome: "Esportes e Fitness" },
    { id: "ferramentas", nome: "Ferramentas e Construção" },
    { id: "brinquedos", nome: "Brinquedos e Hobbies" },
    { id: "bebes", nome: "Bebês e Maternidade" },
    { id: "pet", nome: "Pet Shop" },
    { id: "papelaria", nome: "Papelaria e Escritório" },
    { id: "livros", nome: "Livros, Filmes e Música" },
    { id: "alimentos", nome: "Alimentos e Bebidas" },
    { id: "instrumentos", nome: "Instrumentos Musicais" },
    { id: "joias", nome: "Joias e Relógios" },
    { id: "automotivo", nome: "Automotivo" },
    { id: "outros", nome: "Outros" },
  ];

  // Faixas de tamanho — afetam o frete adicionando um acréscimo para volumosos.
  const TAMANHOS = [
    { id: "pequeno", nome: "Pequeno (envelope/caixa pequena)", acrescimoFrete: 0 },
    { id: "medio", nome: "Médio (caixa de sapato)", acrescimoFrete: 5 },
    { id: "grande", nome: "Grande (volumoso)", acrescimoFrete: 15 },
    { id: "extragrande", nome: "Extra grande / pesado", acrescimoFrete: 35 },
  ];

  /*
   * Motor de cálculo
   * ----------------
   * Motor de cálculo puro (sem DOM). Pode ser testado isoladamente em Node.
   *
   * Conceitos:
   *  - precoVenda (P): valor efetivamente cobrado do comprador (já com descontos/cupons).
   *  - precoAnunciado: preço "cheio" exibido antes de desconto e cupom.
   *  - Sobre P incidem: comissão (%), taxa fixa do marketplace, imposto (%),
   *    frete (quando pago pelo seller), custo do produto e custos extras.
   *
   * Relação anúncio -> venda:
   *    precoVenda = precoAnunciado * (1 - desconto) * (1 - cupom)
   *
   * Atenção: na Shopee (modelo "faixaPreco") a comissão % e a taxa fixa MUDAM
   * conforme a faixa de preço. No Mercado Livre a comissão depende do tipo de
   * anúncio (clássico/premium) e há custo fixo por faixa para itens < R$ 79.
   * Por isso o modo reverso resolve por iteração (ponto fixo).
   */

  function freteParaPeso(tabela, pesoKg) {
    for (const faixa of tabela) {
      if (pesoKg <= faixa.ateKg) return faixa.valor;
    }
    return tabela[tabela.length - 1].valor;
  }

  /** Localiza a faixa (de comissão ou custo) a que pertence um preço. */
  function faixaPara(tabela, preco) {
    if (!tabela) return null;
    for (const faixa of tabela) {
      if (preco <= faixa.ateValor) return faixa;
    }
    return tabela[tabela.length - 1];
  }

  /**
   * Comissão (em VALOR R$) e taxa fixa do marketplace para um dado preço.
   * Centraliza os 3 modelos de comissão num só lugar.
   * Retorna { comissaoRate, comissaoValor, taxaFixa }.
   */
  function tarifasMarketplace(mp, params, precoVenda) {
    // Override manual de comissão (campo "Regras avançadas") tem prioridade.
    if (params.overrideComissao != null && !Number.isNaN(params.overrideComissao)) {
      return {
        comissaoRate: params.overrideComissao,
        comissaoValor: precoVenda * params.overrideComissao,
        taxaFixa: taxaFixaBase(mp, params, precoVenda),
      };
    }

    if (mp.modeloComissao === "faixaPreco") {
      const faixa = faixaPara(mp.faixasComissao, precoVenda);
      let taxaFixa = faixa.taxaFixa || 0;
      // Adicional para vendedor CPF de alto volume (>450 pedidos/90 dias).
      if (params.shopeeCpfAlto && mp.adicionalCpfAlto) taxaFixa += mp.adicionalCpfAlto;
      return {
        comissaoRate: faixa.comissao,
        comissaoValor: precoVenda * faixa.comissao,
        taxaFixa,
      };
    }

    let rate;
    if (mp.modeloComissao === "categoriaTipoAnuncio") {
      const cat = mp.categorias[params.categoria] || mp.categorias.outros;
      const tipo = params.tipoAnuncio === "premium" ? "premium" : "classico";
      rate = cat[tipo];
    } else {
      // modelo "categoria"
      const cat = mp.categorias[params.categoria] || mp.categorias.outros;
      rate = cat ? cat.comissao : 0;
    }
    if (mp.taxaPercentualAdicional && precoVenda >= mp.taxaPercentualAdicional.aPartirDe) {
      rate += mp.taxaPercentualAdicional.valor;
    }
    return {
      comissaoRate: rate,
      comissaoValor: precoVenda * rate,
      taxaFixa: taxaFixaBase(mp, params, precoVenda),
    };
  }

  /** Taxa fixa / custo fixo para marketplaces que NÃO usam faixaPreco. */
  function taxaFixaBase(mp, params, precoVenda) {
    if (params.overrideTaxaFixa != null && !Number.isNaN(params.overrideTaxaFixa)) {
      return params.overrideTaxaFixa;
    }
    let total = mp.taxaFixa || 0;
    // Mercado Livre: custo fixo por unidade para itens < R$ 79.
    if (mp.custoFixo) {
      const faixa = faixaPara(mp.custoFixo, precoVenda);
      if (faixa) {
        total += faixa.tipo === "pct" ? precoVenda * faixa.valor : faixa.valor;
      }
    }
    return total;
  }

  /** Frete que o seller paga para um marketplace. */
  function calcularFrete(mp, params, precoVenda) {
    if (params.overrideFrete != null && !Number.isNaN(params.overrideFrete)) {
      return params.overrideFrete;
    }
    if (!mp.fretePagoPeloSeller) return 0;
    // Abaixo do limiar de frete grátis, normalmente o comprador paga o frete.
    if (mp.freteGratisAcimaDe && precoVenda < mp.freteGratisAcimaDe) return 0;
    const base = freteParaPeso(mp.freteTabela, params.pesoKg);
    return base + (params.acrescimoTamanho || 0);
  }

  /** Decompõe todos os custos para um dado preço de venda P. */
  function decompor(mp, params, precoVenda) {
    const { comissaoRate, comissaoValor, taxaFixa } = tarifasMarketplace(mp, params, precoVenda);
    const imposto = precoVenda * (params.impostoRate || 0);
    const frete = calcularFrete(mp, params, precoVenda);
    const custo = params.custo || 0;
    const extras = params.custosExtras || 0;

    const totalCustos = custo + comissaoValor + imposto + taxaFixa + frete + extras;
    const lucro = precoVenda - totalCustos;
    const margem = precoVenda > 0 ? lucro / precoVenda : 0;
    const markup = custo > 0 ? lucro / custo : 0;

    return {
      precoVenda,
      comissaoRate,
      comissaoValor,
      imposto,
      impostoRate: params.impostoRate || 0,
      taxaFixaMp: taxaFixa,
      frete,
      custo,
      extras,
      totalCustos,
      lucro,
      margem,
      markup,
    };
  }

  /** MODO DIRETO: dado o preço de venda, calcula o que sobra. */
  function calcularLucro(mp, params) {
    return decompor(mp, params, params.precoVenda);
  }

  /**
   * MODO REVERSO: descobre o preço de VENDA necessário para atingir uma meta
   * (margem % sobre o preço de venda, ou lucro fixo R$).
   *
   * Como comissão %, taxa fixa, custo fixo e frete podem mudar por faixa de
   * preço/peso, resolve por iteração de ponto fixo. A cada passo recalcula as
   * tarifas no preço corrente e fecha a equação linearmente.
   */
  function precoParaMeta(mp, params) {
    const impostoRate = params.impostoRate || 0;
    const custo = params.custo || 0;
    const extras = params.custosExtras || 0;

    let precoVenda = custo > 0 ? custo * 2 : 100;

    for (let i = 0; i < 80; i++) {
      const { comissaoRate, taxaFixa } = tarifasMarketplace(mp, params, precoVenda);
      const frete = calcularFrete(mp, params, precoVenda);
      const custosFixos = custo + extras + taxaFixa + frete;

      let novoPreco;
      if (params.metaTipo === "margem") {
        const m = params.metaValor; // fração
        const denom = 1 - comissaoRate - impostoRate - m;
        if (denom <= 0) return { erro: "Meta inviável: comissão + imposto + margem ≥ 100%." };
        novoPreco = custosFixos / denom;
      } else {
        const lucro = params.metaValor; // R$
        const denom = 1 - comissaoRate - impostoRate;
        if (denom <= 0) return { erro: "Comissão + imposto ≥ 100%; impossível ter lucro." };
        novoPreco = (custosFixos + lucro) / denom;
      }

      if (Math.abs(novoPreco - precoVenda) < 0.005) {
        precoVenda = novoPreco;
        break;
      }
      precoVenda = novoPreco;
    }

    const detalhe = decompor(mp, params, precoVenda);

    const desconto = params.desconto || 0;
    const cupom = params.cupom || 0;
    const fator = (1 - desconto) * (1 - cupom);
    const precoAnunciado = fator > 0 ? precoVenda / fator : precoVenda;

    return {
      ...detalhe,
      precoAnunciado,
      precoVenda,
      desconto,
      cupom,
      fatorDesconto: fator,
    };
  }

  /** Calcula para todos os marketplaces selecionados e ordena por lucro. */
  function calcularTodos(marketplaces, idsSelecionados, params, modo) {
    const resultados = [];
    for (const id of idsSelecionados) {
      const mp = marketplaces[id];
      if (!mp) continue;
      const r = modo === "reverso" ? precoParaMeta(mp, params) : calcularLucro(mp, params);
      resultados.push({ marketplace: mp, resultado: r });
    }
    resultados.sort((a, b) => {
      const la = a.resultado.lucro ?? -Infinity;
      const lb = b.resultado.lucro ?? -Infinity;
      return lb - la;
    });
    return resultados;
  }

  return { MARKETPLACES, CATEGORIAS_GLOBAIS, TAMANHOS, FRETE_PADRAO,
    freteParaPeso, faixaPara, tarifasMarketplace, calcularFrete,
    decompor, calcularLucro, precoParaMeta, calcularTodos };
}));
