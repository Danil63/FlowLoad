const statusText = document.querySelector('#statusText');
const tokenForm = document.querySelector('#tokenForm');
const tokenInput = document.querySelector('#tokenInput');
const tokenState = document.querySelector('#tokenState');
const runForm = document.querySelector('#runForm');
const commandSelect = document.querySelector('#commandSelect');
const usersInput = document.querySelector('#usersInput');
const runButton = document.querySelector('#runButton');
const runBadge = document.querySelector('#runBadge');
const runOutput = document.querySelector('#runOutput');
const reportsList = document.querySelector('#reportsList');
const refreshButton = document.querySelector('#refreshButton');
const reportsButton = document.querySelector('#reportsButton');

let pollTimer = null;

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

function setBadge(status) {
  const labels = {
    idle: 'Нет запуска',
    running: 'Выполняется',
    passed: 'Готово',
    failed: 'Есть ошибки',
  };

  runBadge.className = `badge ${status || 'idle'}`;
  runBadge.textContent = labels[status] || labels.idle;
}

function renderReports(reports) {
  if (!reports.length) {
    reportsList.innerHTML = '<p class="muted">Отчетов пока нет</p>';
    return;
  }

  reportsList.innerHTML = reports
    .map((report) => {
      const date = new Date(report.createdAt).toLocaleString('ru-RU');
      return `<a class="reportLink" href="${report.url}" target="_blank" rel="noreferrer">
        <span>${report.name}</span>
        <span class="reportDate">${date}</span>
      </a>`;
    })
    .join('');
}

function renderRun(run) {
  if (!run) {
    setBadge('idle');
    runButton.disabled = false;
    if (!runOutput.textContent) {
      runOutput.textContent = 'Запусков еще не было';
    }
    return;
  }

  setBadge(run.status);
  runButton.disabled = run.status === 'running';
  runOutput.textContent = run.output || 'Запуск начался...';
  runOutput.scrollTop = runOutput.scrollHeight;
}

async function refresh() {
  const data = await requestJson('/api/status');
  statusText.textContent = data.tokenReady ? 'Токен сохранен. Можно запускать тесты.' : 'Токен не сохранен.';
  tokenState.textContent = data.tokenReady ? 'Токен сохранен локально' : 'Токен нужен для auth-сценариев';
  renderRun(data.activeRun);
  renderReports(data.reports);

  if (data.activeRunId && !pollTimer) {
    startPolling();
  }
}

function startPolling() {
  pollTimer = window.setInterval(async () => {
    try {
      const data = await requestJson('/api/run/current');
      renderRun(data.run);
      if (!data.run || data.run.status !== 'running') {
        window.clearInterval(pollTimer);
        pollTimer = null;
        await refresh();
      }
    } catch (error) {
      runOutput.textContent += `\n${error.message}`;
    }
  }, 1000);
}

tokenForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = tokenInput.value.trim();

  try {
    await requestJson('/api/token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    tokenInput.value = '';
    await refresh();
  } catch (error) {
    tokenState.textContent = error.message;
  }
});

runForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const command = commandSelect.value;
  const users = usersInput.value.trim();

  try {
    const data = await requestJson('/api/run', {
      method: 'POST',
      body: JSON.stringify({ command, users }),
    });
    renderRun(data.run);
    startPolling();
  } catch (error) {
    runOutput.textContent = error.message;
  }
});

commandSelect.addEventListener('change', () => {
  usersInput.disabled = !['public', 'auth'].includes(commandSelect.value);
});

refreshButton.addEventListener('click', refresh);
reportsButton.addEventListener('click', refresh);

commandSelect.dispatchEvent(new Event('change'));
refresh().catch((error) => {
  statusText.textContent = error.message;
});
