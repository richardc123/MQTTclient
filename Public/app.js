// app.js
// Lembre-se de incluir antes no HTML:
// <script src="https://unpkg.com/mqtt/dist/mqtt.min.js"></script>

let client = null;
const varsMeta       = {};
const varsState      = {};
const cardsContainer = document.getElementById('cardsContainer');
const statusEl       = document.getElementById('status');

document.getElementById('btnConnect').addEventListener('click', () => {
  if (client) client.end(true);

  const urlField = document.getElementById('url').value;    // ex: wss://host:9002/mqtt
  const user     = document.getElementById('user').value;
  const pass     = document.getElementById('pass').value;

  client = mqtt.connect(urlField, {
    username:        user,
    password:        pass,
    connectTimeout:  5000,
    reconnectPeriod: 3000
  });

  client.on('connect', () => {
    statusEl.innerHTML = 'Status: <em>conectado</em>';
    client.subscribe('topico_leitura', { qos: 1 });
  });
  client.on('reconnect', () => {
    statusEl.innerHTML = 'Status: <em>reconectando...</em>';
  });
  client.on('error', err => {
    statusEl.innerHTML = 'Status: <em style="color:red">erro</em>';
    console.error('MQTT Erro:', err);
  });
  client.on('offline', () => {
    statusEl.innerHTML = 'Status: <em style="color:gray">offline</em>';
  });

  client.on('message', (topic, msg) => {
    if (topic !== 'topico_leitura') return;
    try {
      const payload = JSON.parse(msg.toString());
      const d       = payload.d;
      const key     = Object.keys(d).find(k => k !== 'type' && !k.startsWith('{Link'));
      updateVar(key, d[key], d);
    } catch (e) {
      console.error('JSON inválido:', e, msg.toString());
    }
  });
});

function updateVar(fullName, raw, templateD) {
  if (!varsMeta[fullName]) {
    const isBit = fullName.includes('[BIT]');
    // Regex agora captura V/<divisor> ou somente V
    const m = fullName.match(/(.+)\s\[(.+)\]\s\(\s*V(?:\/(\d+))?\s*\)/);
    let name, unit, divisor;
    if (isBit) {
      name = fullName.replace(/\s\[BIT\].*/, '');
    } else if (m) {
      name    = m[1];         // antes do espaço-colchete
      unit    = m[2];         // dentro dos colchetes
      divisor = m[3] ? Number(m[3]) : 1;  // se não tiver divisor, usa 1
    } else {
      name    = fullName;
    }
    const modbusKey = Object.keys(templateD).find(k => k.startsWith('{Link'));
    varsMeta[fullName] = { fullName, name, unit, divisor, isBit, modbusKey, templateD };
    createCard(varsMeta[fullName]);
  }

  varsState[fullName] = raw;
  refreshCard(varsMeta[fullName], raw);
}

function createCard(meta) {
  const { name, isBit } = meta;
  const card = document.createElement('div');
  card.classList.add('card');
  card.id = `card-${name}`;

  // título
  const h = document.createElement('h3');
  h.textContent = name;
  card.appendChild(h);

  // container de conteúdo
  const content = document.createElement('div');
  content.classList.add('content');
  card.appendChild(content);

  // para cards numéricos, criamos já o input e o botão (sem valor inicial)
  if (!isBit) {
    const input = document.createElement('input');
    input.type        = 'number';
    input.step        = 'any';
    input.placeholder = 'novo valor';
    input.id          = `input-${name}`;
    content.appendChild(input);

    const btn = document.createElement('button');
    btn.textContent = '↗';
    btn.classList.add('send');
    btn.addEventListener('click', () => {
      const valStr = document.getElementById(`input-${name}`).value;
      if (valStr === '') return;
      const newRaw = Math.round(Number(valStr) * (meta.divisor || 1));
      publishPayload(meta, newRaw);
    });
    content.appendChild(btn);
  }

  cardsContainer.appendChild(card);
}

function refreshCard(meta, raw) {
  const { name, unit, divisor, isBit } = meta;
  const card      = document.getElementById(`card-${name}`);
  const container = card.querySelector('.content');

  // remove só o parágrafo de valor antigo, se existir
  const oldP = container.querySelector('p.val');
  if (oldP) oldP.remove();

  if (isBit) {
    // conteúdo inteiro para BIT
    container.innerHTML = '';
    const state = ['1','true','verdadeiro'].includes(String(raw).toLowerCase());
    card.classList.add('boolean');
    card.classList.toggle('on',  state);
    card.classList.toggle('off', !state);

    const txt = document.createElement('p');
    txt.textContent = state ? 'LIGADO' : 'DESLIGADO';
    txt.classList.add('val');
    container.appendChild(txt);

    const btn = document.createElement('button');
    btn.textContent = state ? 'Desligar' : 'Ligar';
    btn.classList.add('send');
    btn.onclick = () => publishPayload(meta, state ? 0 : 1);
    container.appendChild(btn);

  } else {
    // atualiza só o parágrafo de valor
    const value = Number(raw) / (divisor || 1);
    const pVal  = document.createElement('p');
    pVal.textContent = value.toFixed(divisor > 1 ? 2 : 0)
      + (unit ? ` [${unit.toUpperCase()}]` : '');
    pVal.classList.add('val');
    const input = document.getElementById(`input-${name}`);
    container.insertBefore(pVal, input);
  }
}

function publishPayload(meta, raw) {
  const d = { ...meta.templateD };
  d[meta.fullName] = String(raw);
  if (meta.modbusKey) d[meta.modbusKey] = String(raw);
  client.publish('topico_escrita', JSON.stringify({ d }), { qos: 1 });
}
