const $ = (id) => document.getElementById(id);
const send = (message) => chrome.runtime.sendMessage(message);

async function render() {
  const { state, status, suggestions } = await chrome.storage.session.get(['state', 'status', 'suggestions']);
  const active = Boolean(state?.active);

  $('start').hidden = active;
  $('session').hidden = !active;
  $('status').hidden = !status;
  $('status').textContent = status?.text ?? '';
  $('status').classList.toggle('error', Boolean(status?.error));
  for (const button of $('start').querySelectorAll('button')) {
    button.disabled = Boolean(status && !status.error);
  }
  $('no-suggestions').hidden = suggestions?.length !== 0;
  $('suggestions').replaceChildren(
    ...(suggestions ?? []).map(({ label, tabIds }, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quiet';
      button.onclick = () => send({ type: 'pick', index });
      const name = document.createElement('span');
      name.textContent = label;
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = tabIds.length;
      button.append(name, count);
      const row = document.createElement('li');
      row.append(button);
      return row;
    }),
  );
  if (!active) return;

  $('current-topic').textContent = state.topic;
  $('threshold').value = state.threshold;
  $('threshold-value').textContent = `${state.threshold.toFixed(2)}${state.autoThreshold ? ' · авто' : ''}`;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const record = state.tabs[tab.id];
  $('verdict').hidden = !record;
  if (record) {
    $('verdict').classList.toggle('on', record.on);
    $('verdict-text').textContent = record.on
      ? `Эта вкладка по теме «${state.topic}».`
      : `Эта вкладка не про «${state.topic}». Когда уйдёшь с неё, она свернётся в «Не по теме».`;
    $('mark-on').hidden = record.on;
    $('mark-off').hidden = !record.on && tab.groupId === state.offGroupId;
    $('mark-on').onclick = () => send({ type: 'mark', tabId: tab.id, on: true });
    $('mark-off').onclick = () => send({ type: 'mark', tabId: tab.id, on: false });
  }

  const rows = Object.values(state.tabs)
    .sort((a, b) => b.score - a.score)
    .map(({ title, score, on }) => {
      const row = document.createElement('li');
      row.className = on ? 'on' : '';
      const value = document.createElement('span');
      value.className = 'score';
      value.textContent = Number.isFinite(score) ? score.toFixed(2) : '—';
      const name = document.createElement('span');
      name.className = 'title';
      name.textContent = name.title = title;
      row.append(value, name);
      return row;
    });
  $('tabs').replaceChildren(...rows);
}

$('start').addEventListener('submit', (event) => {
  event.preventDefault();
  const topic = $('topic').value.trim();
  if (topic) send({ type: 'start', topic });
});
$('suggest').addEventListener('click', () => send({ type: 'suggest' }));
$('stop').addEventListener('click', () => send({ type: 'stop' }));
$('threshold').addEventListener('change', (event) => {
  send({ type: 'threshold', value: Number(event.target.value) });
});

chrome.storage.session.onChanged.addListener(render);
render();
