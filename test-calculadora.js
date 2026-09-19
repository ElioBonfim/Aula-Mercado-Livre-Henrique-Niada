/*
 * test-calculadora.js — bateria de testes do motor da calculadora de margem.
 * Veio junto com o motor (calculadora do Henrique Niada) e roda igual: `node test-calculadora.js`.
 * Sem dependências. Cada teste imprime PASS/FAIL e no final o resumo.
 */
'use strict';
const calc = require('./public/calculo-margem.js');
const { MARKETPLACES } = calc;

let pass = 0, fail = 0;
const falhas = [];

function ok(cond, nome, extra) {
  if (cond) { pass++; /* console.log("  ✅", nome); */ }
  else { fail++; falhas.push(nome + (extra ? " → " + extra : "")); console.log("  ❌", nome, extra || ""); }
}
function aprox(a, b, tol = 0.02) { return Math.abs(a - b) <= tol; }

// Params base reutilizável
function P(over = {}) {
  return {
    custo: 0, custosExtras: 0, categoria: "casa", pesoKg: 0.5, acrescimoTamanho: 0,
    impostoRate: 0, tipoAnuncio: "classico", ...over,
  };
}

console.log("\n──────── 1. SHOPEE: faixas de comissão 2026 ────────");
{
  const casos = [
    { p: 5, com: 0.5, fix: 0 },
    { p: 7.99, com: 0.5, fix: 0 },
    { p: 8, com: 0.5, fix: 0 },       // limite: <=8 cai na 1ª faixa
    { p: 8.01, com: 0.2, fix: 4 },
    { p: 50, com: 0.2, fix: 4 },
    { p: 79.99, com: 0.2, fix: 4 },
    { p: 80, com: 0.2, fix: 4 },      // <=80 ainda 2ª faixa
    { p: 80.01, com: 0.14, fix: 16 },
    { p: 99.99, com: 0.14, fix: 16 },
    { p: 150, com: 0.14, fix: 20 },
    { p: 199.99, com: 0.14, fix: 20 },
    { p: 200, com: 0.14, fix: 20 },
    { p: 200.01, com: 0.14, fix: 26 },
    { p: 5000, com: 0.14, fix: 26 },
  ];
  for (const c of casos) {
    const r = calc.calcularLucro(MARKETPLACES.shopee, P({ precoVenda: c.p }));
    ok(aprox(r.comissaoRate, c.com, 0.0001) && aprox(r.taxaFixaMp, c.fix),
      `Shopee P=${c.p}: comissão ${(c.com*100)}% + fixo R$${c.fix}`,
      `obteve ${(r.comissaoRate*100).toFixed(0)}% + R$${r.taxaFixaMp}`);
  }
}

console.log("\n──────── 2. SHOPEE: sem teto de R$100 (mudança 2026) ────────");
{
  const r = calc.calcularLucro(MARKETPLACES.shopee, P({ precoVenda: 1000 }));
  ok(aprox(r.comissaoValor, 140), "Shopee P=1000 comissão = R$140 (sem teto)", `obteve R$${r.comissaoValor.toFixed(2)}`);
  const r2 = calc.calcularLucro(MARKETPLACES.shopee, P({ precoVenda: 2000 }));
  ok(r2.comissaoValor > 100, "Shopee P=2000 comissão > R$100 (teto removido)", `obteve R$${r2.comissaoValor.toFixed(2)}`);
}

console.log("\n──────── 3. SHOPEE: adicional CPF alto volume (+R$3) ────────");
{
  const cnpj = calc.calcularLucro(MARKETPLACES.shopee, P({ precoVenda: 90 }));
  const cpf = calc.calcularLucro(MARKETPLACES.shopee, P({ precoVenda: 90, shopeeCpfAlto: true }));
  ok(aprox(cnpj.taxaFixaMp, 16), "Shopee CNPJ P=90 fixo = R$16", `obteve R$${cnpj.taxaFixaMp}`);
  ok(aprox(cpf.taxaFixaMp, 19), "Shopee CPF-alto P=90 fixo = R$19 (16+3)", `obteve R$${cpf.taxaFixaMp}`);
}

console.log("\n──────── 4. MERCADO LIVRE: clássico vs premium ────────");
{
  const casos = [
    { cat: "eletronicos", cl: 0.11, pr: 0.16 },
    { cat: "casa", cl: 0.12, pr: 0.17 },
    { cat: "moda", cl: 0.14, pr: 0.19 },
    { cat: "beleza", cl: 0.13, pr: 0.18 },
  ];
  for (const c of casos) {
    const cl = calc.calcularLucro(MARKETPLACES.mercadolivre, P({ categoria: c.cat, tipoAnuncio: "classico", precoVenda: 120 }));
    const pr = calc.calcularLucro(MARKETPLACES.mercadolivre, P({ categoria: c.cat, tipoAnuncio: "premium", precoVenda: 120 }));
    ok(aprox(cl.comissaoRate, c.cl, 0.0001), `ML ${c.cat} clássico = ${(c.cl*100)}%`, `obteve ${(cl.comissaoRate*100).toFixed(1)}%`);
    ok(aprox(pr.comissaoRate, c.pr, 0.0001), `ML ${c.cat} premium = ${(c.pr*100)}%`, `obteve ${(pr.comissaoRate*100).toFixed(1)}%`);
  }
}

console.log("\n──────── 5. MERCADO LIVRE: custo fixo < R$79 ────────");
{
  const casos = [
    { p: 10, esperado: 5, desc: "50% do valor (P<=12,50)" },
    { p: 12.5, esperado: 6.25, desc: "R$6,25 (<=12,50 é limite p/ pct... na verdade cai em pct=50%→6.25)" },
    { p: 20, esperado: 6.25, desc: "R$6,25 (12,50–29)" },
    { p: 40, esperado: 6.5, desc: "R$6,50 (29–50)" },
    { p: 70, esperado: 6.75, desc: "R$6,75 (50–79)" },
    { p: 100, esperado: 0, desc: "sem custo fixo (>79)" },
  ];
  for (const c of casos) {
    const r = calc.calcularLucro(MARKETPLACES.mercadolivre, P({ precoVenda: c.p }));
    ok(aprox(r.taxaFixaMp, c.esperado), `ML P=${c.p} custo fixo = R$${c.esperado} (${c.desc})`, `obteve R$${r.taxaFixaMp.toFixed(2)}`);
  }
}

console.log("\n──────── 6. MERCADO LIVRE: frete grátis obrigatório > R$79 ────────");
{
  const abaixo = calc.calcularLucro(MARKETPLACES.mercadolivre, P({ precoVenda: 50, pesoKg: 0.5 }));
  const acima = calc.calcularLucro(MARKETPLACES.mercadolivre, P({ precoVenda: 120, pesoKg: 0.5 }));
  ok(aprox(abaixo.frete, 0), "ML P=50 frete = R$0 (comprador paga)", `obteve R$${abaixo.frete}`);
  ok(acima.frete > 0, "ML P=120 frete > R$0 (seller paga)", `obteve R$${acima.frete}`);
  // tamanho volumoso soma acréscimo
  const vol = calc.calcularLucro(MARKETPLACES.mercadolivre, P({ precoVenda: 120, pesoKg: 0.5, acrescimoTamanho: 15 }));
  ok(aprox(vol.frete, acima.frete + 15), "ML frete + acréscimo de tamanho", `obteve R$${vol.frete}`);
}

console.log("\n──────── 7. Identidade contábil: soma dos custos = preço − lucro ────────");
{
  for (const id of Object.keys(MARKETPLACES)) {
    const r = calc.calcularLucro(MARKETPLACES[id], P({ custo: 45.9, custosExtras: 2.5, impostoRate: 0.06, precoVenda: 150 }));
    const soma = r.custo + r.extras + r.comissaoValor + r.imposto + r.taxaFixaMp + r.frete;
    ok(aprox(soma, r.totalCustos) && aprox(r.lucro, 150 - r.totalCustos) && aprox(r.margem, r.lucro / 150),
      `${id}: identidade custos/lucro/margem`, `soma=${soma.toFixed(2)} total=${r.totalCustos.toFixed(2)} lucro=${r.lucro.toFixed(2)}`);
  }
}

console.log("\n──────── 8. Modo REVERSO: margem-alvo é atingida (todos MPs) ────────");
{
  for (const id of Object.keys(MARKETPLACES)) {
    for (const meta of [0.10, 0.20, 0.30]) {
      const params = P({ custo: 45.9, custosExtras: 2.5, impostoRate: 0.06, metaTipo: "margem", metaValor: meta, desconto: 0.1, cupom: 0.05 });
      const r = calc.precoParaMeta(MARKETPLACES[id], params);
      if (r.erro) { ok(false, `${id} reverso margem ${meta*100}%`, r.erro); continue; }
      const chk = calc.decompor(MARKETPLACES[id], params, r.precoVenda);
      // tolerância 0,7 p.p. por causa dos degraus de faixa
      ok(aprox(chk.margem, meta, 0.007), `${id} reverso margem ${(meta*100)}% atingida`, `real ${(chk.margem*100).toFixed(2)}%`);
    }
  }
}

console.log("\n──────── 9. Modo REVERSO: relação anúncio × desconto × cupom ────────");
{
  const params = P({ custo: 45.9, impostoRate: 0.06, metaTipo: "margem", metaValor: 0.2, desconto: 0.15, cupom: 0.1 });
  const r = calc.precoParaMeta(MARKETPLACES.amazon, params);
  const esperadoVenda = r.precoAnunciado * (1 - 0.15) * (1 - 0.10);
  ok(aprox(r.precoVenda, esperadoVenda, 0.05), "preçoVenda = anunciado×(1−desc)×(1−cupom)", `venda=${r.precoVenda.toFixed(2)} esperado=${esperadoVenda.toFixed(2)}`);
  const semDesc = calc.precoParaMeta(MARKETPLACES.amazon, P({ ...params, desconto: 0, cupom: 0 }));
  ok(aprox(semDesc.precoAnunciado, semDesc.precoVenda), "sem desconto: anunciado = venda", `anun=${semDesc.precoAnunciado.toFixed(2)} venda=${semDesc.precoVenda.toFixed(2)}`);
}

console.log("\n──────── 10. Modo REVERSO: lucro fixo em R$ ────────");
{
  for (const id of Object.keys(MARKETPLACES)) {
    const params = P({ custo: 30, custosExtras: 2, impostoRate: 0.06, metaTipo: "lucro", metaValor: 25 });
    const r = calc.precoParaMeta(MARKETPLACES[id], params);
    if (r.erro) { ok(false, `${id} lucro fixo R$25`, r.erro); continue; }
    const chk = calc.decompor(MARKETPLACES[id], params, r.precoVenda);
    ok(aprox(chk.lucro, 25, 0.05), `${id} lucro fixo = R$25`, `real R$${chk.lucro.toFixed(2)}`);
  }
}

console.log("\n──────── 11. Casos-limite / robustez ────────");
{
  // meta impossível: comissão 20% (shopee <80) + imposto 10% + margem 75% = 105%
  const imp = calc.precoParaMeta(MARKETPLACES.shopee, P({ custo: 10, impostoRate: 0.10, metaTipo: "margem", metaValor: 0.75, precoVenda: 50 }));
  ok(imp.erro != null, "meta inviável retorna erro (não NaN)", JSON.stringify(imp).slice(0, 60));

  // custo zero não quebra markup
  const z = calc.calcularLucro(MARKETPLACES.amazon, P({ custo: 0, precoVenda: 100 }));
  ok(Number.isFinite(z.margem) && z.markup === 0, "custo zero: margem finita, markup 0", `markup=${z.markup}`);

  // preço zero não gera divisão por zero
  const zz = calc.calcularLucro(MARKETPLACES.amazon, P({ custo: 0, precoVenda: 0 }));
  ok(zz.margem === 0, "preço zero: margem 0 (sem divisão por zero)", `margem=${zz.margem}`);

  // override manual de comissão tem prioridade
  const ov = calc.calcularLucro(MARKETPLACES.shopee, P({ precoVenda: 100, overrideComissao: 0.05 }));
  ok(aprox(ov.comissaoRate, 0.05), "override de comissão substitui a faixa", `obteve ${(ov.comissaoRate*100)}%`);

  const custosReais = calc.calcularLucro(MARKETPLACES.mercadolivre, P({
    precoVenda: 100,
    overrideComissao: 0.123,
    overrideTaxaFixa: 7.89,
    overrideFrete: 11.22,
  }));
  ok(aprox(custosReais.comissaoValor, 12.3), "override real de comissão em valor");
  ok(aprox(custosReais.taxaFixaMp, 7.89), "override real de taxa fixa");
  ok(aprox(custosReais.frete, 11.22), "override real de frete");
}

console.log("\n──────── 12. SHEIN: regras vigentes em 2026 ────────");
{
  const moda = calc.calcularLucro(MARKETPLACES.shein, P({ categoria: "moda", precoVenda: 100 }));
  const outras = calc.calcularLucro(MARKETPLACES.shein, P({ categoria: "casa", precoVenda: 100 }));
  ok(aprox(moda.comissaoRate, 0.20), "SHEIN moda = 20%", `obteve ${moda.comissaoRate * 100}%`);
  ok(aprox(outras.comissaoRate, 0.18), "SHEIN demais categorias = 18%", `obteve ${outras.comissaoRate * 100}%`);
}

console.log("\n──────── 13. Amazon: parcelamento sem juros 2026 ────────");
{
  const abaixo = calc.calcularLucro(MARKETPLACES.amazon, P({ categoria: "casa", precoVenda: 39.99 }));
  const acima = calc.calcularLucro(MARKETPLACES.amazon, P({ categoria: "casa", precoVenda: 40 }));
  ok(aprox(abaixo.comissaoRate, 0.12), "Amazon abaixo de R$40 sem adicional de parcelamento");
  ok(aprox(acima.comissaoRate, 0.135), "Amazon a partir de R$40 inclui 1,5% do parcelamento");
}

console.log("\n════════════════════════════════════════════");
console.log(`RESULTADO: ${pass} passaram, ${fail} falharam`);
if (fail > 0) { console.log("\nFALHAS:"); falhas.forEach((f) => console.log("  -", f)); }
console.log(fail === 0 ? "\n✅ TUDO CERTO — todos os cálculos conferem." : "\n❌ Há falhas a corrigir.");
process.exit(fail === 0 ? 0 : 1);
