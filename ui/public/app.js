const statusText = document.querySelector('#statusText');
const tokenForm = document.querySelector('#tokenForm');
const tokenInput = document.querySelector('#tokenInput');
const tokenState = document.querySelector('#tokenState');
const runForm = document.querySelector('#runForm');
const commandSelect = document.querySelector('#commandSelect');
const usersInput = document.querySelector('#usersInput');
const routeSelectLabel = document.querySelector('#routeSelectLabel');
const routeSelect = document.querySelector('#routeSelect');
const profileSelectLabel = document.querySelector('#profileSelectLabel');
const profileSelect = document.querySelector('#profileSelect');
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
const loadProfileState = document.querySelector('#loadProfileState');
const loadMethodSearchInput = document.querySelector('#loadMethodSearchInput');
const loadProfileNameInput = document.querySelector('#loadProfileNameInput');
const loadChart = document.querySelector('.loadChart');
const loadTargetsList = document.querySelector('#loadTargetsList');
const saveLoadProfileButton = document.querySelector('#saveLoadProfileButton');
const clearLoadProfileButton = document.querySelector('#clearLoadProfileButton');
const savedLoadProfilesList = document.querySelector('#savedLoadProfilesList');

let pollTimer = null;
let endpoints = [];
let selectedEndpointIds = [];
let route = [];
let savedRoutes = [];
let loadProfileTargets = [];
let savedLoadProfiles = [];
let expandedLoadTargetKey = null;

const workspaceStorageKey = 'bigJourneyK6RouteBuilder';
const loadProfileStorageKey = 'bigJourneyK6LoadProfileBuilder';
const defaultMethodVus = 10;
const loadScaleMin = 10;
const loadScaleMax = 1000;
const loadOverflowSliderValue = 1100;
const loadGraphHeight = 220;
const loadGraphTopPad = 18;
const loadGraphBottomPad = 22;
const loadColumnWidth = 126;

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

function filteredLoadEndpoints() {
  const query = loadMethodSearchInput.value.trim().toLowerCase();
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
  savedRoutes = routes;
  renderRouteOptions();

  if (!routes.length) {
    savedRoutesList.innerHTML = '<p class="muted">Сохраненных маршрутов пока нет.</p>';
    return;
  }

  savedRoutesList.innerHTML = routes
    .map((savedRoute) => {
      const date = new Date(savedRoute.updatedAt).toLocaleString('ru-RU');
      return `<div class="savedRoute">
        <div class="savedRouteInfo">
          <strong>${escapeHtml(savedRoute.name)}</strong>
          <span>${savedRoute.stepsCount} шагов · ${date}</span>
        </div>
        <div class="savedRouteActions">
          <button class="ghost" type="button" data-route-action="load" data-route-file="${escapeHtml(savedRoute.fileName)}">Открыть</button>
          <button class="ghost dangerButton" type="button" data-route-action="delete" data-route-file="${escapeHtml(savedRoute.fileName)}">Удалить</button>
        </div>
      </div>`;
    })
    .join('');
}

function renderRouteOptions() {
  if (!savedRoutes.length) {
    routeSelect.innerHTML = '<option value="">Нет сохраненных маршрутов</option>';
    routeSelect.disabled = true;
    return;
  }

  const previousValue = routeSelect.value;
  routeSelect.innerHTML = savedRoutes
    .map((savedRoute) => `<option value="${escapeHtml(savedRoute.fileName)}">${escapeHtml(savedRoute.name)} (${savedRoute.stepsCount})</option>`)
    .join('');
  routeSelect.disabled = false;

  if (savedRoutes.some((savedRoute) => savedRoute.fileName === previousValue)) {
    routeSelect.value = previousValue;
  }
}

function renderLoadProfileOptions() {
  if (!savedLoadProfiles.length) {
    profileSelect.innerHTML = '<option value="">Нет сохраненных профилей</option>';
    profileSelect.disabled = true;
    return;
  }

  const previousValue = profileSelect.value;
  profileSelect.innerHTML = savedLoadProfiles
    .map(
      (profile) =>
        `<option value="${escapeHtml(profile.fileName)}">${escapeHtml(profile.name)} (${profile.targetsCount} методов)</option>`,
    )
    .join('');
  profileSelect.disabled = false;

  if (savedLoadProfiles.some((profile) => profile.fileName === previousValue)) {
    profileSelect.value = previousValue;
  }
}

function endpointToLoadTarget(endpoint, vus = defaultMethodVus) {
  if (!endpoint) return null;
  return {
    method: endpoint.method,
    path: endpoint.path,
    summary: endpoint.summary,
    operationId: endpoint.operationId,
    tags: endpoint.tags,
    authRequired: endpoint.authRequired,
    risk: endpoint.risk,
    expectStatus: 200,
    weight: vus,
  };
}

function targetKey(target) {
  return `${String(target.method || '').toUpperCase()} ${target.path}`;
}

function selectAllLoadTargets(vus = defaultMethodVus) {
  loadProfileTargets = endpoints.map((endpoint) => endpointToLoadTarget(endpoint, vus)).filter(Boolean);
  saveLoadProfileWorkspace();
}

function syncAllLoadTargets() {
  const existingTargets = new Map(loadProfileTargets.map((target) => [targetKey(target), target]));
  loadProfileTargets = endpoints
    .map((endpoint) => {
      const nextTarget = endpointToLoadTarget(endpoint);
      const existingTarget = existingTargets.get(targetKey(nextTarget));
      return existingTarget
        ? {
            ...nextTarget,
            weight: Math.max(loadScaleMin, Number(existingTarget.weight || defaultMethodVus)),
          }
        : nextTarget;
    })
    .filter(Boolean);
  saveLoadProfileWorkspace();
}

function ensureDefaultLoadTargets() {
  if (endpoints.length && loadProfileTargets.length === 0) {
    selectAllLoadTargets();
  }
}

function loadProfileTotal() {
  return loadProfileTargets.reduce((sum, target) => sum + Number(target.weight || 0), 0);
}

function matchesLoadQuery(target) {
  const query = loadMethodSearchInput.value.trim().toLowerCase();
  if (!query) return true;

  const haystack = [
    target.method,
    target.path,
    target.summary,
    target.operationId,
    target.tags.join(' '),
    target.risk,
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(query);
}

function renderLoadMethods() {
  renderLoadTargets();
}

function renderLoadTargets() {
  ensureDefaultLoadTargets();
  const total = loadProfileTotal();
  saveLoadProfileButton.disabled = loadProfileTargets.length === 0;

  if (!loadProfileTargets.length) {
    loadTargetsList.className = 'loadTargetsList empty';
    loadTargetsList.textContent = 'Загрузи Swagger, чтобы все методы появились в профиле нагрузки.';
    return;
  }

  loadTargetsList.className = 'loadTargetsList';
  const visibleTargets = loadProfileTargets
    .map((target, originalIndex) => ({ target, originalIndex }))
    .filter(({ target }) => matchesLoadQuery(target));

  if (!visibleTargets.length) {
    loadTargetsList.className = 'loadTargetsList empty';
    loadTargetsList.textContent = 'По этому поиску методов не найдено.';
    return;
  }

  const graphWidth = Math.max(loadColumnWidth * visibleTargets.length, 1);
  const gridLines = [1000, 750, 500, 250, 10];
  const yForWeight = (weight) => {
    const clampedWeight = Math.max(loadScaleMin, Math.min(loadScaleMax, Number(weight || loadScaleMin)));
    const activeHeight = loadGraphHeight - loadGraphTopPad - loadGraphBottomPad;
    const ratio = (clampedWeight - loadScaleMin) / (loadScaleMax - loadScaleMin);
    return Math.round(loadGraphTopPad + (1 - ratio) * activeHeight);
  };
  const points = visibleTargets
    .map(({ target }, index) => {
      const x = Math.round(index * loadColumnWidth + loadColumnWidth / 2);
      return `${x},${yForWeight(target.weight)}`;
    })
    .join(' ');
  const axis = gridLines
    .map((value) => `<span class="loadAxisTick" style="top:${yForWeight(value)}px">${value}</span>`)
    .join('');
  const grid = gridLines
    .map((value) => `<line x1="0" y1="${yForWeight(value)}" x2="${graphWidth}" y2="${yForWeight(value)}"></line>`)
    .join('');
  const targetCards = visibleTargets
    .map(({ target, originalIndex }) => {
      const weight = Number(target.weight || defaultMethodVus);
      const percent = total > 0 ? Math.round((weight / total) * 100) : 0;
      const sliderValue = weight > loadScaleMax ? loadOverflowSliderValue : Math.max(loadScaleMin, weight);
      const isExpanded = expandedLoadTargetKey === targetKey(target);
      const expandedClass = isExpanded ? ' expanded' : '';
      const summary =
        target.summary && target.summary !== target.operationId
          ? `<span class="loadSummary">${escapeHtml(target.summary)}</span>`
          : '';
      const auth = target.authRequired ? 'auth' : 'public';

      return `<div class="loadTarget${expandedClass}" data-load-target-index="${originalIndex}" style="--point-top: ${yForWeight(weight)}px">
        <div class="loadPoint">
          <span class="loadPointValue">${weight}</span>
          <span class="loadPointDot" title="${weight} VUs"></span>
          <input class="loadRange" type="range" min="${loadScaleMin}" max="${loadOverflowSliderValue}" step="10" value="${sliderValue}" data-load-range-index="${originalIndex}" aria-label="VUs для ${escapeHtml(target.method)} ${escapeHtml(target.path)}">
        </div>
        <div class="loadTargetCard" role="button" tabindex="0" data-load-card-index="${originalIndex}" aria-expanded="${isExpanded}">
          <div class="loadTargetTop">
            <span class="${methodClass(target.method)}">${escapeHtml(target.method)}</span>
          </div>
          <strong>${escapeHtml(target.path)}</strong>
          <div class="loadDetails">
            ${summary}
            <span class="loadOperation">${escapeHtml(target.operationId || target.tags[0] || 'api')}</span>
            <span class="loadMetaLine">
              <span>${escapeHtml(auth)}</span>
              <span>${escapeHtml(riskLabel(target.risk))}</span>
              <span>${percent}% профиля</span>
            </span>
            <label class="loadManualControl">
              VUs на метод
              <input class="loadWeightInput" type="number" min="${loadScaleMin}" max="100000" value="${weight}" data-load-weight-index="${originalIndex}">
            </label>
          </div>
        </div>
      </div>`;
    })
    .join('');

  loadTargetsList.innerHTML = `<div class="loadAxis">${axis}</div>
    <div class="loadGraphScroller">
      <div class="loadGraphInner" style="width:${graphWidth}px; --load-count:${visibleTargets.length}; --load-column-width:${loadColumnWidth}px">
        <svg class="loadTrend" viewBox="0 0 ${graphWidth} ${loadGraphHeight}" preserveAspectRatio="none" aria-hidden="true">
          <g class="loadGrid">${grid}</g>
          <polyline points="${points}"></polyline>
        </svg>
        ${targetCards}
      </div>
    </div>`;
}

function renderSavedLoadProfiles(profiles = []) {
  savedLoadProfiles = profiles;
  renderLoadProfileOptions();

  if (!profiles.length) {
    savedLoadProfilesList.innerHTML = '<p class="muted">Сохраненных профилей пока нет.</p>';
    return;
  }

  savedLoadProfilesList.innerHTML = profiles
    .map((profile) => {
      const date = new Date(profile.updatedAt).toLocaleString('ru-RU');
      return `<div class="savedRoute">
        <div class="savedRouteInfo">
          <strong>${escapeHtml(profile.name)}</strong>
          <span>${profile.targetsCount} методов · ${profile.totalWeight} VUs · ${date}</span>
        </div>
        <div class="savedRouteActions">
          <button class="ghost" type="button" data-load-profile-action="load" data-load-profile-file="${escapeHtml(profile.fileName)}">Открыть</button>
          <button class="ghost dangerButton" type="button" data-load-profile-action="delete" data-load-profile-file="${escapeHtml(profile.fileName)}">Удалить</button>
        </div>
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

function saveLoadProfileWorkspace() {
  localStorage.setItem(
    loadProfileStorageKey,
    JSON.stringify({
      loadProfileTargets,
      loadProfileName: loadProfileNameInput.value,
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

function restoreLoadProfileWorkspace() {
  try {
    const raw = localStorage.getItem(loadProfileStorageKey);
    if (!raw) return;

    const saved = JSON.parse(raw);
    loadProfileTargets = Array.isArray(saved.loadProfileTargets) ? saved.loadProfileTargets : [];

    if (saved.loadProfileName) {
      loadProfileNameInput.value = saved.loadProfileName;
    }
  } catch (_error) {
    localStorage.removeItem(loadProfileStorageKey);
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
  renderSavedLoadProfiles(data.loadProfiles || []);

  if (data.activeRunId && !pollTimer) {
    startPolling();
  }
}

async function loadSavedRoute(fileName) {
  const data = await requestJson(`/api/routes/${encodeURIComponent(fileName)}`);
  const savedRoute = data.route;

  routeNameInput.value = savedRoute.name || fileName.replace(/\.route\.json$/, '');
  route = Array.isArray(savedRoute.steps)
    ? savedRoute.steps.map((step) => ({
        method: step.method,
        path: step.path,
        summary: step.summary,
        operationId: step.operationId,
        tags: Array.isArray(step.tags) ? step.tags : [],
        authRequired: Boolean(step.authRequired),
        risk: step.risk || 'read',
        expectStatus: Number(step.expectStatus || 200),
      }))
    : [];
  selectedEndpointIds = [];
  saveWorkspace();
  renderMethods();
  renderRoute();
  swaggerState.textContent = `Маршрут "${routeNameInput.value}" открыт в конструкторе.`;
}

async function deleteSavedRoute(fileName) {
  const savedRoute = savedRoutes.find((item) => item.fileName === fileName);
  const name = savedRoute?.name || fileName;

  if (!window.confirm(`Удалить маршрут "${name}"?`)) {
    return;
  }

  await requestJson(`/api/routes/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
  if (routeSelect.value === fileName) {
    routeSelect.value = '';
  }
  await refresh();
  swaggerState.textContent = `Маршрут "${name}" удален.`;
}

async function loadSavedLoadProfile(fileName) {
  const data = await requestJson(`/api/load-profiles/${encodeURIComponent(fileName)}`);
  const profile = data.profile;

  loadProfileNameInput.value = profile.name || fileName.replace(/\.load\.json$/, '');
  loadProfileTargets = Array.isArray(profile.targets)
    ? profile.targets.map((target) => ({
        method: target.method,
        path: target.path,
        summary: target.summary,
        operationId: target.operationId,
        tags: Array.isArray(target.tags) ? target.tags : [],
        authRequired: Boolean(target.authRequired),
        risk: target.risk || 'read',
        expectStatus: Number(target.expectStatus || 200),
        weight: Number(target.weight || 1),
      }))
    : [];

  saveLoadProfileWorkspace();
  renderLoadMethods();
  loadProfileState.textContent = `Профиль "${loadProfileNameInput.value}" открыт в конструкторе.`;
}

async function deleteSavedLoadProfile(fileName) {
  const savedProfile = savedLoadProfiles.find((item) => item.fileName === fileName);
  const name = savedProfile?.name || fileName;

  if (!window.confirm(`Удалить профиль нагрузки "${name}"?`)) {
    return;
  }

  await requestJson(`/api/load-profiles/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
  if (profileSelect.value === fileName) {
    profileSelect.value = '';
  }
  await refresh();
  loadProfileState.textContent = `Профиль "${name}" удален.`;
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

function addEndpointToLoadProfile(endpoint) {
  const target = endpointToLoadTarget(endpoint);
  if (!target) return;

  const existingTarget = loadProfileTargets.find(
    (item) => item.method === target.method && item.path === target.path,
  );

  if (existingTarget) {
    existingTarget.weight = Math.max(defaultMethodVus, Number(existingTarget.weight || defaultMethodVus));
  } else {
    loadProfileTargets.push(target);
  }

  saveLoadProfileWorkspace();
  renderLoadTargets();
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
  loadChart.classList.remove('dragOver');
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
  const routeFile = routeSelect.value;
  const profileFile = profileSelect.value;

  try {
    if (command === 'route' && !routeFile) {
      throw new Error('Выбери сохраненный маршрут для запуска.');
    }

    if (command === 'profile' && !profileFile) {
      throw new Error('Выбери сохраненный профиль нагрузки для запуска.');
    }

    const data = await requestJson('/api/run', {
      method: 'POST',
      body: JSON.stringify({ command, users, routeFile, profileFile }),
    });
    renderRun(data.run);
    startPolling();
  } catch (error) {
    runOutput.textContent = error.message;
  }
});

commandSelect.addEventListener('change', () => {
  const routeMode = commandSelect.value === 'route';
  const profileMode = commandSelect.value === 'profile';
  usersInput.disabled = !['public', 'auth', 'route'].includes(commandSelect.value);
  routeSelect.classList.toggle('hidden', !routeMode);
  routeSelectLabel.classList.toggle('hidden', !routeMode);
  profileSelect.classList.toggle('hidden', !profileMode);
  profileSelectLabel.classList.toggle('hidden', !profileMode);
});

refreshButton.addEventListener('click', refresh);
reportsButton.addEventListener('click', refresh);
routesRefreshButton.addEventListener('click', refresh);

savedRoutesList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-route-action]');
  if (!button) return;

  try {
    if (button.dataset.routeAction === 'load') {
      await loadSavedRoute(button.dataset.routeFile);
    }

    if (button.dataset.routeAction === 'delete') {
      await deleteSavedRoute(button.dataset.routeFile);
    }
  } catch (error) {
    swaggerState.textContent = error.message;
  }
});

savedLoadProfilesList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-load-profile-action]');
  if (!button) return;

  try {
    if (button.dataset.loadProfileAction === 'load') {
      await loadSavedLoadProfile(button.dataset.loadProfileFile);
    }

    if (button.dataset.loadProfileAction === 'delete') {
      await deleteSavedLoadProfile(button.dataset.loadProfileFile);
    }
  } catch (error) {
    loadProfileState.textContent = error.message;
  }
});

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
    loadProfileTargets = [];
    syncAllLoadTargets();
    swaggerState.textContent = `${data.title || file.name}: найдено ${endpoints.length} методов.`;
    saveWorkspace();
    renderMethods();
    renderRoute();
    renderLoadMethods();
  } catch (error) {
    endpoints = [];
    selectedEndpointIds = [];
    route = [];
    localStorage.removeItem(workspaceStorageKey);
    swaggerState.textContent = error.message;
    renderMethods();
    renderRoute();
    renderLoadMethods();
  } finally {
    swaggerInput.value = '';
  }
});

methodSearchInput.addEventListener('input', renderMethods);
loadMethodSearchInput.addEventListener('input', renderLoadMethods);

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

loadTargetsList.addEventListener('input', (event) => {
  const range = event.target.closest('[data-load-range-index]');
  if (!range) return;

  const index = Number(range.dataset.loadRangeIndex);
  const value = Number(range.value || defaultMethodVus);

  if (value > loadScaleMax) {
    loadProfileTargets[index].weight = Math.max(loadOverflowSliderValue, Number(loadProfileTargets[index].weight || loadOverflowSliderValue));
  } else {
    loadProfileTargets[index].weight = Math.max(loadScaleMin, value);
  }

  saveLoadProfileWorkspace();
  renderLoadTargets();
});

loadTargetsList.addEventListener('change', (event) => {
  const input = event.target.closest('[data-load-weight-index]');
  if (!input) return;

  const index = Number(input.dataset.loadWeightIndex);
  const value = Math.max(loadScaleMin, Math.min(100000, Number(input.value || defaultMethodVus)));
  loadProfileTargets[index].weight = value;
  saveLoadProfileWorkspace();
  renderLoadTargets();
});

loadTargetsList.addEventListener('click', (event) => {
  if (event.target.closest('input, label')) return;

  const card = event.target.closest('[data-load-card-index]');
  if (!card) return;

  const index = Number(card.dataset.loadCardIndex);
  const key = targetKey(loadProfileTargets[index]);
  expandedLoadTargetKey = expandedLoadTargetKey === key ? null : key;
  renderLoadTargets();
});

loadTargetsList.addEventListener('keydown', (event) => {
  const input = event.target.closest('[data-load-weight-index]');
  if (input && event.key === 'Enter') {
    input.blur();
    return;
  }

  if (!['Enter', ' '].includes(event.key) || event.target.closest('input')) return;

  const card = event.target.closest('[data-load-card-index]');
  if (!card) return;

  event.preventDefault();
  const index = Number(card.dataset.loadCardIndex);
  const key = targetKey(loadProfileTargets[index]);
  expandedLoadTargetKey = expandedLoadTargetKey === key ? null : key;
  renderLoadTargets();
});

loadTargetsList.addEventListener('focusout', (event) => {
  const input = event.target.closest('[data-load-weight-index]');
  if (!input) return;

  const index = Number(input.dataset.loadWeightIndex);
  const value = Math.max(loadScaleMin, Math.min(100000, Number(input.value || defaultMethodVus)));
  if (loadProfileTargets[index].weight !== value) {
    loadProfileTargets[index].weight = value;
    saveLoadProfileWorkspace();
    renderLoadTargets();
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
loadProfileNameInput.addEventListener('input', saveLoadProfileWorkspace);

clearLoadProfileButton.addEventListener('click', () => {
  expandedLoadTargetKey = null;
  selectAllLoadTargets();
  saveLoadProfileWorkspace();
  renderLoadTargets();
});

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

saveLoadProfileButton.addEventListener('click', async () => {
  const name = loadProfileNameInput.value.trim();

  try {
    const data = await requestJson('/api/load-profiles', {
      method: 'POST',
      body: JSON.stringify({ name, targets: loadProfileTargets }),
    });

    loadProfileState.textContent = `Профиль "${data.profile.name}" сохранен: ${data.profile.targetsCount} методов, ${data.profile.totalWeight} VUs.`;
    await refresh();
  } catch (error) {
    loadProfileState.textContent = error.message;
  }
});

commandSelect.dispatchEvent(new Event('change'));
restoreWorkspace();
restoreLoadProfileWorkspace();
if (endpoints.length) {
  syncAllLoadTargets();
}
renderMethods();
renderRoute();
renderLoadMethods();
refresh().catch((error) => {
  statusText.textContent = error.message;
});
