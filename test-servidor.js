'use strict';
// node test-servidor.js — sobe os dois servidores de verdade (portas aleatórias, banco
// temporário) e confere as fronteiras de segurança:
//   - a porta PÚBLICA (a que o túnel expõe) só responde /saude, /webhook e /callback;
//   - o painel só atende localhost e recusa POST vindo de outro site;
//   - o primeiro acesso cria a senha uma única vez;
//   - o state do OAuth é de uso único.
const path = require('node:path');
const os = require('node:os');
process.env.ML_DB_FILE = path.join(os.tmpdir(), `teste-srv-${process.pid}-${Date.now()}.sqlite`);
process.env.ML_DB_KEY = 'chave-de-teste-nao-usar-em-producao';
delete process.env.ML_CLIENT_ID;
delete process.env.ML_CLIENT_SECRET;
const assert = require('node:assert');
const http = require('node:http');
const S = require('./server.js');
const D = require('./db.js');

const TUNEL = 'https://teste-da-aula.trycloudflare.com';

function pedir(porta, caminho, { metodo = 'GET', headers = {}, corpo = null } = {}) {
  return new Promise((ok, falha) => {
    const req = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: metodo,
      headers: { Host: `localhost:${porta}`, ...headers } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, corpo: b }));
    });
    req.on('error', falha);
    if (corpo) req.write(corpo);
    req.end();
  });
}

(async () => {
  // Porta ocupada em qualquer pilha não pode parecer livre. Regressão real: um painel em
  // [::]:3100 passou por "livre" e a cópia da aula subiu por cima, em 127.0.0.1:3100.
  const net = require('node:net');
  const Pr = require('./processos.js');
  for (const host of [undefined, '127.0.0.1']) {
    const outro = net.createServer();
    await new Promise((ok) => outro.listen(0, host, ok));
    assert.strictEqual(await Pr.portaLivre(outro.address().port), false,
      `porta ocupada em ${host || 'todas as interfaces'} tem de contar como ocupada`);
    await new Promise((ok) => outro.close(ok));
  }

  const srv = await S.iniciar({
    porta: 0, portaPublica: 0,
    servicos: { tunel: () => ({ estado: 'online', provedor: 'cloudflared', url: TUNEL, verificado: true }), scraper: () => null },
  });
  const P = srv.porta, PUB = srv.portaPublica;
  const form = (o) => new URLSearchParams(o).toString();
  const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const ORIGEM = { Origin: `http://localhost:${P}` };
  let r;

  try {
    // ---------- porta pública ----------
    r = await pedir(PUB, '/saude');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(JSON.parse(r.corpo).app, 'aula-ml');
    for (const c of ['/api/accounts', '/api/config', '/configuracao.html', '/index.html', '/primeiro-acesso',
      '/login', '/auth', '/api/navegador', '/api/navegador/tela', '/aviso.js']) {
      r = await pedir(PUB, c);
      assert.strictEqual(r.status, 404, `a porta pública não pode servir ${c} (deu ${r.status})`);
    }
    r = await pedir(PUB, '/api/items', { metodo: 'POST', corpo: '{}' });
    assert.strictEqual(r.status, 404);

    r = await pedir(PUB, '/webhook', { metodo: 'POST', corpo: JSON.stringify({ topic: 'items', resource: '/items/MLB1' }) });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(D.notificacoesListar()[0].topic, 'items');
    r = await pedir(PUB, '/webhook', { metodo: 'POST', corpo: 'lixo' });
    assert.strictEqual(r.status, 200, 'webhook com lixo responde 200 (erro faz a ML desativar a URL)');

    r = await pedir(PUB, '/callback?code=TG-x&state=nao-existe');
    assert.strictEqual(r.status, 400);
    assert.match(r.corpo, /expirada ou desconhecida/);
    r = await pedir(PUB, '/callback?error=x&error_description=' + encodeURIComponent('<script>alert(1)</script>'));
    assert.ok(!r.corpo.includes('<script>alert'), 'o que vem na URL do retorno sai escapado');

    // ---------- painel: só localhost ----------
    r = await pedir(P, '/', { headers: { Host: 'site-malicioso.com' } });
    assert.strictEqual(r.status, 403, 'Host de fora = DNS rebinding');
    r = await pedir(P, '/api/ping');
    assert.strictEqual(JSON.parse(r.corpo).app, 'aula-ml');

    // ---------- primeiro acesso ----------
    r = await pedir(P, '/');
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, '/primeiro-acesso');
    r = await pedir(P, '/api/config');
    assert.strictEqual(r.status, 401);
    assert.strictEqual(JSON.parse(r.corpo).primeiro_acesso, true);
    r = await pedir(P, '/login');
    assert.strictEqual(r.headers.location, '/primeiro-acesso');

    const senha = form({ senha: 'senha-da-aula', confirmacao: 'senha-da-aula' });
    for (const [origem, site] of [['https://site-malicioso.com', 'cross-site'], ['null', undefined], ['null', 'cross-site']]) {
      const h = { ...FORM, Origin: origem, ...(site ? { 'Sec-Fetch-Site': site } : {}) };
      r = await pedir(P, '/primeiro-acesso', { metodo: 'POST', headers: h, corpo: senha });
      assert.strictEqual(r.status, 403, `outro site (Origin ${origem}, ${site}) não cria a senha do aluno`);
      assert.strictEqual(D.senhaDefinida(), false);
    }
    r = await pedir(P, '/primeiro-acesso');
    assert.strictEqual(r.headers['referrer-policy'], 'same-origin',
      'no-referrer faz o navegador mandar Origin: null no POST e trava o login');
    r = await pedir(P, '/primeiro-acesso', { metodo: 'POST', headers: { ...FORM, ...ORIGEM }, corpo: form({ senha: 'curta', confirmacao: 'curta' }) });
    assert.strictEqual(r.status, 400);
    r = await pedir(P, '/primeiro-acesso', { metodo: 'POST', headers: { ...FORM, ...ORIGEM }, corpo: form({ senha: 'senha-da-aula', confirmacao: 'outra-coisa' }) });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(D.senhaDefinida(), false);

    r = await pedir(P, '/primeiro-acesso', { metodo: 'POST', headers: { ...FORM, ...ORIGEM }, corpo: senha });
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, '/configuracao.html');
    const cookie = String(r.headers['set-cookie']).split(';')[0];
    assert.match(cookie, /^aula_ml_sess=[a-f0-9]{64}$/);
    assert.match(String(r.headers['set-cookie']), /HttpOnly/);
    const COOKIE = { Cookie: cookie };

    r = await pedir(P, '/primeiro-acesso');
    assert.strictEqual(r.headers.location, '/login', 'com senha criada, o primeiro acesso some');
    r = await pedir(P, '/primeiro-acesso', { metodo: 'POST', headers: { ...FORM, ...ORIGEM }, corpo: form({ senha: 'tomar-conta-1', confirmacao: 'tomar-conta-1' }) });
    assert.ok(D.senhaConfere('senha-da-aula'), 'ninguém refaz o primeiro acesso por cima');

    // ---------- configuração ----------
    r = await pedir(P, '/api/config', { headers: COOKIE });
    assert.strictEqual(r.status, 200);
    let c = JSON.parse(r.corpo);
    assert.strictEqual(c.tunel.url, TUNEL);
    assert.strictEqual(c.pendente, 'credenciais');
    assert.strictEqual(c.tem_credenciais, false);
    r = await pedir(P, '/api/config/resumo', { headers: COOKIE });
    assert.deepStrictEqual(JSON.parse(r.corpo).pendente, 'credenciais');

    r = await pedir(P, '/api/config/credenciais', { metodo: 'POST', headers: { ...COOKIE, ...ORIGEM }, corpo: JSON.stringify({ app_id: 'abc', secret: 'x' }) });
    assert.strictEqual(r.status, 400, 'App ID com letra é recusado antes de ir ao ML');

    r = await pedir(P, '/auth', { headers: COOKIE });
    assert.strictEqual(r.headers.location, '/configuracao.html?erro=credenciais');

    // ---------- OAuth: state no servidor, de uso único ----------
    D.configGravar('ml_client_id', '1234567890');
    D.configGravar('ml_client_secret', 'segredo-falso-de-teste-123');
    r = await pedir(P, '/auth', { headers: COOKIE });
    assert.strictEqual(r.status, 302);
    const destino = new URL(r.headers.location);
    assert.strictEqual(destino.host, 'auth.mercadolivre.com.br');
    assert.strictEqual(destino.searchParams.get('redirect_uri'), `${TUNEL}/callback`, 'o retorno vai para o túnel');
    const state = destino.searchParams.get('state');
    assert.match(state, /^[a-f0-9]{32}$/);

    r = await pedir(PUB, `/callback?code=TG-falso&state=${state}`);
    assert.ok(!/expirada ou desconhecida/.test(r.corpo), 'o state emitido pelo /auth é aceito');
    assert.ok(r.corpo.includes(`http://localhost:${P}/configuracao.html`), 'o link de volta aponta para o painel local');
    r = await pedir(PUB, `/callback?code=TG-falso&state=${state}`);
    assert.match(r.corpo, /expirada ou desconhecida/, 'o mesmo state não vale duas vezes');

    // ---------- login, sessão e saída ----------
    r = await pedir(P, '/login', { metodo: 'POST', headers: { ...FORM, ...ORIGEM }, corpo: form({ senha: 'errada' }) });
    assert.strictEqual(r.status, 401);
    // navegador com política de privacidade estrita: Origin null, mas o próprio navegador diz same-origin
    r = await pedir(P, '/login', { metodo: 'POST', headers: { ...FORM, Origin: 'null', 'Sec-Fetch-Site': 'same-origin' },
      corpo: form({ senha: 'senha-da-aula' }) });
    assert.strictEqual(r.status, 302, 'login do próprio painel entra mesmo com Origin null');
    r = await pedir(P, '/login', { metodo: 'POST', headers: { ...FORM, ...ORIGEM }, corpo: form({ senha: 'senha-da-aula' }) });
    assert.strictEqual(r.status, 302);
    const COOKIE2 = { Cookie: String(r.headers['set-cookie']).split(';')[0] };

    // ---------- estáticos ----------
    r = await pedir(P, '/aviso.js');
    assert.strictEqual(r.status, 302, 'estático também exige login');
    r = await pedir(P, '/aviso.js', { headers: COOKIE2 });
    assert.strictEqual(r.status, 200);
    assert.match(r.headers['content-type'], /^text\/javascript/);
    assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
    for (const c of ['/..%2fserver.js', '/%2e%2e/db.js', '/..%5cserver.js', '/%E0%A4%A']) {
      r = await pedir(P, c, { headers: COOKIE2 });
      assert.ok([400, 403, 404].includes(r.status), `não pode escapar de public/: ${c} (deu ${r.status})`);
      assert.ok(!r.corpo.includes('use strict'), `não pode vazar código: ${c}`);
    }

    r = await pedir(P, '/sair', { metodo: 'POST', headers: { ...COOKIE2, ...ORIGEM } });
    assert.strictEqual(r.headers.location, '/login');
    r = await pedir(P, '/api/config', { headers: COOKIE2 });
    assert.strictEqual(r.status, 401, 'depois de sair, o cookie antigo não vale');

    console.log('OK — porta pública fechada, painel só local, primeiro acesso, OAuth de uso único, sessão');
  } finally {
    await srv.fechar();
    D.db.close();
    for (const f of [process.env.ML_DB_FILE, process.env.ML_DB_FILE + '-wal', process.env.ML_DB_FILE + '-shm']) {
      try { require('node:fs').unlinkSync(f); } catch {}
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
