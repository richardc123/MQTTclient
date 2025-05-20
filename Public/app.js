// app.js

let client = null;
const varsMeta       = {};
const cardsContainer = document.getElementById('cardsContainer');
const statusEl       = document.getElementById('status');
const indicator      = document.getElementById('indicator');

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
    client.subscribe('topico_leitura', { qos: 1 });
    client.subscribe(`${user}/+/topico_leitura`, { qos: 1 });
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
    try {
      const d = JSON.parse(msg.toString()).d;
      for (let [fullName, raw] of Object.entries(d)) {
        if (fullName === 'type' || fullName.startsWith('{Link')) continue;
        if (NEW_RX.test(fullName)) {
          processNew(fullName, raw, d);
        } else if (OLD_RX.test(fullName)) {
          processOld(fullName, raw, d);
        }
      }
    } catch (e) {
      console.error('JSON inválido:', e);
    }
  });
});

// regexs
const NEW_RX = /^<[^>]+>;\s*"un"="[^"]+"(?:;\s*"conv"="[^"]+")?/i;
const OLD_RX = /^.+\s\[[^\]]+\]\s\(\s*V(?:[/*]\d+)?\s*\)$/;

// lógica antiga
function processOld(fullName, raw, templateD) {
  if (!varsMeta[fullName]) {
    const isBit = fullName.includes('[BIT]');
    const m     = fullName.match(/(.+)\s\[(.+)\]\s\(\s*V(?:\/(\d+))?\s*\)/);
    let name, unit, divisor;
    if (isBit) {
      name = fullName.replace(/\s\[BIT\].*/, '');
    } else if (m) {
      name    = m[1];
      unit    = m[2];
      divisor = m[3] ? +m[3] : 1;
    } else {
      name = fullName;
    }
    const modbusKey = Object.keys(templateD).find(k => k.startsWith('{Link'));
    varsMeta[fullName] = { fullName, name, unit, divisor, isBit, modbusKey, templateD };
    createCard(varsMeta[fullName]);
  }
  refreshCard(varsMeta[fullName], raw);
}

// lógica nova
function processNew(fullName, raw, templateD) {
  if (!varsMeta[fullName]) {
    const m    = fullName.match(/^<(.+?)>;\s*"un"="(.+?)"(?:;\s*"conv"="(.+?)")?/i);
    const name = m ? m[1] : fullName;
    const unit = m ? m[2].toUpperCase() : '';
    const conv = m && m[3] ? m[3] : 'V';
    const isBit = unit === 'BIT';
    const dv = conv.match(/V\/(\d+)/i);
    const divisor = dv ? +dv[1] : 1;
    varsMeta[fullName] = { fullName, name, unit, conv, divisor, isBit, templateD };
    createCard(varsMeta[fullName]);
  }
  refreshCard(varsMeta[fullName], raw);
}

// criação de card (unificado)
function createCard(meta) {
  const { name, isBit } = meta;
  const card = document.createElement('div');
  card.className = 'card';
  if (isBit) card.classList.add('boolean');
  card.id = `card-${cssEscape(name)}`;

  const h3 = document.createElement('h3');
  h3.textContent = name;
  card.appendChild(h3);

  const val = document.createElement('p');
  val.className = 'val';
  card.appendChild(val);

  if (!meta.isBit && meta.unit) {
    const u = document.createElement('span');
    u.className = 'unit';
    u.textContent = `[${meta.unit}]`;
    val.appendChild(u);
  }

  if (!meta.isBit) {
    const ctr = document.createElement('div');
    ctr.style.display = 'flex';
    ctr.style.justifyContent = 'center';
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.placeholder = 'novo valor';
    input.id = `input-${cssEscape(name)}`;
    const btn = document.createElement('button');
    btn.className = 'send';
    btn.textContent = '↗';
    btn.onclick = () => {
      const v = document.getElementById(`input-${cssEscape(name)}`).value;
      if (!v) return;
      publishPayload(meta, Math.round(v * (meta.divisor || 1)));
    };
    ctr.append(input, btn);
    card.appendChild(ctr);
  }

  cardsContainer.appendChild(card);
}

// atualização de card (unificado)
function refreshCard(meta, raw) {
  const card = document.getElementById(`card-${cssEscape(meta.name)}`);
  const val  = card.querySelector('.val');
  val.textContent = '';

  if (meta.isBit) {
    const flag = ['1','true','verdadeiro'].includes(String(raw).toLowerCase());
    card.classList.toggle('on', flag);
    card.classList.toggle('off', !flag);
    val.textContent = flag ? 'LIGADO' : 'DESLIGADO';
  } else {
    const eng = Number(raw) / (meta.divisor || 1);
    const dec = eng.toFixed(meta.divisor>1 ? 2 : 0);
    val.textContent = dec;
    if (meta.unit) {
      const u = document.createElement('span');
      u.className = 'unit';
      u.textContent = ` [${meta.unit}]`;
      val.appendChild(u);
    }
  }
}

// publicação de comando
function publishPayload(meta, raw) {
  const d = { ...meta.templateD };
  d[meta.fullName] = String(raw);
  if (meta.modbusKey) d[meta.modbusKey] = String(raw);
  client.publish('topico_escrita', JSON.stringify({ d }), { qos: 1 });
}

function cssEscape(s) {
  return s.replace(/[^a-zA-Z0-9]/g, '_');
}
