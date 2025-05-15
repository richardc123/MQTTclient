// lembre-se de incluir mqtt.min.js no HTML

let client = null;
const varsMeta       = {};
const cardsContainer = document.getElementById('cardsContainer');
const statusEl       = document.getElementById('status');
const indicator      = document.getElementById('indicator');

document.getElementById('btnConnect').addEventListener('click', () => {
  if (client) client.end(true);

  const host = document.getElementById('host').value.trim();
  const port = document.getElementById('port').value.trim();
  const user = document.getElementById('user').value;
  const pass = document.getElementById('pass').value;
  const url  = `wss://${host}:${port}/mqtt`;

  // atualiza status visual para "conectando"
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
  });

  client.on('reconnect', () => {
    statusEl.textContent = 'reconectando...';
    indicator.className = 'indicator connecting';
  });

  client.on('error', err => {
    statusEl.innerHTML = '<em style="color:red">erro</em>';
    indicator.className = 'indicator offline';
    console.error('MQTT Erro:', err);
  });

  client.on('offline', () => {
    statusEl.textContent = 'offline';
    indicator.className = 'indicator offline';
  });

  client.on('message', (topic, msg) => {
    if (topic !== 'topico_leitura') return;
    try {
      const d   = JSON.parse(msg.toString()).d;
      const key = Object.keys(d).find(k => k !== 'type' && !k.startsWith('{Link'));
      updateVar(key, d[key], d);
    } catch (e) {
      console.error('JSON inválido:', e);
    }
  });
});

function updateVar(fullName, raw, templateD) {
  if (!varsMeta[fullName]) {
    const isBit = fullName.includes('[BIT]');
    const m     = fullName.match(/(.+)\s\[(.+)\]\s\(\s*V(?:\/(\d+))?\s*\)/);
    let name, unit, divisor;
    if (isBit) {
      name = fullName.replace(/\s\[BIT\].*/, '');
    } else if (m) {
      name    = m[1];
      unit    = m[2];
      divisor = m[3] ? Number(m[3]) : 1;
    } else {
      name = fullName;
    }
    const modbusKey = Object.keys(templateD).find(k => k.startsWith('{Link'));
    varsMeta[fullName] = { fullName, name, unit, divisor, isBit, modbusKey, templateD };
    createCard(varsMeta[fullName]);
  }
  refreshCard(varsMeta[fullName], raw);
}

function createCard(meta) {
  const { name, isBit } = meta;
  const card = document.createElement('div');
  card.className = 'card';
  card.id        = `card-${name}`;

  const h = document.createElement('h3');
  h.textContent = name;
  card.appendChild(h);

  const content = document.createElement('div');
  content.className = 'content';
  card.appendChild(content);

  if (!isBit) {
    const input = document.createElement('input');
    input.type        = 'number';
    input.step        = 'any';
    input.placeholder = 'novo valor';
    input.id          = `input-${name}`;
    content.appendChild(input);

    const btn = document.createElement('button');
    btn.className = 'send';
    btn.textContent = '↗';
    btn.addEventListener('click', () => {
      const v = document.getElementById(`input-${name}`).value;
      if (!v) return;
      const rawVal = Math.round(Number(v) * (meta.divisor || 1));
      publishPayload(meta, rawVal);
    });
    content.appendChild(btn);
  }

  cardsContainer.appendChild(card);
}

function refreshCard(meta, raw) {
  const { name, unit, divisor, isBit } = meta;
  const card = document.getElementById(`card-${name}`);
  const c    = card.querySelector('.content');

  // remove valor antigo
  const old = c.querySelector('p.val');
  if (old) old.remove();

  if (isBit) {
    c.innerHTML = '';
    const state = ['1','true','verdadeiro'].includes(String(raw).toLowerCase());
    card.classList.remove('boolean','on','off');
    card.classList.add('boolean', state ? 'on' : 'off');

    const txt = document.createElement('p');
    txt.className = 'val';
    txt.textContent = state ? 'LIGADO' : 'DESLIGADO';
    c.appendChild(txt);

    const btn = document.createElement('button');
    btn.className = 'send';
    btn.textContent = state ? 'Desligar' : 'Ligar';
    btn.onclick = () => publishPayload(meta, state ? 0 : 1);
    c.appendChild(btn);

  } else {
    const value = Number(raw) / (divisor || 1);
    const pVal  = document.createElement('p');
    pVal.className = 'val';
    pVal.textContent = value.toFixed(divisor>1?2:0)
      + (unit?` [${unit.toUpperCase()}]`:'');
    const inp = document.getElementById(`input-${name}`);
    c.insertBefore(pVal, inp);
  }
}

function publishPayload(meta, raw) {
  const d = { ...meta.templateD };
  d[meta.fullName] = String(raw);
  if (meta.modbusKey) d[meta.modbusKey] = String(raw);
  client.publish('topico_escrita', JSON.stringify({ d }), { qos: 1 });
}
