// app.js

document.addEventListener('DOMContentLoaded', () => {
  let client = null;
  const varsMeta      = {};
  const treeStructure = {};
  let currentCliente  = null;
  let currentEquip    = null;

  const cardsContainer = document.getElementById('cardsContainer');
  const treeContainer  = document.getElementById('treeContainer');
  const statusEl       = document.getElementById('status');
  const indicator      = document.getElementById('indicator');
  const btnConnect     = document.getElementById('btnConnect');
  const debugOutput    = document.getElementById('debugOutput');

  function logDebug(msg) {
    const time = new Date().toLocaleTimeString();
    const lines = debugOutput.textContent.split('\n').filter(l=>l);
    lines.push(`[${time}] ${msg}`);
    if (lines.length > 5) lines.splice(0, lines.length - 5);
    debugOutput.textContent = lines.join('\n') + '\n';
    debugOutput.scrollTop = debugOutput.scrollHeight;
  }

  if (!btnConnect || !cardsContainer || !treeContainer || !debugOutput) {
    console.error('Elementos essenciais não encontrados');
    return;
  }

  const TOPIC_RX = /^([^/]+)\/([^/]+)\/topico_leitura$/;
  const NEW_RX   = /^<[^>]+>;\s*un=[^;]*(?:;\s*conv=[^;]+)?/i;
  const OLD_RX   = /^.+\s\[[^\]]+\]\s\(\s*V(?:[/*]\d+)?\s*\)$/;

  btnConnect.addEventListener('click', () => {
    if (client) client.end(true);

    const host = document.getElementById('host').value.trim();
    const port = document.getElementById('port').value.trim();
    const user = document.getElementById('user').value.trim();
    const pass = document.getElementById('pass').value.trim();
    const url  = `wss://${host}:${port}/mqtt`;

    statusEl.textContent = 'conectando...';
    indicator.className = 'indicator connecting';
    logDebug(`Conectando a ${url}`);

    client = mqtt.connect(url, { username: user, password: pass, connectTimeout:5000, reconnectPeriod:3000 });

    client.on('connect', () => {
      statusEl.textContent = 'conectado';
      indicator.className = 'indicator online';
      client.subscribe('#', { qos: 1 });
      logDebug('Assinado em #');
    });
    client.on('reconnect', () => { statusEl.textContent='reconectando...'; indicator.className='indicator connecting'; logDebug('Reconectando...'); });
    client.on('offline',   () => { statusEl.textContent='offline';      indicator.className='indicator offline';  logDebug('Offline'); });
    client.on('error', err => { statusEl.innerHTML='<em style="color:red">erro</em>'; indicator.className='indicator offline'; logDebug(`Erro MQTT: ${err.message}`); });

    client.on('message', (topic, msg) => {
      logDebug(`Msg em ${topic}`);
      const m = topic.match(TOPIC_RX);
      if (!m) return;
      const [_, cliente, equip] = m;
      if (!treeStructure[cliente]) treeStructure[cliente] = {};
      treeStructure[cliente][equip] = true;
      renderTree();

      let d;
      try { d = JSON.parse(msg.toString()).d; }
      catch (e) { logDebug(`JSON inválido: ${e.message}`); return; }
      const pubTopic = `${cliente}/${equip}/topico_escrita`;

      Object.entries(d).forEach(([origKey, raw]) => {
        if (origKey==='type' || origKey.startsWith('{Link')) return;
        const key = origKey.replace(/\\"/g,'').replace(/"/g,'');
        const fmt = NEW_RX.test(key)?'new': OLD_RX.test(key)?'old':null;
        if (!fmt) return;
        processEntry(fmt, key, origKey, raw, d, pubTopic, cliente, equip);
      });
    });
  });

  // Delegação de click na árvore
  treeContainer.addEventListener('click', e => {
    const li = e.target.closest('li');
    if (!li) return;
    const isCliente = !li.parentElement.closest('ul ul');
    if (isCliente) {
      const cliente = li.textContent.trim().replace(/ /g,'_');
      currentCliente = currentCliente===cliente ? null : cliente;
      currentEquip   = null;
    } else {
      const equip = li.textContent.trim().replace(/ /g,'_');
      currentEquip = currentEquip===equip ? null : equip;
    }
    clearCards();
    renderTree();
    if (currentCliente && currentEquip) {
      renderCardsFor(currentCliente, currentEquip);
    }
  });

  function processEntry(fmt, sanitized, original, raw, templateD, pubTopic, cliente, equip) {
    const id = `${cliente}/${equip}/${original}`;
    if (!varsMeta[id]) {
      let name, unit, conv, isBit;
      if (fmt==='old') {
        const m = sanitized.match(/(.+)\s\[(.+)\]\s\(\s*V([/*]\d+)?\s*\)/);
        isBit = sanitized.includes('[BIT]');
        name  = isBit?sanitized.replace(/\s\[BIT\].*/,''):(m?m[1]:sanitized);
        unit  = isBit?'BIT':(m?m[2]:'');
        conv  = (m&&m[3])?'V'+m[3]:'V';
      } else {
        const m = sanitized.match(/^<(.+?)>;\s*un=([^;]*)(?:;\s*conv=([^;]+))?/i);
        name  = m?m[1]:sanitized;
        unit  = m?m[2]:'';
        conv  = m&&m[3]?m[3]:'V';
        isBit = unit.toUpperCase()==='BIT';
      }
      varsMeta[id] = { id,name,unit,conv,isBit,
        templateD,modbusKey:Object.keys(templateD).find(k=>k.startsWith('{Link')),
        publishTopic:pubTopic,cliente,equip,lastRaw:raw
      };
      logDebug(`Registrada: ${name} em ${cliente}/${equip}`);
    }

    // se já selecionado, atualiza imediatamente
    if (cliente===currentCliente && equip===currentEquip) {
      if (!document.getElementById(`card-${cssEscape(id)}`)) {
        // cria com delay zero para sequenciar
        setTimeout(() => {
          createCard(id);
          refreshCard(id, raw);
        }, 0);
      } else {
        refreshCard(id, raw);
      }
    }
  }

  function renderTree() {
    treeContainer.innerHTML = '<h3>CLIENTES</h3>';
    const ulC = document.createElement('ul');

    Object.keys(treeStructure).forEach(cliente => {
      const liC = document.createElement('li');
      liC.textContent = cliente.replace(/_/g,' ');
      if (cliente===currentCliente && !currentEquip) liC.classList.add('active');
      ulC.append(liC);

      if (cliente===currentCliente) {
        const ulE = document.createElement('ul');
        Object.keys(treeStructure[cliente]).forEach(equip => {
          const liE = document.createElement('li');
          liE.textContent = equip.replace(/_/g,' ');
          if (equip===currentEquip) liE.classList.add('active');
          ulE.append(liE);
        });
        ulC.append(ulE);
      }
    });

    treeContainer.append(ulC);
  }

  function clearCards() {
    cardsContainer.innerHTML = '';
  }

  function renderCardsFor(cliente, equip) {
    const metas = Object.values(varsMeta)
      .filter(m => m.cliente===cliente && m.equip===equip);

    metas.forEach((meta, idx) => {
      setTimeout(() => {
        createCard(meta.id);
        refreshCard(meta.id, meta.lastRaw);
      }, idx * 100);
    });
  }

  function createCard(id) {
    const meta = varsMeta[id];
    const card = document.createElement('div');
    card.id = `card-${cssEscape(id)}`;
    card.className = 'card' + (meta.isBit?' boolean':'');
    const h3 = document.createElement('h3'); h3.textContent = meta.name;
    const p  = document.createElement('p');  p.className = 'val';
    card.append(h3, p);

    if (!meta.isBit && meta.unit.toUpperCase()!=='EST') {
      const ctr = document.createElement('div'); ctr.className='card-controls';
      const input = document.createElement('input'); input.type='number'; input.step='any';
      input.id = `input-${cssEscape(id)}`;
      const btn = document.createElement('button'); btn.textContent='↗';
      btn.onclick = () => {
        const v = document.getElementById(`input-${cssEscape(id)}`).value;
        if (!v) return;
        let rawWrite; const expr = meta.conv.trim();
        if (expr.includes('/')) rawWrite = v * (+expr.split('/')[1]);
        else if (expr.includes('*')) rawWrite = v / (+expr.split('*')[1]);
        else rawWrite = v;
        publishPayload(meta, Math.round(rawWrite));
      };
      ctr.append(input, btn);
      card.append(ctr);
    }

    cardsContainer.append(card);
  }

  function refreshCard(id, raw) {
    // (mesma lógica de antes)
    const meta = varsMeta[id];
    const card = document.getElementById(`card-${cssEscape(id)}`);
    const val  = card.querySelector('.val');
    val.textContent = '';

    if (meta.isBit) {
      const on = ['1','true','verdadeiro'].includes(String(raw).toLowerCase());
      card.classList.toggle('on', on);
      card.classList.toggle('off', !on);
      val.textContent = on ? 'LIGADO' : 'DESLIGADO';
    }
    else if (meta.unit.toUpperCase()==='EST') {
      const ok = ['1','true','verdadeiro'].includes(String(raw).toLowerCase());
      val.textContent = ok ? 'HABILITADO' : 'DESABILITADO';
    }
    else {
      const expr = meta.conv.replace(/V/g, String(raw));
      const num  = Number(eval(expr));
      const dec  = /[/*]/.test(meta.conv) ? 2 : 0;
      val.textContent = num.toFixed(dec);
      if (meta.unit) {
        const span = document.createElement('span');
        span.className = 'unit';
        span.textContent = ` ${normalizeUnit(meta.unit)}`;
        val.append(span);
      }
    }
  }

  function publishPayload(meta, newRaw) {
    const d = { ...meta.templateD };
    Object.keys(d).forEach(k => {
      if (d[k] === String(meta.lastRaw)) d[k] = String(newRaw);
    });
    meta.lastRaw = newRaw;
    client.publish(meta.publishTopic, JSON.stringify({ d }), { qos: 1 });
    logDebug(`Publicado em ${meta.publishTopic}`);
  }

  function cssEscape(s) {
    return s.replace(/[^a-zA-Z0-9]/g, '_');
  }
  function normalizeUnit(u) {
    return u.replace(/[^A-Za-z0-9]/g, '').toUpperCase()==='C' ? '°C' : u;
  }
});
