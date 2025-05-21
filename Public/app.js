// app.js

let client = null;
const varsMeta       = {};
const cardsContainer = document.getElementById('cardsContainer');
const statusEl       = document.getElementById('status');
const indicator      = document.getElementById('indicator');

// Regex para formatos:
// - Novo:  <VAR>;un=UN;conv=V/10   (un pode estar vazio)
// - Antigo: VAR [UN] (V/100)
const NEW_RX = /^<[^>]+>;\s*un=[^;]*(?:;\s*conv=[^;]+)?/i;
const OLD_RX = /^.+\s\[[^\]]+\]\s\(\s*V(?:[/*]\d+)?\s*\)$/;

document.getElementById('btnConnect').addEventListener('click', () => {
  if (client) client.end(true);

  const host = document.getElementById('host').value.trim();
  const port = document.getElementById('port').value.trim();
  const user = document.getElementById('user').value.trim();
  const pass = document.getElementById('pass').value.trim();
  const url  = `wss://${host}:${port}/mqtt`;

  statusEl.textContent = 'conectando...';
  indicator.className = 'indicator connecting';

  client = mqtt.connect(url, {
    username: user,
    password: pass,
    connectTimeout: 5000,
    reconnectPeriod: 3000
  });

  client.on('connect', () => {
    statusEl.textContent = 'conectado';
    indicator.className = 'indicator online';
    // Assina **tudo** usando coringa #
    client.subscribe('#', { qos: 1 });
  });
  client.on('reconnect', () => {
    statusEl.textContent = 'reconectando...';
    indicator.className = 'indicator connecting';
  });
  client.on('offline', () => {
    statusEl.textContent = 'offline';
    indicator.className = 'indicator offline';
  });
  client.on('error', err => {
    statusEl.innerHTML = '<em style="color:red">erro</em>';
    indicator.className = 'indicator offline';
    console.error('MQTT Erro:', err);
  });

  client.on('message', (topic, msg) => {
    let d;
    try {
      d = JSON.parse(msg.toString()).d;
    } catch {
      console.error('JSON inválido:', msg.toString());
      return;
    }

    // derivar publishTopic trocando leitura por escrita no próprio topic
    const publishTopic = topic.replace(/leitura$/, 'escrita');

    Object.entries(d).forEach(([origKey, raw]) => {
      if (origKey === 'type' || origKey.startsWith('{Link')) return;

      // Remove todas aspas (escapadas ou não)
      const key = origKey.replace(/\\"/g, '').replace(/"/g, '');

      if (NEW_RX.test(key)) {
        processNew(key, origKey, raw, d, publishTopic);
      } else if (OLD_RX.test(key)) {
        processOld(key, origKey, raw, d, publishTopic);
      } else {
        console.warn('Formato não reconhecido:', key);
      }
    });
  });
});

// Antigo: "VAR [UN] (V/100)"
function processOld(sanitized, original, raw, templateD, publishTopic) {
  if (!varsMeta[original]) {
    const m      = sanitized.match(/(.+)\s\[(.+)\]\s\(\s*V([/*]\d+)?\s*\)/);
    const isBit  = sanitized.includes('[BIT]');
    const name   = isBit
      ? sanitized.replace(/\s\[BIT\].*/, '')
      : (m ? m[1] : sanitized);
    const unit   = isBit ? 'BIT' : (m ? m[2] : '');
    const conv   = (m && m[3]) ? 'V' + m[3] : 'V';

    varsMeta[original] = {
      fullName: original,
      name,
      unit,
      conv,
      isBit,
      templateD,
      modbusKey: Object.keys(templateD).find(k=>k.startsWith('{Link')),
      publishTopic
    };
    createCard(varsMeta[original]);
  }
  refreshCard(varsMeta[original], raw);
}

// Novo: "<VAR>;un=UN;conv=V/10"
function processNew(sanitized, original, raw, templateD, publishTopic) {
  if (!varsMeta[original]) {
    const m = sanitized.match(/^<(.+?)>;\s*un=([^;]*)(?:;\s*conv=([^;]+))?/i);
    const name    = m ? m[1] : sanitized;
    const unit    = m ? m[2] : '';
    const conv    = (m && m[3]) ? m[3] : 'V';
    const isBit   = unit.toUpperCase() === 'BIT';

    varsMeta[original] = {
      fullName: original,
      name,
      unit,
      conv,
      isBit,
      templateD,
      modbusKey: Object.keys(templateD).find(k=>k.startsWith('{Link')),
      publishTopic
    };
    createCard(varsMeta[original]);
  }
  refreshCard(varsMeta[original], raw);
}

// Cria o card
function createCard(meta) {
  const { name, unit, isBit } = meta;
  const card = document.createElement('div');
  card.className = 'card' + (isBit ? ' boolean' : '');
  card.id        = `card-${cssEscape(name)}`;

  const h3  = document.createElement('h3');  h3.textContent = name;
  const val = document.createElement('p');   val.className = 'val';
  card.append(h3, val);

  if (!isBit && unit.toUpperCase() !== 'EST') {
    const ctr = document.createElement('div');
    ctr.className = 'card-controls';
    const input = document.createElement('input');
    input.type = 'number'; input.step = 'any';
    input.id   = `input-${cssEscape(name)}`;
    const btn = document.createElement('button');
    btn.textContent = '↗';
    btn.onclick = () => {
      const v = document.getElementById(`input-${cssEscape(name)}`).value;
      if (!v) return;
      // inverte conv
      let rawWrite;
      const expr = meta.conv.trim();
      if (expr.includes('/'))       rawWrite = v * (+expr.split('/')[1]);
      else if (expr.includes('*'))  rawWrite = v / (+expr.split('*')[1]);
      else                          rawWrite = v;
      publishPayload(meta, Math.round(rawWrite));
    };
    ctr.append(input, btn);
    card.append(ctr);
  }

  cardsContainer.append(card);
}

// Atualiza card
function refreshCard(meta, raw) {
  const card = document.getElementById(`card-${cssEscape(meta.name)}`);
  const val  = card.querySelector('.val');
  val.textContent = '';

  if (meta.isBit) {
    const flag = ['1','true','verdadeiro'].includes(String(raw).toLowerCase());
    card.classList.toggle('on',  flag);
    card.classList.toggle('off', !flag);
    val.textContent = flag ? 'LIGADO' : 'DESLIGADO';
  }
  else if (meta.unit.toUpperCase() === 'EST') {
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

// Publica comando mantendo todas as chaves originais
function publishPayload(meta, newRaw) {
  const d = { ...meta.templateD };
  Object.keys(d).forEach(k => {
    if (d[k] === String(meta.lastRaw)) d[k] = String(newRaw);
  });
  meta.lastRaw = newRaw;
  client.publish(meta.publishTopic, JSON.stringify({ d }), { qos: 1 });
}

// Helpers
function cssEscape(s) {
  return s.replace(/[^a-zA-Z0-9]/g, '_');
}
function normalizeUnit(u) {
  return u.replace(/[^A-Za-z0-9]/g, '').toUpperCase() === 'C'
    ? '°C' : u;
}
