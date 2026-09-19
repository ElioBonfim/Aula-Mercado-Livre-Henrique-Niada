'use strict';
// Túnel HTTPS público apontado para a PORTA PÚBLICA do painel, que só responde
// /callback (retorno do OAuth) e /webhook (notificações). O painel em si nunca sai do
// computador do aluno.
//
// Provedores, medidos em 18/09/2026:
//   cloudflared (padrão) — trycloudflare.com, sem conta. O pacote npm baixa o binário
//     sozinho. URL em ~8 s; navegador e webhook passam direto.
//   localtunnel (plano B) — loca.lt. O webhook passa, mas o NAVEGADOR cai numa página
//     "Tunnel website ahead!" que pede o IP público (uma vez por IP a cada 7 dias). O
//     pacote está parado desde 2023 e traz 2 vulnerabilidades HIGH (axios 0.21), por
//     isso não entra no package.json: é baixado com npx só se o cloudflared falhar.
// Nos dois a URL muda a cada reinício (o loca.lt nem devolve o subdomínio pedido se você
// reconectar logo). É por isso que o painel compara com o que o ML tem cadastrado.
//
// URL_PUBLICA no .env desliga o túnel: use quando você já tem domínio próprio apontando
// para a porta pública (ex.: túnel nomeado da Cloudflare).
const { EventEmitter } = require('node:events');
const dns = require('node:dns').promises;
const fs = require('node:fs');
const P = require('./processos.js');

const ESPERA_URL_MS = 45000;
const ESPERA_VERIFICAR_MS = 60000;
const REINICIO_MS = [5000, 10000, 30000, 60000];
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));

// O nome novo do trycloudflare leva alguns segundos para existir no DNS, e o domínio NÃO
// é curinga: perguntar antes disso devolve NXDOMAIN com TTL negativo de 1800 s. Medido em
// 18/09/2026: uma consulta cedo demais deixou o macOS respondendo "não existe" para a URL
// do túnel enquanto 1.1.1.1 e 8.8.8.8 já resolviam — o retorno do login do ML cairia em
// "site não encontrado" por até 30 minutos.
// Por isso a primeira pergunta vai direto aos servidores AUTORITATIVOS da Cloudflare, que
// não guardam cache; só depois que o nome existe alguém consulta pelo caminho normal.
async function esperarDnsAutoritativo(host, prazo, parar = () => false) {
  const dominio = host.split('.').slice(-2).join('.');
  let resolvedor;
  try {
    const ns = await dns.resolveNs(dominio);
    const ips = (await Promise.all(ns.map((n) => dns.resolve4(n).catch(() => [])))).flat();
    if (!ips.length) return true; // sem como perguntar direto: segue e deixa o teste HTTP decidir
    resolvedor = new dns.Resolver({ timeout: 3000, tries: 1 });
    resolvedor.setServers(ips);
  } catch { return true; }
  while (Date.now() < prazo && !parar()) {
    try { if ((await resolvedor.resolve4(host)).length) return true; } catch {}
    await dormir(1500);
  }
  return false;
}

class Tunel extends EventEmitter {
  constructor({ porta, modo = 'cloudflared', urlFixa = '', log = console.log, arquivoLog = null }) {
    super();
    this.porta = porta;
    this.modo = modo;
    this.urlFixa = String(urlFixa || '').trim().replace(/\/+$/, '');
    this.log = log;
    this.arquivoLog = arquivoLog;
    this.estado = 'parado';        // parado | iniciando | verificando | online | caiu | desligado | falhou
    this.provedor = null;
    this.url = null;
    this.verificado = false;
    this.erro = null;
    this.desde = null;
    this.pid = null;
    this._parar = null;
    this._parando = false;
    this._falhas = 0;
    this._timer = null;
    this._geracao = 0;
  }

  info() {
    return { estado: this.estado, provedor: this.provedor, url: this.url, verificado: this.verificado,
      erro: this.erro, desde: this.desde, modo: this.modo };
  }

  _gravar(txt) {
    if (!this.arquivoLog) return;
    try { fs.appendFileSync(this.arquivoLog, txt.endsWith('\n') ? txt : txt + '\n'); } catch {}
  }

  async iniciar() {
    this._parando = false;
    clearTimeout(this._timer);
    if (this.urlFixa) {
      Object.assign(this, { estado: 'verificando', provedor: 'fixa', url: this.urlFixa, desde: new Date().toISOString() });
      this.verificado = await this._verificar();
      this.estado = 'online';
      this.emit('url', this.url, this.provedor);
      return;
    }
    if (this.modo === 'nenhum') { this.estado = 'desligado'; return; }

    this.estado = 'iniciando';
    this.erro = null;
    const ordem = this.modo === 'localtunnel' ? ['localtunnel'] : ['cloudflared', 'localtunnel'];
    const erros = [];
    for (const prov of ordem) {
      try {
        const r = prov === 'cloudflared' ? await this._cloudflared() : await this._localtunnel();
        if (this._parando) { r.parar(); return; }
        // "verificando" e não "online": o painel só mostra a URL quando ela já existe no DNS.
        // Mostrar antes convida o aluno a abrir cedo demais (NXDOMAIN por 30 min).
        Object.assign(this, { provedor: prov, url: r.url, pid: r.pid, _parar: r.parar,
          estado: 'verificando', desde: new Date().toISOString(), erro: null });
        // O "saiu" de um túnel antigo pode chegar depois do novo subir: só a geração atual conta.
        const geracao = ++this._geracao;
        r.aoSair(() => { if (geracao === this._geracao) this._caiu(`o processo do ${prov} terminou`); });
        this.verificado = await this._verificar();
        if (geracao !== this._geracao || this.estado !== 'verificando') return; // caiu ou parou no meio
        this.estado = 'online';
        this._falhas = 0;
        this.emit('url', this.url, this.provedor);
        return;
      } catch (e) {
        erros.push(`${prov}: ${e.message}`);
        this._gravar(`[${new Date().toISOString()}] ${prov} falhou: ${e.message}`);
        if (ordem.length > 1 && prov === 'cloudflared') this.log(`  cloudflared falhou (${e.message}) — tentando localtunnel…`);
      }
    }
    this.erro = erros.join(' | ');
    this.estado = 'falhou';
    this.emit('falhou', this.erro);
    this._agendar();
  }

  parar() {
    this._parando = true;
    this._geracao++;
    clearTimeout(this._timer);
    try { this._parar?.(); } catch {}
    this._parar = null;
    this.estado = 'parado';
  }

  _caiu(motivo) {
    if (this._parando) return;
    this._parar = null;
    this.estado = 'caiu';
    this.erro = motivo;
    this.verificado = false;
    this.emit('caiu', motivo);
    this._agendar();
  }

  _agendar() {
    if (this._parando) return;
    const ms = REINICIO_MS[Math.min(this._falhas++, REINICIO_MS.length - 1)];
    this._timer = setTimeout(() => this.iniciar(), ms);
  }

  // A URL só vale se um pedido de fora dá a volta e chega na porta pública.
  async _verificar() {
    const fim = Date.now() + ESPERA_VERIFICAR_MS;
    const host = new URL(this.url).hostname;
    if (/\.trycloudflare\.com$/i.test(host) && !(await esperarDnsAutoritativo(host, fim, () => this._parando))) {
      return false;
    }
    while (Date.now() < fim && !this._parando) {
      try {
        const r = await fetch(`${this.url}/saude`, {
          headers: { 'bypass-tunnel-reminder': '1', 'User-Agent': 'aula-ml-verificacao' },
          signal: AbortSignal.timeout(8000),
        });
        if (r.ok && (await r.json()).app === 'aula-ml') return true;
      } catch {}
      await new Promise((ok) => setTimeout(ok, 2000));
    }
    return false;
  }

  async _cloudflared() {
    const cf = require('cloudflared');
    if (!fs.existsSync(cf.bin)) {
      this.log('  baixando o cloudflared (só na primeira vez)…');
      await cf.install(cf.bin);
    }
    return new Promise((resolve, reject) => {
      const t = cf.Tunnel.quick(`http://127.0.0.1:${this.porta}`);
      let url = null, conectado = false, pronto = false;
      const cauda = [];
      const saidas = [];
      const falhar = (e) => {
        if (pronto) return;
        pronto = true; clearTimeout(timer);
        try { t.stop(); } catch {}
        reject(new Error(`${e}${cauda.length ? ' — ' + cauda.slice(-2).join(' / ') : ''}`));
      };
      const talvezPronto = () => {
        if (pronto || !url || !conectado) return;
        pronto = true; clearTimeout(timer);
        resolve({ url, pid: t.process?.pid, parar: () => t.stop(), aoSair: (fn) => saidas.push(fn) });
      };
      const timer = setTimeout(() => falhar(`não entregou URL em ${ESPERA_URL_MS / 1000} s`), ESPERA_URL_MS);
      // A regex do pacote também casa "https://api.trycloudflare.com", que aparece nas
      // mensagens de ERRO do cloudflared. Esse endereço não é o túnel.
      t.on('url', (u) => { if (!url && !/^https:\/\/api\./.test(u)) { url = u; talvezPronto(); } });
      t.on('connected', () => { conectado = true; talvezPronto(); });
      t.on('stderr', (s) => {
        this._gravar(s);
        for (const l of String(s).split('\n')) if (/ERR|error|failed/i.test(l)) cauda.push(l.replace(/^\S+\s+/, '').trim());
      });
      t.on('error', (e) => falhar(e.message));
      t.on('exit', (code) => {
        if (!pronto) return falhar(`saiu com código ${code}`);
        for (const fn of saidas) fn(code);
      });
    });
  }

  _localtunnel() {
    return new Promise((resolve, reject) => {
      const args = ['--yes', 'localtunnel@2.0.2', '--port', String(this.porta), '--local-host', '127.0.0.1'];
      // npx é um .cmd no Windows: precisa de shell. Argumentos fixos, nada vem do usuário.
      const p = P.iniciar('npx', args, { shell: P.WIN });
      let pronto = false;
      const saidas = [];
      const falhar = (e) => {
        if (pronto) return;
        pronto = true; clearTimeout(timer); P.matarArvore(p.pid);
        reject(new Error(e));
      };
      const timer = setTimeout(() => falhar(`não entregou URL em ${ESPERA_URL_MS / 1000} s`), ESPERA_URL_MS);
      const ler = (buf) => {
        const s = buf.toString();
        this._gravar(s);
        const m = /https:\/\/[a-z0-9-]+\.loca\.lt/i.exec(s);
        if (m && !pronto) {
          pronto = true; clearTimeout(timer);
          resolve({ url: m[0], pid: p.pid, parar: () => P.matarArvore(p.pid), aoSair: (fn) => saidas.push(fn) });
        }
      };
      p.stdout.on('data', ler);
      p.stderr.on('data', ler);
      p.on('error', (e) => falhar(e.message));
      p.on('exit', (code) => {
        if (!pronto) return falhar(`saiu com código ${code}`);
        for (const fn of saidas) fn(code);
      });
    });
  }
}

module.exports = { Tunel };
