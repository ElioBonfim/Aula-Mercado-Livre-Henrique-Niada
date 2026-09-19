'use strict';
// Banco SQLite (node:sqlite, nativo do Node 22.5+). Guarda contas do Mercado Livre,
// produtos publicados e notificações de webhook.
//
// Tokens vão CIFRADOS (AES-256-GCM) com a chave de ML_DB_KEY. São credenciais de
// vendedores reais num servidor exposto à internet — o arquivo do banco vaza em
// backup, snapshot de volume ou cópia errada, e sem cifra isso entrega as contas.
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

// Relativo à pasta do projeto, não à pasta de onde o comando foi rodado.
const DB_FILE = path.resolve(__dirname, process.env.ML_DB_FILE || 'dados.sqlite');
const CHAVE = process.env.ML_DB_KEY
  ? crypto.createHash('sha256').update(process.env.ML_DB_KEY).digest()
  : null;

if (!CHAVE) {
  console.warn('[db] ML_DB_KEY não definida — tokens serão gravados EM CLARO. '
    + 'Gere uma com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}

function cifrar(txt) {
  if (txt == null) return null;
  if (!CHAVE) return String(txt);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', CHAVE, iv);
  const ct = Buffer.concat([c.update(String(txt), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}
function decifrar(txt) {
  if (txt == null) return null;
  if (!String(txt).startsWith('v1:')) return String(txt); // gravado antes da chave existir
  if (!CHAVE) throw new Error('Banco tem tokens cifrados mas ML_DB_KEY não está definida.');
  const [, iv, tag, ct] = String(txt).split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', CHAVE, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

const db = new DatabaseSync(DB_FILE);
try { fs.chmodSync(DB_FILE, 0o600); } catch {}
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS contas (
    ml_user_id    INTEGER PRIMARY KEY,
    nickname      TEXT,
    site_id       TEXT,
    access_token  TEXT NOT NULL,
    refresh_token TEXT,
    expires_at    INTEGER NOT NULL,
    scope         TEXT,
    conectada_em  TEXT NOT NULL,
    atualizada_em TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS estado (
    chave TEXT PRIMARY KEY,
    valor TEXT
  );
  CREATE TABLE IF NOT EXISTS produtos (
    item_id     TEXT PRIMARY KEY,
    ml_user_id  INTEGER NOT NULL,
    title       TEXT,
    category_id TEXT,
    price       REAL,
    quantidade  INTEGER,
    status      TEXT,
    permalink   TEXT,
    payload     TEXT,
    criado_em   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_produtos_conta ON produtos(ml_user_id, criado_em DESC);
  CREATE TABLE IF NOT EXISTS notificacoes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    recebida_em    TEXT NOT NULL,
    topic          TEXT,
    resource       TEXT,
    ml_user_id     INTEGER,
    application_id TEXT,
    attempts       INTEGER,
    payload        TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notif_conta ON notificacoes(ml_user_id, id DESC);
`);

const agora = () => new Date().toISOString();

// ---------- contas ----------
function contaSalvar(tokens, perfil) {
  const id = perfil.id;
  db.prepare(`
    INSERT INTO contas (ml_user_id, nickname, site_id, access_token, refresh_token,
                        expires_at, scope, conectada_em, atualizada_em)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(ml_user_id) DO UPDATE SET
      nickname=excluded.nickname, site_id=excluded.site_id,
      access_token=excluded.access_token, refresh_token=excluded.refresh_token,
      expires_at=excluded.expires_at, scope=excluded.scope,
      atualizada_em=excluded.atualizada_em
  `).run(id, perfil.nickname || null, perfil.site_id || null,
    cifrar(tokens.access_token), cifrar(tokens.refresh_token),
    Date.now() + (tokens.expires_in - 60) * 1000, tokens.scope || null, agora(), agora());
  if (!contaAtivaId()) contaAtivaDefinir(id);
  return id;
}

function contaTokensAtualizar(id, tokens) {
  db.prepare(`UPDATE contas SET access_token=?, refresh_token=?, expires_at=?, atualizada_em=?
              WHERE ml_user_id=?`)
    .run(cifrar(tokens.access_token), cifrar(tokens.refresh_token),
      Date.now() + (tokens.expires_in - 60) * 1000, agora(), id);
}

function contaObter(id) {
  const c = db.prepare('SELECT * FROM contas WHERE ml_user_id = ?').get(id);
  if (!c) return null;
  return { ...c, access_token: decifrar(c.access_token), refresh_token: decifrar(c.refresh_token) };
}

// Nunca devolve token — é o que vai para o browser.
function contasListar() {
  return db.prepare(`SELECT ml_user_id, nickname, site_id, expires_at, conectada_em,
                            (SELECT COUNT(*) FROM produtos p WHERE p.ml_user_id = c.ml_user_id) AS produtos
                     FROM contas c ORDER BY conectada_em`).all();
}

const contaAtivaId = () =>
  db.prepare("SELECT valor FROM estado WHERE chave='conta_ativa'").get()?.valor ?? null;

function contaAtivaDefinir(id) {
  if (id !== null && !db.prepare('SELECT 1 FROM contas WHERE ml_user_id=?').get(id)) {
    throw Object.assign(new Error('conta não conectada'), { status: 404 });
  }
  db.prepare(`INSERT INTO estado (chave, valor) VALUES ('conta_ativa', ?)
              ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor`).run(id === null ? null : String(id));
}

const contaAtiva = () => { const id = contaAtivaId(); return id ? contaObter(Number(id)) : null; };

function contaRemover(id) {
  db.prepare('DELETE FROM contas WHERE ml_user_id=?').run(id);
  if (String(contaAtivaId()) === String(id)) {
    contaAtivaDefinir(db.prepare('SELECT ml_user_id FROM contas LIMIT 1').get()?.ml_user_id ?? null);
  }
}

// ---------- produtos ----------
function produtoSalvar(mlUserId, item, payload) {
  db.prepare(`INSERT INTO produtos (item_id, ml_user_id, title, category_id, price, quantidade,
                                    status, permalink, payload, criado_em)
              VALUES (?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(item_id) DO UPDATE SET status=excluded.status, price=excluded.price,
                                                 quantidade=excluded.quantidade`)
    .run(item.id, mlUserId, payload.title, payload.category_id, payload.price,
      payload.available_quantity, item.status || null, item.permalink || null,
      JSON.stringify(payload), agora());
}
const produtosListar = (mlUserId, limite = 50) =>
  db.prepare(`SELECT item_id, title, price, quantidade, status, permalink, criado_em
              FROM produtos WHERE ml_user_id=? ORDER BY criado_em DESC LIMIT ?`).all(mlUserId, limite);


// Espelha o anúncio como o ML o devolve (listagem/edição), sem exigir o payload de criação.
function produtoSincronizar(mlUserId, it) {
  db.prepare(`INSERT INTO produtos (item_id, ml_user_id, title, category_id, price, quantidade,
                                    status, permalink, payload, criado_em)
              VALUES (?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(item_id) DO UPDATE SET
                title=excluded.title, category_id=excluded.category_id, price=excluded.price,
                quantidade=excluded.quantidade, status=excluded.status, permalink=excluded.permalink,
                payload=excluded.payload`)
    .run(it.id, mlUserId, it.title ?? null, it.category_id ?? null,
      it.price ?? null, it.available_quantity ?? null, it.status ?? null,
      it.permalink ?? null, JSON.stringify(it), agora());
}

// ---------- notificações ----------
function notificacaoSalvar(nota, cru) {
  db.prepare(`INSERT INTO notificacoes (recebida_em, topic, resource, ml_user_id,
                                        application_id, attempts, payload)
              VALUES (?,?,?,?,?,?,?)`)
    .run(agora(), nota?.topic ?? null, nota?.resource ?? null,
      Number.isInteger(nota?.user_id) ? nota.user_id : null,
      nota?.application_id != null ? String(nota.application_id) : null,
      Number.isInteger(nota?.attempts) ? nota.attempts : null, cru.slice(0, 20000));
}
const notificacoesListar = (limite = 50) =>
  db.prepare(`SELECT id, recebida_em, topic, resource, ml_user_id, attempts
              FROM notificacoes ORDER BY id DESC LIMIT ?`).all(limite);


// ---------- palavras-chave e posição na listagem ----------
// A posição não vem da API oficial (o /sites/search responde 403): quem mede é o
// scraper local. Guardamos histórico para dar para ver se o anúncio sobe ou desce.
db.exec(`
  CREATE TABLE IF NOT EXISTS palavras (
    item_id    TEXT NOT NULL,
    ml_user_id INTEGER NOT NULL,
    termo      TEXT NOT NULL,
    criada_em  TEXT NOT NULL,
    PRIMARY KEY (item_id, termo)
  );
  CREATE TABLE IF NOT EXISTS posicoes (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id            TEXT NOT NULL,
    termo              TEXT NOT NULL,
    medida_em          TEXT NOT NULL,
    posicao            INTEGER,
    patrocinados_acima INTEGER,
    total              INTEGER,
    preco              REAL,
    vizinhos           TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_posicoes ON posicoes(item_id, termo, id DESC);
`);

// Versão da medição. v1 (até 18/09/2026) contava a posição a partir de 0, incluía banners
// e às vezes lia preço/posição do anúncio vizinho. Fica gravada para auditoria, mas não
// entra na tela nem na variação: comparar v1 com v2 mostraria um "caiu" que não houve.
const VERSAO_POSICAO = 2;
const colunasPosicoes = db.prepare('PRAGMA table_info(posicoes)').all().map((c) => c.name);
if (!colunasPosicoes.includes('versao')) {
  db.exec('ALTER TABLE posicoes ADD COLUMN versao INTEGER NOT NULL DEFAULT 1');
}
// Outros anúncios do mesmo vendedor que apareceram na busca. O ML costuma mostrar só um
// anúncio por vendedor para o mesmo produto: sem isto, "não encontrado" parecia defeito.
if (!colunasPosicoes.includes('meus')) db.exec('ALTER TABLE posicoes ADD COLUMN meus TEXT');
// A lista inteira da busca (~60 anúncios de todos os vendedores, ~25 KB), para comparar
// preço e posição com qualquer concorrente, não só com os vizinhos.
if (!colunasPosicoes.includes('lista')) db.exec('ALTER TABLE posicoes ADD COLUMN lista TEXT');

const palavraAdicionar = (itemId, mlUserId, termo) =>
  db.prepare(`INSERT INTO palavras (item_id, ml_user_id, termo, criada_em) VALUES (?,?,?,?)
              ON CONFLICT(item_id, termo) DO NOTHING`).run(itemId, mlUserId, termo, agora());

const palavraRemover = (itemId, termo) =>
  db.prepare('DELETE FROM palavras WHERE item_id=? AND termo=?').run(itemId, termo);

// Cada termo já vem com a última medição e a anterior, para mostrar a variação.
function palavrasListar(itemId) {
  return db.prepare('SELECT termo FROM palavras WHERE item_id=? ORDER BY criada_em').all(itemId)
    .map(({ termo }) => {
      const hist = db.prepare(`SELECT posicao, patrocinados_acima, total, medida_em, vizinhos, meus, lista
                               FROM posicoes WHERE item_id=? AND termo=? AND versao=?
                               ORDER BY id DESC LIMIT 2`)
        .all(itemId, termo, VERSAO_POSICAO);
      const [atual, anterior] = hist;
      return {
        termo,
        posicao: atual?.posicao ?? null,
        patrocinados_acima: atual?.patrocinados_acima ?? null,
        total: atual?.total ?? null,
        medida_em: atual?.medida_em ?? null,
        // negativo = subiu na listagem (posição menor é melhor)
        variacao: atual?.posicao != null && anterior?.posicao != null
          ? atual.posicao - anterior.posicao : null,
        vizinhos: atual?.vizinhos ? JSON.parse(atual.vizinhos) : [],
        meus: atual?.meus ? JSON.parse(atual.meus) : null,  // null = não foi possível checar
        lista: atual?.lista ? JSON.parse(atual.lista) : null, // null = medição anterior à lista
      };
    });
}

const posicaoSalvar = (itemId, termo, r) =>
  db.prepare(`INSERT INTO posicoes (item_id, termo, medida_em, posicao, patrocinados_acima,
                                    total, preco, vizinhos, versao, meus, lista)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(itemId, termo, agora(), r.posicao ?? null, r.patrocinados_acima ?? null,
      r.total_na_pagina ?? null, r.preco ?? null, JSON.stringify(r.vizinhos || []), VERSAO_POSICAO,
      r.meus ? JSON.stringify(r.meus) : null, r.lista ? JSON.stringify(r.lista) : null);

const posicoesHistorico = (itemId, termo, limite = 30) =>
  db.prepare(`SELECT medida_em, posicao FROM posicoes WHERE item_id=? AND termo=? AND versao=?
              ORDER BY id DESC LIMIT ?`).all(itemId, termo, VERSAO_POSICAO, limite).reverse();

// ---------- custos, vendas e frete (lucro real) ----------
// custos: o que só o vendedor sabe (quanto pagou no produto). Por unidade.
// vendas: cópia local das linhas de pedido. Uma conta real tinha 11 mil pedidos em 150 dias;
//   buscar tudo a cada tela custaria ~220 chamadas ao ML. Aqui o período vira SQL.
// fretes: o custo de envio que o ML cobrou do vendedor, por envio. Não muda depois do
//   envio, então fica guardado e cada envio é consultado uma vez só.
db.exec(`
  CREATE TABLE IF NOT EXISTS custos (
    item_id       TEXT PRIMARY KEY,
    ml_user_id    INTEGER NOT NULL,
    custo         REAL,
    outros        REAL,
    atualizado_em TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS vendas (
    order_id    INTEGER NOT NULL,
    item_id     TEXT NOT NULL,
    variacao    INTEGER NOT NULL DEFAULT 0,
    ml_user_id  INTEGER NOT NULL,
    data        TEXT NOT NULL,
    status      TEXT,
    quantidade  INTEGER NOT NULL,
    preco_unit  REAL NOT NULL,
    tarifa_unit REAL,
    envio_id    INTEGER,
    PRIMARY KEY (order_id, item_id, variacao)
  );
  CREATE INDEX IF NOT EXISTS idx_vendas_conta_data ON vendas(ml_user_id, data);
  CREATE INDEX IF NOT EXISTS idx_vendas_item_data ON vendas(item_id, data);
  CREATE TABLE IF NOT EXISTS fretes (
    envio_id   INTEGER PRIMARY KEY,
    ml_user_id INTEGER NOT NULL,
    custo      REAL NOT NULL,
    medido_em  TEXT NOT NULL
  );
`);

function custoGravar(mlUserId, itemId, { custo, outros }) {
  db.prepare(`INSERT INTO custos (item_id, ml_user_id, custo, outros, atualizado_em) VALUES (?,?,?,?,?)
              ON CONFLICT(item_id) DO UPDATE SET custo=excluded.custo, outros=excluded.outros,
                                                 atualizado_em=excluded.atualizado_em`)
    .run(itemId, mlUserId, custo ?? null, outros ?? null, agora());
}
const custoObter = (itemId) =>
  db.prepare('SELECT custo, outros, atualizado_em FROM custos WHERE item_id=?').get(itemId) ?? null;
function custosDe(ids) {
  if (!ids.length) return {};
  return Object.fromEntries(db.prepare(`SELECT item_id, custo, outros FROM custos
                                        WHERE item_id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids).map((r) => [r.item_id, { custo: r.custo, outros: r.outros }]));
}

// Imposto é da empresa (Simples, Lucro Presumido…), não do anúncio: um valor por conta.
const impostoLer = (mlUserId) => {
  const v = configLer(`imposto_pct:${mlUserId}`);
  return v == null ? null : Number(v);
};
const impostoGravar = (mlUserId, pct) => configGravar(`imposto_pct:${mlUserId}`, pct == null ? null : String(pct));

// Pedido cancelado ou inválido não é venda; "confirmed" ainda não foi pago (e é também
// como a API mostra a venda que o vendedor marcou como não concretizada).
const STATUS_VENDA = ['paid', 'partially_refunded'];
const EM_VENDA = `status IN (${STATUS_VENDA.map((s) => `'${s}'`).join(',')})`;

function vendasGravar(linhas) {
  const st = db.prepare(`INSERT INTO vendas (order_id, item_id, variacao, ml_user_id, data, status,
                                             quantidade, preco_unit, tarifa_unit, envio_id)
                         VALUES (?,?,?,?,?,?,?,?,?,?)
                         ON CONFLICT(order_id, item_id, variacao) DO UPDATE SET
                           status=excluded.status, quantidade=excluded.quantidade,
                           preco_unit=excluded.preco_unit, tarifa_unit=excluded.tarifa_unit,
                           envio_id=excluded.envio_id`);
  db.exec('BEGIN');
  try {
    for (const l of linhas) {
      st.run(l.order_id, l.item_id, l.variacao || 0, l.ml_user_id, l.data, l.status ?? null,
        l.quantidade, l.preco_unit, l.tarifa_unit ?? null, l.envio_id ?? null);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Um resumo por anúncio da conta na janela j = { de, meio, ate } (ISO, ate exclusivo).
// `meio` separa as duas metades para a tendência — a mesma conta que ordena "maiores
// quedas" e pinta o selo na listagem.
const vendasResumo = (mlUserId, j) =>
  db.prepare(`SELECT item_id,
                     SUM(quantidade) AS unidades,
                     COUNT(DISTINCT order_id) AS pedidos,
                     SUM(quantidade * preco_unit) AS faturamento,
                     SUM(quantidade * COALESCE(tarifa_unit, 0)) AS tarifas,
                     COUNT(DISTINCT envio_id) AS envios,
                     SUM(CASE WHEN data < ? THEN quantidade ELSE 0 END) AS antes,
                     SUM(CASE WHEN data >= ? THEN quantidade ELSE 0 END) AS depois
              FROM vendas WHERE ml_user_id=? AND data >= ? AND data < ? AND ${EM_VENDA}
              GROUP BY item_id`).all(j.meio, j.meio, mlUserId, j.de, j.ate);

// Unidades por linha de pedido, para montar a série diária de alguns anúncios.
function vendasDiarias(ids, j) {
  if (!ids.length) return [];
  return db.prepare(`SELECT item_id, data, quantidade FROM vendas
                     WHERE item_id IN (${ids.map(() => '?').join(',')}) AND data >= ? AND data < ?
                       AND ${EM_VENDA}`)
    .all(...ids, j.de, j.ate);
}

const vendasUltimas = (itemId, limite = 5) =>
  db.prepare(`SELECT order_id, data, status, SUM(quantidade) AS quantidade,
                     SUM(quantidade * preco_unit) AS total
              FROM vendas WHERE item_id=? GROUP BY order_id ORDER BY data DESC LIMIT ?`).all(itemId, limite);

// Envios recentes do anúncio cujo frete ainda não foi consultado.
const enviosSemFrete = (itemId, j, limite) =>
  db.prepare(`SELECT v.envio_id, MAX(v.data) AS data FROM vendas v
              LEFT JOIN fretes f ON f.envio_id = v.envio_id
              WHERE v.item_id=? AND v.data >= ? AND v.data < ? AND v.envio_id IS NOT NULL
                AND f.envio_id IS NULL AND v.${EM_VENDA}
              GROUP BY v.envio_id ORDER BY data DESC LIMIT ?`).all(itemId, j.de, j.ate, limite).map((r) => r.envio_id);

// Frete por UNIDADE nos envios do anúncio já consultados na janela: soma do frete ÷ soma
// das unidades. Medido numa conta real: o frete por envio ia de R$ 0 a R$ 253 conforme a
// quantidade no pedido (média de 7 un.) — a média por envio errava; por unidade, não.
const fretePorUnidade = (itemId, j) =>
  db.prepare(`SELECT SUM(f.custo) AS custo, SUM(u.qtd) AS unidades, COUNT(*) AS amostra
              FROM fretes f
              JOIN (SELECT envio_id, SUM(quantidade) AS qtd FROM vendas
                    WHERE item_id=? AND data >= ? AND data < ? AND envio_id IS NOT NULL AND ${EM_VENDA}
                    GROUP BY envio_id) u ON u.envio_id = f.envio_id`)
    .get(itemId, j.de, j.ate);

const freteGravar = (mlUserId, envioId, custo) =>
  db.prepare(`INSERT INTO fretes (envio_id, ml_user_id, custo, medido_em) VALUES (?,?,?,?)
              ON CONFLICT(envio_id) DO UPDATE SET custo=excluded.custo, medido_em=excluded.medido_em`)
    .run(envioId, mlUserId, custo, agora());

// ---------- configuração do painel (primeiro acesso) ----------
// O que antes vivia no .env e o aluno teria de editar à mão: senha do painel, App ID e
// chave secreta do DevCenter. Mora na tabela estado; o que é segredo vai cifrado.
const CONFIG_SECRETA = new Set(['ml_client_secret']);

function configLer(chave) {
  const v = db.prepare('SELECT valor FROM estado WHERE chave=?').get(chave)?.valor ?? null;
  return CONFIG_SECRETA.has(chave) ? decifrar(v) : v;
}

function configGravar(chave, valor) {
  const v = valor == null ? null : (CONFIG_SECRETA.has(chave) ? cifrar(String(valor)) : String(valor));
  db.prepare(`INSERT INTO estado (chave, valor) VALUES (?, ?)
              ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor`).run(chave, v);
}

// ---------- senha e sessões do painel ----------
// scrypt com sal: o banco vazado não entrega a senha. A sessão é um token aleatório
// guardado só como hash — dá para revogar (sair, trocar senha), o que um cookie
// derivado da senha não permitia.
db.exec(`
  CREATE TABLE IF NOT EXISTS sessoes (
    token_hash TEXT PRIMARY KEY,
    criada_em  TEXT NOT NULL,
    expira_em  INTEGER NOT NULL
  );
`);

function senhaDefinir(senha) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(senha), sal, 64);
  configGravar('painel_senha', `scrypt:${sal.toString('base64')}:${hash.toString('base64')}`);
  db.prepare('DELETE FROM sessoes').run(); // senha nova derruba quem estava logado
}

const senhaDefinida = () => !!configLer('painel_senha');

function senhaConfere(senha) {
  const [tipo, sal, hash] = String(configLer('painel_senha') || '').split(':');
  if (tipo !== 'scrypt' || !sal || !hash) return false;
  const esperado = Buffer.from(hash, 'base64');
  const obtido = crypto.scryptSync(String(senha), Buffer.from(sal, 'base64'), esperado.length);
  return crypto.timingSafeEqual(obtido, esperado);
}

const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const TOKEN = /^[a-f0-9]{64}$/;

function sessaoCriar(dias = 7) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessoes WHERE expira_em < ?').run(Date.now());
  db.prepare('INSERT INTO sessoes (token_hash, criada_em, expira_em) VALUES (?,?,?)')
    .run(hashToken(token), agora(), Date.now() + dias * 864e5);
  return token;
}

function sessaoValida(token) {
  if (!TOKEN.test(token || '')) return false;
  const s = db.prepare('SELECT expira_em FROM sessoes WHERE token_hash=?').get(hashToken(token));
  return !!s && s.expira_em > Date.now();
}

const sessaoEncerrar = (token) => {
  if (TOKEN.test(token || '')) db.prepare('DELETE FROM sessoes WHERE token_hash=?').run(hashToken(token));
};

// ---------- URL pública (túnel) ----------
// O túnel gratuito troca de endereço a cada reinício. Cada endereço fica registrado para
// o painel dizer "mudou de X para Y" — e para o aluno saber o que atualizar no DevCenter.
db.exec(`
  CREATE TABLE IF NOT EXISTS urls_publicas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    url         TEXT NOT NULL,
    provedor    TEXT,
    iniciada_em TEXT NOT NULL
  );
`);

const urlPublicaUltima = () =>
  db.prepare('SELECT url, provedor, iniciada_em FROM urls_publicas ORDER BY id DESC LIMIT 1').get() ?? null;

// Devolve a anterior para quem chama avisar da troca. Repetir a mesma URL não gera linha.
function urlPublicaRegistrar(url, provedor) {
  const ultima = urlPublicaUltima();
  if (ultima?.url === url) return { anterior: ultima.url, mudou: false };
  db.prepare('INSERT INTO urls_publicas (url, provedor, iniciada_em) VALUES (?,?,?)').run(url, provedor, agora());
  return { anterior: ultima?.url ?? null, mudou: !!ultima };
}

const urlsPublicasHistorico = (limite = 10) =>
  db.prepare('SELECT url, provedor, iniciada_em FROM urls_publicas ORDER BY id DESC LIMIT ?').all(limite);

module.exports = {
  db, DB_FILE, cifrar, decifrar,
  configLer, configGravar,
  senhaDefinir, senhaDefinida, senhaConfere, sessaoCriar, sessaoValida, sessaoEncerrar,
  urlPublicaRegistrar, urlPublicaUltima, urlsPublicasHistorico,
  contaSalvar, contaTokensAtualizar, contaObter, contasListar,
  contaAtiva, contaAtivaId, contaAtivaDefinir, contaRemover,
  produtoSalvar, produtoSincronizar, produtosListar,
  palavraAdicionar, palavraRemover, palavrasListar, posicaoSalvar, posicoesHistorico, notificacaoSalvar, notificacoesListar,
  custoGravar, custoObter, custosDe, impostoLer, impostoGravar, STATUS_VENDA,
  vendasGravar, vendasResumo, vendasDiarias, vendasUltimas, enviosSemFrete, fretePorUnidade, freteGravar,
};
