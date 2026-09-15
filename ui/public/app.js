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
const swaggerInput = document.querySelector('#swaggerInput');
const swaggerState = document.querySelector('#swaggerState');
const methodSearchInput = document.querySelector('#methodSearchInput');
const routeNameInput = document.querySelector('#routeNameInput');
const methodList = document.querySelector('#methodList');
const methodCount = document.querySelector('#methodCount');
const routeCanvas = document.querySelector('.routeCanvas');
const routeSteps = document.querySelector('#routeSteps');
const addSelectedButton = document.querySelector('#addSelectedButton');
const connectButton = document.querySelector('#connectButton');
const clearRouteButton = document.querySelector('#clearRouteButton');
const saveRouteButton = document.querySelector('#saveRouteButton');
const routesRefreshButton = document.querySelector('#routesRefreshButton');
const savedRoutesList = document.querySelector('#savedRoutesList');

let pollTimer = null;
let endpoints = [];
let selectedEndpointIds = [];
let route = [];

const workspaceStorageKey = 'bigJourneyK6RouteBuilder';

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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function riskLabel(risk) {
  const labels = {
    read: 'read-only',
    write: 'изменяет данные',
    danger: 'осторожно',
  };

  return labels[risk] || risk;
}

function methodClass(method) {
  return `method method-${method.toLowerCase()}`;
}

function selectedEndpoint(id) {
  return endpoints.find((endpoint) => endpoint.id === id);
}

function filteredEndpoints() {
  const query = methodSearchInput.value.trim().toLowerCase();
  if (!query) return endpoints;

  return endpoints.filter((endpoint) => {
    const haystack = [
      endpoint.method,
      endpoint.path,
      endpoint.summary,
      endpoint.operationId,
      endpoint.tags.join(' '),
      endpoint.risk,
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(query);
  });
}

function updateRouteControls() {
  addSelectedButton.disabled = selectedEndpointIds.length !== 1;
  connectButton.disabled = selectedEndpointIds.length !== 2;
  saveRouteButton.disabled = route.length === 0;
}

function renderMethods() {
  const visibleEndpoints = filteredEndpoints();
  methodCount.textContent = `${visibleEndpoints.length} из ${endpoints.length} методов`;

  if (!endpoints.length) {
    methodList.innerHTML = '<p class="muted">Пока нет загруженных методов.</p>';
    updateRouteControls();
    return;
  }

  if (!visibleEndpoints.length) {
    methodList.innerHTML = '<p class="muted">Ничего не найдено. Попробуй другой запрос.</p>';
    updateRouteControls();
    return;
  }

  methodList.innerHTML = visibleEndpoints
    .map((endpoint) => {
      const selected = selectedEndpointIds.includes(endpoint.id) ? ' selected' : '';
      const summary = endpoint.summary ? `<p>${escapeHtml(endpoint.summary)}</p>` : '';
      const auth = endpoint.authRequired ? '<span class="metaPill">auth</span>' : '<span class="metaPill">public</span>';

      return `<button class="methodCard${selected}" type="button" draggable="true" data-endpoint-id="${escapeHtml(endpoint.id)}">
        <span class="methodCardTop">
          <span class="${methodClass(endpoint.method)}">${escapeHtml(endpoint.method)}</span>
          <span class="risk risk-${escapeHtml(endpoint.risk)}">${escapeHtml(riskLabel(endpoint.risk))}</span>
        </span>
        <strong>${escapeHtml(endpoint.path)}</strong>
        ${summary}
        <span class="methodMeta">${auth}<span class="metaPill">${escapeHtml(endpoint.tags[0] || 'api')}</span></span>
      </button>`;
    })
    .join('');

  updateRouteControls();
}

function renderRoute() {
  if (!route.length) {
    routeSteps.className = 'routeSteps empty';
    routeSteps.textContent = 'Перетащи метод из нижней полки сюда или добавь выбранный метод кнопкой.';
    updateRouteControls();
    return;
  }

  routeSteps.className = 'routeSteps';
  routeSteps.innerHTML = route
    .map((step, index) => {
      const summary = step.summary ? `<p>${escapeHtml(step.summary)}</p>` : '';
      const moveUpDisabled = index === 0 ? ' disabled' : '';
      const moveDownDisabled = index === route.length - 1 ? ' disabled' : '';

      return `<div class="routeStep" draggable="true" data-step-index="${index}">
        <div class="routeStepIndex">${index + 1}</div>
        <div class="routeStepBody">
          <span class="${methodClass(step.method)}">${escapeHtml(step.method)}</span>
          <strong>${escapeHtml(step.path)}</strong>
          ${summary}
        </div>
        <div class="stepActions">
          <button class="iconButton" type="button" data-action="up" data-index="${index}"${moveUpDisabled} title="Выше">↑</button>
          <button class="iconButton" type="button" data-action="down" data-index="${index}"${moveDownDisabled} title="Ниже">↓</button>
          <button class="iconButton dangerButton" type="button" data-action="remove" data-index="${index}" title="Удалить">×</button>
        </div>
      </div>`;
    })
    .join('');

  updateRouteControls();
}

function renderSavedRoutes(routes = []) {
  if (!routes.length) {
    savedRoutesList.innerHTML = '<p class="muted">Сохраненных маршрутов пока нет.</p>';
    return;
  }

  savedRoutesList.innerHTML = routes
    .map((savedRoute) => {
      const date = new Date(savedRoute.updatedAt).toLocaleString('ru-RU');
      return `<div class="savedRoute">
        <strong>${escapeHtml(savedRoute.name)}</strong>
        <span>${savedRoute.stepsCount} шагов · ${date}</span>
      </div>`;
    })
    .join('');
}

function saveWorkspace() {
  localStorage.setItem(
    workspaceStorageKey,
    JSON.stringify({
      endpoints,
      route,
      routeName: routeNameInput.value,
      savedAt: Date.now(),
    }),
  );
}

function restoreWorkspace() {
  try {
    const raw = localStorage.getItem(workspaceStorageKey);
    if (!raw) return;

    const saved = JSON.parse(raw);
    endpoints = Array.isArray(saved.endpoints) ? saved.endpoints : [];
    route = Array.isArray(saved.route) ? saved.route : [];

    if (saved.routeName) {
      routeNameInput.value = saved.routeName;
    }

    if (endpoints.length) {
      swaggerState.textContent = `Восстановлено ${endpoints.length} методов из прошлого сеанса.`;
    }
  } catch (_error) {
    localStorage.removeItem(workspaceStorageKey);
  }
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
  renderSavedRoutes(data.routes || []);

  if (data.activeRunId && !pollTimer) {
    startPolling();
  }
}

function toggleEndpointSelection(endpointId) {
  if (selectedEndpointIds.includes(endpointId)) {
    selectedEndpointIds = selectedEndpointIds.filter((id) => id !== endpointId);
  } else {
    selectedEndpointIds = [...selectedEndpointIds, endpointId].slice(-2);
  }

  renderMethods();
}

function endpointToRouteStep(endpoint) {
  if (!endpoint) return;
  return {
    method: endpoint.method,
    path: endpoint.path,
    summary: endpoint.summary,
    operationId: endpoint.operationId,
    tags: endpoint.tags,
    authRequired: endpoint.authRequired,
    risk: endpoint.risk,
    expectStatus: 200,
  };
}

function addEndpointToRoute(endpoint, index = route.length) {
  const step = endpointToRouteStep(endpoint);
  if (!step) return;
  route.splice(index, 0, step);
  saveWorkspace();
}

function moveRouteStep(fromIndex, toIndex) {
  if (toIndex < 0 || toIndex >= route.length) return;
  const [step] = route.splice(fromIndex, 1);
  route.splice(toIndex, 0, step);
  saveWorkspace();
  renderRoute();
}

function moveRouteStepTo(fromIndex, toIndex) {
  if (fromIndex < 0 || fromIndex >= route.length) return;

  const [step] = route.splice(fromIndex, 1);
  const adjustedIndex = toIndex > fromIndex ? toIndex - 1 : toIndex;
  const safeIndex = Math.max(0, Math.min(adjustedIndex, route.length));

  route.splice(safeIndex, 0, step);
  saveWorkspace();
  renderRoute();
}

function dropIndexFromEvent(event) {
  const step = event.target.closest('.routeStep');
  if (!step) return route.length;

  const index = Number(step.dataset.stepIndex);
  const rect = step.getBoundingClientRect();
  return event.clientX > rect.left + rect.width / 2 ? index + 1 : index;
}

function clearDragState() {
  routeCanvas.classList.remove('dragOver');
  document.querySelectorAll('.dragging').forEach((element) => {
    element.classList.remove('dragging');
  });
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
routesRefreshButton.addEventListener('click', refresh);

swaggerInput.addEventListener('change', async () => {
  const file = swaggerInput.files?.[0];
  if (!file) return;

  swaggerState.textContent = `Читаю ${file.name}...`;

  try {
    const content = await file.text();
    const data = await requestJson('/api/swagger', {
      method: 'POST',
      body: JSON.stringify({ name: file.name, content }),
    });

    endpoints = data.endpoints;
    selectedEndpointIds = [];
    route = [];
    swaggerState.textContent = `${data.title || file.name}: найдено ${endpoints.length} методов.`;
    saveWorkspace();
    renderMethods();
    renderRoute();
  } catch (error) {
    endpoints = [];
    selectedEndpointIds = [];
    route = [];
    localStorage.removeItem(workspaceStorageKey);
    swaggerState.textContent = error.message;
    renderMethods();
    renderRoute();
  } finally {
    swaggerInput.value = '';
  }
});

methodSearchInput.addEventListener('input', renderMethods);

methodList.addEventListener('click', (event) => {
  const card = event.target.closest('[data-endpoint-id]');
  if (!card) return;

  toggleEndpointSelection(card.dataset.endpointId);
});

methodList.addEventListener('dragstart', (event) => {
  const card = event.target.closest('[data-endpoint-id]');
  if (!card) return;

  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('application/x-endpoint-id', card.dataset.endpointId);
  card.classList.add('dragging');
});

methodList.addEventListener('dragend', clearDragState);

addSelectedButton.addEventListener('click', () => {
  addEndpointToRoute(selectedEndpoint(selectedEndpointIds[0]));
  selectedEndpointIds = [];
  renderMethods();
  renderRoute();
});

connectButton.addEventListener('click', () => {
  selectedEndpointIds.map(selectedEndpoint).forEach((endpoint) => addEndpointToRoute(endpoint));
  selectedEndpointIds = [];
  renderMethods();
  renderRoute();
});

routeCanvas.addEventListener('dragover', (event) => {
  const types = Array.from(event.dataTransfer.types);
  if (!types.includes('application/x-endpoint-id') && !types.includes('application/x-route-step-index')) {
    return;
  }

  event.preventDefault();
  routeCanvas.classList.add('dragOver');
  event.dataTransfer.dropEffect = types.includes('application/x-endpoint-id') ? 'copy' : 'move';
});

routeCanvas.addEventListener('dragleave', (event) => {
  if (!routeCanvas.contains(event.relatedTarget)) {
    routeCanvas.classList.remove('dragOver');
  }
});

routeCanvas.addEventListener('drop', (event) => {
  event.preventDefault();
  const endpointId = event.dataTransfer.getData('application/x-endpoint-id');
  const routeStepIndex = event.dataTransfer.getData('application/x-route-step-index');
  const targetIndex = dropIndexFromEvent(event);

  if (endpointId) {
    addEndpointToRoute(selectedEndpoint(endpointId), targetIndex);
    renderRoute();
  } else if (routeStepIndex !== '') {
    moveRouteStepTo(Number(routeStepIndex), targetIndex);
  }

  clearDragState();
});

routeSteps.addEventListener('dragstart', (event) => {
  const step = event.target.closest('.routeStep');
  if (!step || event.target.closest('button')) return;

  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/x-route-step-index', step.dataset.stepIndex);
  step.classList.add('dragging');
});

routeSteps.addEventListener('dragend', clearDragState);

routeSteps.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;

  const index = Number(button.dataset.index);
  if (button.dataset.action === 'remove') {
    route.splice(index, 1);
    saveWorkspace();
    renderRoute();
  }

  if (button.dataset.action === 'up') {
    moveRouteStep(index, index - 1);
  }

  if (button.dataset.action === 'down') {
    moveRouteStep(index, index + 1);
  }
});

clearRouteButton.addEventListener('click', () => {
  route = [];
  selectedEndpointIds = [];
  saveWorkspace();
  renderMethods();
  renderRoute();
});

routeNameInput.addEventListener('input', saveWorkspace);

saveRouteButton.addEventListener('click', async () => {
  const name = routeNameInput.value.trim();

  try {
    const data = await requestJson('/api/routes', {
      method: 'POST',
      body: JSON.stringify({ name, steps: route }),
    });

    swaggerState.textContent = `Маршрут "${data.route.name}" сохранен: ${data.route.stepsCount} шагов.`;
    await refresh();
  } catch (error) {
    swaggerState.textContent = error.message;
  }
});

commandSelect.dispatchEvent(new Event('change'));
restoreWorkspace();
renderMethods();
renderRoute();
refresh().catch((error) => {
  statusText.textContent = error.message;
});
