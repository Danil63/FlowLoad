import { suggestCriticalRoute } from './critical-route.js';
import { installScenarioDrag } from './scenario-drag.js';

const workspaceId = new URL(window.location.href).searchParams.get('workspace') || 'default';
let generatorBusy = false;
let generatorWaitTimer = null;
function waitForGenerator() {
  if (generatorWaitTimer) return;
  generatorWaitTimer = window.setTimeout(async () => {
    generatorWaitTimer = null;
    try {
      const data = await requestJson('/api/status');
      generatorBusy = data.generatorBusy;
      updateCustomScenarioControls();
      if (generatorBusy) waitForGenerator();
    } catch { waitForGenerator(); }
  }, 2000);
}
let workspaceMetadata = null;
let editingWorkspace = false;
const workspaceList = document.querySelector('#workspaceList');
const workspaceDialog = document.querySelector('#workspaceDialog');
function openWorkspaceDialog(edit) {
  editingWorkspace = edit;
  document.querySelector('#workspaceDialogTitle').textContent = edit ? 'Настройки окружения' : 'Новое окружение';
  document.querySelector('#workspaceSave').textContent = edit ? 'Сохранить' : 'Создать';
  document.querySelector('#workspaceName').value = edit ? workspaceMetadata.name : '';
  document.querySelector('#workspaceBaseUrl').value = edit ? workspaceMetadata.baseUrl : '';
  document.querySelector('#workspaceError').textContent = '';
  workspaceDialog.showModal();
}
function switchWorkspace(id) {
  if (id === workspaceId) return;
  saveWorkspace();
  saveLoadProfileWorkspace();
  const url = new URL(window.location.href);
  url.searchParams.set('workspace', id);
  window.location.assign(url.href);
}
workspaceList.addEventListener('click', event => {
  const button = event.target.closest('[data-workspace-id]');
  if (button) switchWorkspace(button.dataset.workspaceId);
});
document.querySelector('#workspaceCreate').addEventListener('click', () => openWorkspaceDialog(false));
document.querySelector('#workspaceEdit').addEventListener('click', () => openWorkspaceDialog(true));
document.querySelector('#workspaceCancel').addEventListener('click', () => workspaceDialog.close());
document.querySelector('#workspaceForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = document.querySelector('#workspaceSave');
  button.disabled = true;
  try {
    const data = await requestJson('/api/workspaces', { method: editingWorkspace ? 'PATCH' : 'POST', body: JSON.stringify({
      name: document.querySelector('#workspaceName').value,
      baseUrl: document.querySelector('#workspaceBaseUrl').value,
    }) });
    if (editingWorkspace) { workspaceDialog.close(); await refresh(); }
    else switchWorkspace(data.workspace.id);
  } catch (error) { document.querySelector('#workspaceError').textContent = error.message; }
  finally { button.disabled = false; }
});

const pageNames = { environment: 'Окружение', token: 'Токен', routes: 'Сценарии', load: 'Нагрузка' };
function showPage(focusHeading = false) {
  const requested = window.location.hash.slice(1);
  const page = Object.hasOwn(pageNames, requested) ? requested : 'environment';
  if (page !== requested) history.replaceState(null, '', `#${page}`);
  document.querySelectorAll('[data-page]').forEach(section => {
    section.hidden = section.dataset.page !== page;
  });
  document.querySelectorAll('[data-nav]').forEach(link => {
    if (link.dataset.nav === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const heading = document.querySelector('#pageTitle');
  heading.textContent = pageNames[page];
  document.title = `${pageNames[page]} · k6 Load UI`;
  window.scrollTo(0, 0);
  if (focusHeading) heading.focus({ preventScroll: true });
}
window.addEventListener('hashchange', () => showPage(true));
showPage();

const statusText = document.querySelector('#statusText');
const tokenForm = document.querySelector('#tokenForm');
const tokenInput = document.querySelector('#tokenInput');
const tokenState = document.querySelector('#tokenState');
const tokenCheckButton = document.querySelector('#tokenCheckButton');
const tokenCheckResult = document.querySelector('#tokenCheckResult');
const tokenDeleteButton = document.querySelector('#tokenDeleteButton');
let tokenDeletePending = false;
function resetTokenCheck() {
  tokenCheckMessage = '';
  tokenCheckResult.textContent = '';
  tokenCheckResult.classList.remove('isSuccess');
  tokenRejectedButton.hidden = true;
  tokenRejectedList.replaceChildren();
  tokenRejectedDialog.close();
  rejectedDialogRunId = null;
}
let savedTokensReady = false;
let tokenCheckMessage = '';
let rejectedDialogRunId = null;
const tokenRejectedDialog = document.querySelector('#tokenRejectedDialog');
const tokenRejectedButton = document.querySelector('#tokenRejectedButton');
const tokenRejectedList = document.querySelector('#tokenRejectedList');
tokenRejectedButton.addEventListener('click', () => tokenRejectedDialog.showModal());
document.querySelector('#tokenRejectedClose').addEventListener('click', () => tokenRejectedDialog.close());
tokenRejectedDialog.addEventListener('click', event => {
  const rect = tokenRejectedDialog.getBoundingClientRect();
  if (event.target === tokenRejectedDialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) tokenRejectedDialog.close();
});

function renderTokenCheck(run) {
  const checking = run?.command === 'auth-status' && run.status === 'running';
  tokenDeleteButton.disabled = tokenDeletePending || !savedTokensReady || run?.status === 'running';
  tokenInput.disabled = checking;
  tokenForm.querySelector('button[type="submit"]').disabled = checking;
  document.querySelector('#tokenFileInput').disabled = checking;
  document.querySelector('#tokenImportButton').disabled = checking || !document.querySelector('#tokenFileInput').files.length;
  tokenCheckButton.disabled = !savedTokensReady || run?.status === 'running';
  tokenCheckButton.textContent = checking ? 'Проверка...' : 'Проверить все токены';
  if (!savedTokensReady || run?.tokenCheckStale) { resetTokenCheck(); return; }
  if (run?.command !== 'auth-status') return;
  const matches = [...(run.output || '').matchAll(/TOKEN_CHECK_RESULT (\{[^\r\n]*?\})/g)];
  let result = null;
  try { result = matches.length ? JSON.parse(matches.at(-1)[1]) : null; } catch (_) {}
  result = run.tokenCheck?.summary || result;
  const rejected = (run.tokenCheck?.items || []).filter(item => item.outcome === 'rejected');
  tokenRejectedButton.hidden = checking || !rejected.length;
  if (!checking && rejected.length) {
    tokenRejectedList.replaceChildren(...rejected.map(item => {
      const row = document.createElement('li');
      row.textContent = `Токен №${item.index}: ${item.masked} — невалиден (401)`;
      return row;
    }));
    if (rejectedDialogRunId !== run.id) {
      rejectedDialogRunId = run.id;
      if (!tokenRejectedDialog.open) tokenRejectedDialog.showModal();
    }
  }
  tokenCheckMessage = result
    ? `Проверено ${result.completed} из ${result.total}. Принято: ${result.accepted}. Отклонено (401): ${result.rejected}. Нет доступа (403): ${result.forbidden}. Ошибки сети/API: ${result.errors}. Ещё не проверено: ${result.total - result.completed}.`
    : checking ? 'Проверяем сохранённые токены...' : 'Проверка не завершена. Токены не проверены; проверьте доступность API и k6.';
  if (result && !checking && run.status !== 'passed') tokenCheckMessage += ' Проверка завершена с ошибками или прервана.';
  tokenCheckResult.textContent = tokenCheckMessage;
  tokenCheckResult.classList.toggle('isSuccess', run.status === 'passed' && result?.accepted === result?.total && result?.total > 0);
}
const runForm = document.querySelector('#runForm');
const commandSelect = document.querySelector('#commandSelect');
const usersInput = document.querySelector('#usersInput');
const routeSelectLabel = document.querySelector('#routeSelectLabel');
const routeSelect = document.querySelector('#routeSelect');
const builderRouteSelect = document.querySelector('#builderRouteSelect');
const profileSelectLabel = document.querySelector('#profileSelectLabel');
const profileSelect = document.querySelector('#profileSelect');
const runButton = document.querySelector('#runButton');
const runBadge = document.querySelector('#runBadge');
const runOutput = document.querySelector('#runOutput');
const reportsList = document.querySelector('#reportsList');
const reportsButton = document.querySelector('#reportsButton');
const swaggerInput = document.querySelector('#swaggerInput');
const swaggerUrlForm = document.querySelector('#swaggerUrlForm');
const swaggerUrlInput = document.querySelector('#swaggerUrlInput');
const swaggerUrlButton = document.querySelector('#swaggerUrlButton');
const swaggerUrlStatus = document.querySelector('#swaggerUrlStatus');
const swaggerState = document.querySelector('#swaggerState');
const openMacSwaggerButton = document.querySelector('#openMacSwaggerButton');
const methodSearchInput = document.querySelector('#methodSearchInput');
const routeNameInput = document.querySelector('#routeNameInput');
const methodList = document.querySelector('#methodList');
const methodCount = document.querySelector('#methodCount');
const routeCanvas = document.querySelector('.routeCanvas');
const routeSteps = document.querySelector('#routeSteps');
const addSelectedButton = document.querySelector('#addSelectedButton');
const criticalRouteButton = document.querySelector('#criticalRouteButton');
const connectButton = document.querySelector('#connectButton');
const clearRouteButton = document.querySelector('#clearRouteButton');
const saveRouteButton = document.querySelector('#saveRouteButton');
const routesRefreshButton = document.querySelector('#routesRefreshButton');
const savedRoutesList = document.querySelector('#savedRoutesList');
const loadProfileState = document.querySelector('#loadProfileState');
const loadScenarioSelect = document.querySelector('#loadScenarioSelect');
let loadScenarioFile = '';
let loadScenarioSteps = [];
let loadScenarioRequest = 0;
const loadProfileNameInput = document.querySelector('#loadProfileNameInput');
const loadChart = document.querySelector('.loadChart');
const loadTargetsList = document.querySelector('#loadTargetsList');
const saveLoadProfileButton = document.querySelector('#saveLoadProfileButton');
const clearLoadProfileButton = document.querySelector('#clearLoadProfileButton');
const savedLoadProfilesList = document.querySelector('#savedLoadProfilesList');

let pollTimer = null;
let polledRunId = null;
let uiRunActive = false;
let pollingRequestPending = false;
let endpoints = [];
let selectedEndpointIds = [];
let route = [];
let selectedRouteStep = null;
let savedRoutes = [];
let loadProfileTargets = [];
let savedLoadProfiles = [];
let expandedLoadTargetKey = null;

const workspaceStorageKey = 'bigJourneyK6RouteBuilder' + (workspaceId === 'default' ? '' : `:${workspaceId}`);
let swaggerCatalog = { sources: [], deleted: [] };
const swaggerSourceSelect = document.querySelector('#swaggerSourceSelect');
const deleteSwaggerSource = document.querySelector('#deleteSwaggerSource');
const swaggerDeleteDialog = document.querySelector('#swaggerDeleteDialog');
let pendingSwaggerDelete = null;
function isDeletedMethod(item) {
  return swaggerCatalog.deleted.some(d => item.catalogMethodId ? d.catalogMethodId === item.catalogMethodId
    : d.key === `${String(item.method).toUpperCase()} ${item.path}`);
}
function invalidAttributes(item) {
  return item.invalid ? ' class="invalidScenario" title="некоторые методы были удалены"' : '';
}
function useCatalog(data) {
  swaggerCatalog = data;
  const previous = swaggerSourceSelect.value;
  endpoints = data.sources.flatMap(source => source.endpoints);
  swaggerSourceSelect.innerHTML = '<option value="">Все документы</option>' + data.sources.map(source =>
    `<option value="${escapeHtml(source.id)}">${escapeHtml(source.name)} (${source.endpoints.length})</option>`).join('');
  if (data.sources.some(source => source.id === previous)) swaggerSourceSelect.value = previous;
  deleteSwaggerSource.disabled = !swaggerSourceSelect.value;
  selectedEndpointIds = selectedEndpointIds.filter(id => endpoints.some(e => e.id === id));
  saveWorkspace();
  renderMethods();
  renderRoute();
}
function askSwaggerDelete(sourceId, methodId) {
  pendingSwaggerDelete = { sourceId, methodId };
  document.querySelector('#swaggerDeleteTitle').textContent = methodId ? 'Удалить метод?' : 'Удалить документ?';
  document.querySelector('#swaggerDeleteMessage').textContent = methodId
    ? 'Метод не получится восстановить отдельно. Для повторного добавления потребуется загрузить Swagger заново. Сценарии с этим методом будут недоступны для запуска.'
    : 'Документ и все его методы будут удалены. Сценарии с этими методами будут недоступны для запуска.';
  document.querySelector('#swaggerDeleteError').textContent = '';
  swaggerDeleteDialog.showModal();
}
swaggerSourceSelect.addEventListener('change', () => {
  deleteSwaggerSource.disabled = !swaggerSourceSelect.value;
  renderMethods();
});
deleteSwaggerSource.addEventListener('click', () => askSwaggerDelete(swaggerSourceSelect.value));
document.querySelector('#swaggerDeleteCancel').addEventListener('click', () => swaggerDeleteDialog.close());
document.querySelector('#swaggerDeleteConfirm').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    useCatalog(await requestJson('/api/swagger/catalog', { method: 'DELETE', body: JSON.stringify(pendingSwaggerDelete) }));
    swaggerDeleteDialog.close();
    await refresh();
  } catch (error) { document.querySelector('#swaggerDeleteError').textContent = error.message; }
  finally { button.disabled = false; }
});
const loadProfileStorageKey = 'bigJourneyK6LoadProfileBuilder' + (workspaceId === 'default' ? '' : `:${workspaceId}`);
const defaultMethodVus = 10;
const loadScaleMin = 10;
const loadScaleMax = 1500;
const loadGraphHeight = 220;
const loadGraphTopPad = 18;
const loadGraphBottomPad = 22;
const loadColumnWidth = 126;
const isFileMode = window.location.protocol === 'file:';
let lifecycleConnection = null;

async function requestJson(url, options = {}) {
  if (isFileMode) {
    throw new Error('Интерфейс открыт как файл. Запусти make ui и открой http://127.0.0.1:8790/');
  }

  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers, 'X-Workspace-Id': workspaceId },
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
    reportsList.innerHTML = '<p class="muted emptyState">Отчетов пока нет</p>';
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
  const query = '';
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
  criticalRouteButton.disabled = endpoints.length === 0;
  addSelectedButton.disabled = selectedEndpointIds.length !== 1;
  connectButton.disabled = selectedEndpointIds.length !== 2;
  saveRouteButton.disabled = route.length === 0;
}

function renderMethods() {
  const visibleEndpoints = filteredEndpoints().filter(e => !swaggerSourceSelect.value || e.sourceId === swaggerSourceSelect.value);
  methodCount.textContent = `${visibleEndpoints.length} из ${endpoints.length} методов`;

  if (!endpoints.length) {
    methodList.innerHTML = '<p class="muted emptyState">Пока нет загруженных методов.</p>';
    updateRouteControls();
    return;
  }

  if (!visibleEndpoints.length) {
    methodList.innerHTML = '<p class="muted emptyState">Ничего не найдено. Попробуй другой запрос.</p>';
    updateRouteControls();
    return;
  }

  methodList.innerHTML = visibleEndpoints
    .map((endpoint) => {
      const selected = selectedEndpointIds.includes(endpoint.id) ? ' selected' : '';
      const summary = endpoint.summary ? `<p title="${escapeHtml(endpoint.summary)}">${escapeHtml(endpoint.summary)}</p>` : '';
      const auth = endpoint.authRequired ? '<span class="metaPill">auth</span>' : '<span class="metaPill">public</span>';

      return `<div class="methodCard${selected}" role="button" tabindex="0" draggable="false" data-endpoint-id="${escapeHtml(endpoint.id)}">
        <button class="methodDelete" type="button" data-delete-method="${escapeHtml(endpoint.id)}" title="Удалить метод" aria-label="Удалить метод ${escapeHtml(endpoint.method)} ${escapeHtml(endpoint.path)}">×</button>
        <span class="methodCardTop">
          <span class="${methodClass(endpoint.method)}">${escapeHtml(endpoint.method)}</span>
          <span class="risk risk-${escapeHtml(endpoint.risk)}">${escapeHtml(riskLabel(endpoint.risk))}</span>
        </span>
        <strong title="${escapeHtml(endpoint.path)}">${escapeHtml(endpoint.path)}</strong>
        ${summary}
        <span class="methodMeta">${auth}<span class="metaPill">${escapeHtml(endpoint.tags[0] || 'api')}</span></span>
      </div>`;
    })
    .join('');

  updateRouteControls();
}

function renderRoute() {
  const previousScrollLeft = routeSteps.scrollLeft;
  if (!route.length) {
    routeSteps.className = 'routeSteps empty';
    routeSteps.textContent = 'Перетащи метод из нижней полки сюда или добавь выбранный метод кнопкой.';
    updateRouteControls();
    return;
  }

  routeSteps.className = 'routeSteps';
  routeSteps.innerHTML = route
    .map((step, index) => {
      const summary = step.summary ? `<p title="${escapeHtml(step.summary)}">${escapeHtml(step.summary)}</p>` : '';
      const moveUpDisabled = index === 0 ? ' disabled' : '';
      const moveDownDisabled = index === route.length - 1 ? ' disabled' : '';

      return `<div class="routeStep${selectedRouteStep === step ? ' selected' : ''}" draggable="false" tabindex="0" data-step-index="${index}" aria-label="Шаг ${index + 1}: ${escapeHtml(step.method)} ${escapeHtml(step.path)}">
        <div class="routeStepSurface${isDeletedMethod(step) ? ' invalidScenario' : ''}"${isDeletedMethod(step) ? ' title="некоторые методы были удалены"' : ''}>
        <div class="routeStepIndex">${index + 1}</div>
        <div class="routeStepBody">
          <span class="${methodClass(step.method)}">${escapeHtml(step.method)}</span>
          <strong title="${escapeHtml(step.path)}">${escapeHtml(step.path)}</strong>
          ${summary}
        </div>
        <div class="stepActions">
          <button class="iconButton" type="button" data-action="up" data-index="${index}"${moveUpDisabled} title="Выше">↑</button>
          <button class="iconButton" type="button" data-action="down" data-index="${index}"${moveDownDisabled} title="Ниже">↓</button>
          <button class="iconButton dangerButton" type="button" data-action="remove" data-index="${index}" title="Удалить">×</button>
        </div>
        </div>
        ${index < route.length - 1 ? `<button class="routeInsertArrow" type="button" draggable="false" data-insert-index="${index + 1}" title="Вставить выбранный метод между шагами ${index + 1} и ${index + 2}" aria-label="Вставить между шагами ${index + 1} и ${index + 2}"><span aria-hidden="true"></span></button>` : ''}
      </div>`;
    })
    .join('');

  routeSteps.scrollLeft = previousScrollLeft;
  updateRouteControls();
}

function renderSavedRoutes(routes = []) {
  savedRoutes = routes;
  renderRouteOptions();

  if (!routes.length) {
    savedRoutesList.innerHTML = '<p class="muted emptyState">Сохраненных сценариев пока нет.</p>';
    return;
  }

  savedRoutesList.innerHTML = routes
    .map((savedRoute) => {
      const date = new Date(savedRoute.updatedAt).toLocaleString('ru-RU');
      return `<div class="savedRoute${savedRoute.invalid ? ' invalidScenario' : ''}"${savedRoute.invalid ? ' title="некоторые методы были удалены"' : ''}>
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
  loadScenarioSelect.innerHTML = '<option value="">Выберите сохранённый сценарий</option>' + savedRoutes.map(item => `<option value="${escapeHtml(item.fileName)}"${invalidAttributes(item)}${item.invalid ? ' disabled' : ''}>${escapeHtml(item.name)}${item.invalid ? ' · методы удалены' : ''}</option>`).join('');
  loadScenarioSelect.disabled = !savedRoutes.length;
  if (savedRoutes.some(item => item.fileName === loadScenarioFile)) loadScenarioSelect.value = loadScenarioFile;
  else if (loadScenarioFile) {
    loadScenarioFile = '';
    loadScenarioSteps = [];
    loadProfileTargets = [];
    saveLoadProfileWorkspace();
    renderLoadTargets();
  }
  renderCustomScenarioOptions();
  const selectedBuilderRoute = builderRouteSelect.value;
  builderRouteSelect.innerHTML = `<option value="">${savedRoutes.length ? 'Выбрать сценарий' : 'Нет сохранённых сценариев'}</option>` + savedRoutes
    .map(item => `<option value="${escapeHtml(item.fileName)}"${invalidAttributes(item)}>${escapeHtml(item.name)} (${item.stepsCount})${item.invalid ? ' · методы удалены' : ''}</option>`).join('');
  builderRouteSelect.disabled = savedRoutes.length === 0;
  if (savedRoutes.some(item => item.fileName === selectedBuilderRoute)) builderRouteSelect.value = selectedBuilderRoute;
  if (!savedRoutes.length) {
    routeSelect.innerHTML = '<option value="">Нет сохраненных сценариев</option>';
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
  renderCustomScenarioOptions();
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

function selectedCustomScenario() {
  return [...savedRoutes.map(item => ({ key: `route:${item.fileName}`, command: 'route', file: item.fileName, name: item.name, invalid: item.invalid })),
    ...savedLoadProfiles.map(item => ({ key: `profile:${item.fileName}`, command: 'profile', file: item.fileName, name: item.name, invalid: item.invalid }))]
    .find(item => item.key === commandSelect.value);
}

function updateCustomScenarioControls() {
  const selected = selectedCustomScenario();
  usersInput.disabled = selected?.command !== 'route';
  routeSelect.classList.add('hidden');
  routeSelectLabel.classList.add('hidden');
  profileSelect.classList.add('hidden');
  profileSelectLabel.classList.add('hidden');
  runButton.disabled = generatorBusy || uiRunActive || !selected || selected.invalid;
  runButton.title = selected?.invalid ? 'некоторые методы были удалены' : '';
}

function renderCustomScenarioOptions() {
  const previous = commandSelect.value;
  const group = (label, type, items) => items.length ? `<optgroup label="${label}">${items.map(item => `<option value="${escapeHtml(`${type}:${item.fileName}`)}"${invalidAttributes(item)}${item.invalid ? ' disabled' : ''}>${escapeHtml(item.name)}${item.invalid ? ' · методы удалены' : ''}</option>`).join('')}</optgroup>` : '';
  commandSelect.innerHTML = '<option value="">' + (savedRoutes.length || savedLoadProfiles.length ? 'Выберите сценарий' : 'Нет сохранённых сценариев') + '</option>'
    + group('Сценарии', 'route', savedRoutes) + group('Профили нагрузки', 'profile', savedLoadProfiles);
  commandSelect.disabled = !savedRoutes.length && !savedLoadProfiles.length;
  if ([...commandSelect.options].some(option => option.value === previous)) commandSelect.value = previous;
  updateCustomScenarioControls();
}

function endpointToLoadTarget(endpoint, vus = defaultMethodVus) {
  if (!endpoint) return null;
  return {
    sourceId: endpoint.sourceId,
    catalogMethodId: endpoint.catalogMethodId,
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
  loadProfileTargets = loadScenarioSteps.map((endpoint) => endpointToLoadTarget(endpoint, vus)).filter(Boolean);
  saveLoadProfileWorkspace();
}

function syncAllLoadTargets() {
  const existingTargets = new Map(loadProfileTargets.map((target) => [targetKey(target), target]));
  loadProfileTargets = loadScenarioSteps
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
  if (loadScenarioSteps.length && loadProfileTargets.length === 0) {
    selectAllLoadTargets();
  }
}

function loadProfileTotal() {
  return loadProfileTargets.reduce((sum, target) => sum + Number(target.weight || 0), 0);
}

function matchesLoadQuery(target) {
  const query = '';
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

function loadPointY(weight) {
  const ratio = (Math.max(loadScaleMin, Math.min(loadScaleMax, weight)) - loadScaleMin) / (loadScaleMax - loadScaleMin);
  return Math.round(loadGraphTopPad + (1 - ratio) * (loadGraphHeight - loadGraphTopPad - loadGraphBottomPad));
}

function updateLoadWeight(index, value) {
  if (!loadProfileTargets[index] || !Number.isFinite(value)) return;
  loadProfileTargets[index].weight = Math.max(loadScaleMin, Math.min(100000, Math.round(value)));
  saveLoadProfileWorkspace();
  refreshLoadValues();
}

function refreshLoadValues() {
  const total = loadProfileTotal();
  const points = [];
  loadTargetsList.querySelectorAll('[data-load-target-index]').forEach((element, column) => {
    const target = loadProfileTargets[Number(element.dataset.loadTargetIndex)];
    const weight = target.weight;
    element.style.setProperty('--point-top', `${loadPointY(weight)}px`);
    element.querySelector('.loadPointValue').textContent = weight;
    element.querySelector('.loadPointDot').title = `${weight} VUs`;
    const slider = element.querySelector('.loadRange');
    slider.setAttribute('aria-valuenow', weight);
    const input = element.querySelector('.loadWeightInput');
    if (input !== document.activeElement) input.value = weight;
    element.querySelector('.loadShare').textContent = `${Math.round(weight / total * 100)}% профиля`;
    points.push(`${column * loadColumnWidth + loadColumnWidth / 2},${loadPointY(weight)}`);
  });
  loadTargetsList.querySelector('.loadTrend polyline')?.setAttribute('points', points.join(' '));
  loadTargetsList.querySelectorAll('[data-load-all]').forEach(button => {
    button.setAttribute('aria-pressed', String(loadProfileTargets.every(target => target.weight === Number(button.dataset.loadAll))));
  });
  loadProfileState.textContent = `${loadProfileTargets.length} методов · всего ${total.toLocaleString('ru-RU')} VUs`;
}

function renderLoadTargets() {
  const scrollLeft = loadTargetsList.querySelector('.loadGraphScroller')?.scrollLeft || 0;
  ensureDefaultLoadTargets();
  const total = loadProfileTotal();
  saveLoadProfileButton.disabled = loadProfileTargets.length === 0;

  if (!loadProfileTargets.length) {
    loadTargetsList.className = 'loadTargetsList empty';
    loadTargetsList.textContent = 'Выберите сохранённый сценарий.';
    loadProfileState.textContent = 'Сценарий не выбран';
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
  const gridLines = [1500, 1250, 1000, 750, 500, 250, 10];
  const yForWeight = loadPointY;
  const points = visibleTargets
    .map(({ target }, index) => {
      const x = Math.round(index * loadColumnWidth + loadColumnWidth / 2);
      return `${x},${yForWeight(target.weight)}`;
    })
    .join(' ');
  const axis = gridLines
    .map((value) => `<button type="button" class="loadAxisTick" style="top:${yForWeight(value)}px" data-load-all="${value}" aria-pressed="${loadProfileTargets.every(target => target.weight === value)}" title="${value} VUs на каждый метод" aria-label="Установить ${value} пользователей на каждый метод">${value}</button>`)
    .join('');
  const grid = gridLines
    .map((value) => `<line x1="0" y1="${yForWeight(value)}" x2="${graphWidth}" y2="${yForWeight(value)}"></line>`)
    .join('');
  const targetCards = visibleTargets
    .map(({ target, originalIndex }) => {
      const weight = Number(target.weight || defaultMethodVus);
      const percent = total > 0 ? Math.round((weight / total) * 100) : 0;
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
          <div class="loadRange" role="slider" tabindex="0" aria-orientation="vertical" aria-valuemin="10" aria-valuemax="100000" aria-valuenow="${weight}" data-load-range-index="${originalIndex}" aria-label="VUs для ${escapeHtml(target.method)} ${escapeHtml(target.path)}"></div>
        </div>
        <div class="loadTargetCard">
          <button type="button" class="loadTargetToggle" data-load-card-index="${originalIndex}" aria-expanded="${isExpanded}">
          <div class="loadTargetTop">
            <span class="${methodClass(target.method)}">${escapeHtml(target.method)}</span>
          </div>
          <strong>${escapeHtml(target.path)}</strong>
          </button>
          <div class="loadManualValue">
            <input class="loadWeightInput" type="number" min="10" max="100000" step="1" value="${weight}" data-load-weight-index="${originalIndex}" aria-label="Пользователи для ${escapeHtml(target.method)} ${escapeHtml(target.path)}">
          </div>
          <div class="loadDetails">
            ${summary}
            <span class="loadOperation">${escapeHtml(target.operationId || target.tags[0] || 'api')}</span>
            <span class="loadMetaLine">
              <span>${escapeHtml(auth)}</span>
              <span>${escapeHtml(riskLabel(target.risk))}</span>
              <span class="loadShare">${percent}% профиля</span>
            </span>
            <select data-load-preset-index="${originalIndex}" aria-label="Быстрая нагрузка на ${escapeHtml(target.path)}">
              <option value="">Выбрать VUs</option>
              ${[10, 50, 100, 250, 500, 1000, 1500].map(value => `<option value="${value}">${value} VUs</option>`).join('')}
            </select>
          </div>
        </div>
      </div>`;
    })
    .join('');

  loadTargetsList.innerHTML = `<div class="loadRail">
      <div class="loadAxis">${axis}</div>
    </div>
    <div class="loadGraphScroller">
      <div class="loadGraphInner" style="width:${graphWidth}px; --load-count:${visibleTargets.length}; --load-column-width:${loadColumnWidth}px">
        <svg class="loadTrend" viewBox="0 0 ${graphWidth} ${loadGraphHeight}" preserveAspectRatio="none" aria-hidden="true">
          <g class="loadGrid">${grid}</g>
          <polyline points="${points}"></polyline>
        </svg>
        ${targetCards}
      </div>
    </div>`;
  loadTargetsList.querySelector('.loadGraphScroller').scrollLeft = scrollLeft;
  loadProfileState.textContent = `${loadProfileTargets.length} методов · всего ${total.toLocaleString('ru-RU')} VUs`;
}

function renderSavedLoadProfiles(profiles = []) {
  savedLoadProfiles = profiles;
  renderLoadProfileOptions();

  if (!profiles.length) {
    savedLoadProfilesList.innerHTML = '<p class="muted emptyState">Сохраненных профилей пока нет.</p>';
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
      loadScenarioFile,
      loadScenarioSteps,
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
    loadScenarioFile = saved.loadScenarioFile || '';
    loadScenarioSteps = Array.isArray(saved.loadScenarioSteps) ? saved.loadScenarioSteps : [];
    loadProfileTargets = loadScenarioSteps.length && Array.isArray(saved.loadProfileTargets) ? saved.loadProfileTargets : [];

    if (saved.loadProfileName) {
      loadProfileNameInput.value = saved.loadProfileName;
    }
  } catch (_error) {
    localStorage.removeItem(loadProfileStorageKey);
  }
}

function renderRun(run) {
  uiRunActive = run?.status === 'running';
  updateCustomScenarioControls();
  if (run?.id) polledRunId = run.id;
  renderTokenCheck(run);
  if (run?.command === 'auth-status') return;
  if (!run) {
    setBadge('idle');
    updateCustomScenarioControls();
    if (!runOutput.textContent) {
      runOutput.textContent = 'Запусков еще не было';
    }
    return;
  }

  setBadge(run.status);
  updateCustomScenarioControls();
  runOutput.textContent = run.output || 'Запуск начался...';
  runOutput.scrollTop = runOutput.scrollHeight;
}

async function refresh() {
  const projects = await requestJson('/api/workspaces');
  workspaceList.innerHTML = projects.workspaces.map(item => {
    const active = item.id === workspaceId;
    return `<li><button type="button" class="workspaceRow" data-workspace-id="${escapeHtml(item.id)}" aria-pressed="${active}">
      <span class="workspaceMark" aria-hidden="true">${escapeHtml(item.name.slice(0, 1).toUpperCase())}</span>
      <span class="workspaceDetails"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.baseUrl)}</span></span>
      <span class="workspaceSelection">${active ? 'Выбрано' : 'Выбрать'}</span>
    </button></li>`;
  }).join('');
  document.querySelector('#workspaceCount').textContent = String(projects.workspaces.length);
  workspaceMetadata = projects.workspaces.find(item => item.id === workspaceId);
  document.querySelector('#workspaceActiveName').textContent = workspaceMetadata?.name || 'Окружение не найдено';
  document.querySelector('#workspaceEdit').disabled = !workspaceMetadata;
  document.querySelector('#workspaceApi').textContent = workspaceMetadata?.baseUrl || '';
  let catalog = await requestJson('/api/swagger/catalog');
  if (!catalog.initialized && endpoints.length) {
    catalog = await requestJson('/api/swagger/catalog', { method: 'POST', body: JSON.stringify({ name: 'Ранее загруженный Swagger', endpoints, migrate: true }) });
  }
  useCatalog(catalog);
  const data = await requestJson('/api/status');
  generatorBusy = data.generatorBusy;
  if (generatorBusy && !data.activeRunId) waitForGenerator();
  savedTokensReady = data.tokenReady;
  statusText.textContent = data.tokenReady ? `Токенов сохранено: ${data.tokenCount}` : 'Токены не добавлены.';
  tokenState.textContent = data.tokenReady ? `Сохранено локально · ${data.tokenCount} токенов` : 'Токены не добавлены';
  tokenState.classList.toggle('isSaved', data.tokenReady);
  document.querySelector('#tokenValidation').textContent = data.tokenReady ? 'Действительность токенов не проверена.' : 'Токены нужны для авторизованных сценариев.';
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
        sourceId: step.sourceId,
        catalogMethodId: step.catalogMethodId,
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
  swaggerState.textContent = `Сценарий "${routeNameInput.value}" открыт в конструкторе.`;
}

builderRouteSelect.addEventListener('change', async () => {
  const fileName = builderRouteSelect.value;
  if (!fileName) return;
  builderRouteSelect.disabled = true;
  try {
    await loadSavedRoute(fileName);
    const base = routeNameInput.value;
    let number = 1;
    let copyName = `${base}-copy`;
    while (savedRoutes.some(item => item.name === copyName || item.fileName === `${copyName}.route.json`)) {
      copyName = `${base}-copy-${++number}`;
    }
    routeNameInput.value = copyName;
    saveWorkspace();
    swaggerState.textContent = `Сценарий "${base}" загружен. Новая версия: "${copyName}".`;
  } catch (error) {
    swaggerState.textContent = error.message;
    builderRouteSelect.value = '';
  } finally {
    builderRouteSelect.disabled = savedRoutes.length === 0;
  }
});

async function deleteSavedRoute(fileName) {
  const savedRoute = savedRoutes.find((item) => item.fileName === fileName);
  const name = savedRoute?.name || fileName;

  if (!window.confirm(`Удалить сценарий "${name}"?`)) {
    return;
  }

  await requestJson(`/api/routes/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
  if (routeSelect.value === fileName) {
    routeSelect.value = '';
  }
  await refresh();
  swaggerState.textContent = `Сценарий "${name}" удален.`;
}

async function loadSavedLoadProfile(fileName) {
  const data = await requestJson(`/api/load-profiles/${encodeURIComponent(fileName)}`);
  const profile = data.profile;
  loadScenarioFile = '';
  loadScenarioSelect.value = '';
  loadScenarioSteps = Array.isArray(profile.targets) ? profile.targets : [];

  loadProfileNameInput.value = profile.name || fileName.replace(/\.load\.json$/, '');
  loadProfileTargets = Array.isArray(profile.targets)
    ? profile.targets.map((target) => ({
        sourceId: target.sourceId,
        catalogMethodId: target.catalogMethodId,
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

async function applySwaggerData(data, sourceName) {
  const catalog = await requestJson('/api/swagger/catalog', { method: 'POST', body: JSON.stringify({ name: sourceName || data.name, endpoints: data.endpoints }) });
  useCatalog(catalog);
  swaggerSourceSelect.value = catalog.sources.at(-1).id;
  deleteSwaggerSource.disabled = false;
  selectedEndpointIds = [];
  swaggerState.textContent = `${data.title || sourceName}: найдено ${data.endpoints.length} методов.`;
  saveWorkspace();
  renderMethods();
  renderRoute();
  renderLoadMethods();
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
    sourceId: endpoint.sourceId,
    catalogMethodId: endpoint.catalogMethodId,
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
  const insertion = event.target.closest('[data-insert-index]');
  if (insertion) return Number(insertion.dataset.insertIndex);
  const step = event.target.closest('.routeStep');
  if (!step) return route.length;

  const index = Number(step.dataset.stepIndex);
  const rect = step.getBoundingClientRect();
  return event.clientX > rect.left + rect.width / 2 ? index + 1 : index;
}

function clearDragState() {
  setInsertionPreview(null);
  document.querySelectorAll('.routeInsertArrow.dropTarget').forEach(element => element.classList.remove('dropTarget'));
  routeCanvas.classList.remove('dragOver');
  loadChart.classList.remove('dragOver');
  document.querySelectorAll('.dragging').forEach((element) => {
    element.classList.remove('dragging');
  });
}

function startPolling() {
  pollTimer = window.setInterval(async () => {
    if (pollingRequestPending) return;
    pollingRequestPending = true;
    try {
      const data = await requestJson(`/api/run/${encodeURIComponent(polledRunId || 'current')}`, { signal: AbortSignal.timeout(10000) });
      if (!data.run) throw new Error('Результат запуска недоступен. Возможно, локальный сервер был перезапущен.');
      renderRun(data.run);
      if (!data.run || data.run.status !== 'running') {
        window.clearInterval(pollTimer);
        pollTimer = null;
        await refresh();
      }
    } catch (error) {
      window.clearInterval(pollTimer);
      pollTimer = null;
      tokenCheckResult.textContent = `Не удалось получить результат проверки: ${error.message}. Обновите страницу браузера.`;
      tokenCheckResult.classList.remove('isSuccess');
      runOutput.textContent += `\n${error.message}`;
      renderTokenCheck(null);
    } finally {
      pollingRequestPending = false;
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
    tokenCheckMessage = '';
    tokenRejectedButton.hidden = true;
    tokenRejectedList.replaceChildren();
    tokenCheckResult.textContent = '';
    tokenCheckResult.classList.remove('isSuccess');
    await refresh();
  } catch (error) {
    tokenState.classList.remove('isSaved');
    tokenState.textContent = error.message;
  }
});

const tokenFileInput = document.querySelector('#tokenFileInput');
tokenDeleteButton.addEventListener('click', async () => {
  if (tokenDeleteButton.disabled) return;
  tokenDeletePending = true;
  tokenDeleteButton.disabled = true;
  try {
    await requestJson('/api/token', { method: 'DELETE' });
    savedTokensReady = false;
    tokenInput.value = '';
    tokenFileInput.value = '';
    tokenImportButton.disabled = true;
    tokenImportStatus.textContent = 'Сохранённые токены удалены.';
    resetTokenCheck();
    await refresh();
  } catch (error) {
    tokenImportStatus.textContent = error.message;
  } finally {
    tokenDeletePending = false;
    tokenDeleteButton.disabled = !savedTokensReady || uiRunActive;
  }
});
tokenCheckButton.addEventListener('click', async () => {
  tokenRejectedButton.hidden = true;
  tokenCheckButton.disabled = true;
  tokenCheckResult.textContent = 'Запускаем проверку...';
  tokenCheckResult.classList.remove('isSuccess');
  try {
    const data = await requestJson('/api/run', { method: 'POST', body: JSON.stringify({ command: 'auth-status' }) });
    renderRun(data.run);
    if (!pollTimer) startPolling();
  } catch (error) {
    tokenCheckResult.textContent = error.message;
    tokenCheckButton.disabled = !savedTokensReady;
  }
});
const tokenHelpDialog = document.querySelector('#tokenHelpDialog');
document.querySelector('#tokenHelpButton').addEventListener('click', () => tokenHelpDialog.showModal());
document.querySelector('#tokenHelpClose').addEventListener('click', () => tokenHelpDialog.close());
tokenHelpDialog.addEventListener('click', event => {
  const bounds = tokenHelpDialog.getBoundingClientRect();
  if (event.target === tokenHelpDialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) {
    tokenHelpDialog.close();
  }
});
const tokenImportButton = document.querySelector('#tokenImportButton');
const tokenImportStatus = document.querySelector('#tokenImportStatus');
tokenFileInput.addEventListener('change', () => {
  tokenImportButton.disabled = !tokenFileInput.files.length;
  tokenImportStatus.textContent = '';
});
tokenImportButton.addEventListener('click', async () => {
  const file = tokenFileInput.files[0];
  if (!file) return;
  tokenImportButton.disabled = true;
  tokenImportStatus.textContent = 'Сохранение...';
  try {
    if (file.size > 1024 * 1024) throw new Error('Файл должен быть не больше 1 МБ');
    await requestJson('/api/token', { method: 'POST', body: JSON.stringify({ content: await file.text() }) });
    tokenFileInput.value = '';
    tokenInput.value = '';
    tokenImportStatus.textContent = 'Файл импортирован';
    tokenRejectedButton.hidden = true;
    tokenRejectedList.replaceChildren();
    tokenCheckMessage = '';
    tokenCheckResult.textContent = '';
    tokenCheckResult.classList.remove('isSuccess');
    await refresh();
  } catch (error) {
    tokenImportStatus.textContent = error.message;
  } finally {
    tokenImportButton.disabled = !tokenFileInput.files.length;
  }
});

runForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const selected = selectedCustomScenario();
  if (!selected) { runOutput.textContent = 'Выберите сохранённый сценарий.'; return; }
  if (selected.invalid) { runOutput.textContent = 'Некоторые методы были удалены.'; return; }
  const command = selected.command;
  const users = usersInput.value.trim();
  const routeFile = command === 'route' ? selected.file : '';
  const profileFile = command === 'profile' ? selected.file : '';

  try {
    if (command === 'route' && !routeFile) {
      throw new Error('Выбери сохраненный сценарий для запуска.');
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
  updateCustomScenarioControls();
});

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

    await applySwaggerData(data, file.name);
  } catch (error) {
    swaggerState.textContent = error.message;
  } finally {
    swaggerInput.value = '';
  }
});

openMacSwaggerButton.addEventListener('click', () => {
  swaggerInput.click();
});

swaggerUrlForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (swaggerUrlButton.disabled) return;
  swaggerUrlButton.disabled = true;
  openMacSwaggerButton.disabled = true;
  swaggerInput.disabled = true;
  swaggerUrlForm.setAttribute('aria-busy', 'true');
  swaggerUrlButton.textContent = 'Загрузка...';
  swaggerUrlStatus.textContent = 'Загрузка документа...';
  try {
    const data = await requestJson('/api/swagger/url', {
      method: 'POST',
      body: JSON.stringify({ url: swaggerUrlInput.value.trim() }),
    });
    await applySwaggerData(data, data.name);
    swaggerUrlStatus.textContent = `Загружено методов: ${data.endpoints.length}.`;
  } catch (error) {
    swaggerUrlStatus.textContent = error.message;
  } finally {
    swaggerUrlButton.disabled = false;
    openMacSwaggerButton.disabled = false;
    swaggerInput.disabled = false;
    swaggerUrlForm.removeAttribute('aria-busy');
    swaggerUrlButton.textContent = 'Загрузить по ссылке';
  }
});


methodSearchInput.addEventListener('input', renderMethods);
loadScenarioSelect.addEventListener('change', async () => {
  const request = ++loadScenarioRequest;
  loadScenarioFile = loadScenarioSelect.value;
  loadScenarioSteps = [];
  loadProfileTargets = [];
  renderLoadTargets();
  saveLoadProfileWorkspace();
  if (!loadScenarioFile) return;
  loadProfileState.textContent = 'Загрузка сценария...';
  try {
    const data = await requestJson(`/api/routes/${encodeURIComponent(loadScenarioFile)}`);
    if (request !== loadScenarioRequest) return;
    loadScenarioSteps = (data.route.steps || []).map(step => ({ ...step, tags: step.tags || [] }));
    loadProfileNameInput.value = `${data.route.name}-load`;
    selectAllLoadTargets();
    renderLoadTargets();
    loadProfileState.textContent = `${loadProfileTargets.length} методов · всего ${loadProfileTotal()} VUs`;
    commandSelect.value = '';
    updateCustomScenarioControls();
  } catch (error) {
    if (request === loadScenarioRequest) loadProfileState.textContent = error.message;
  }
});

methodList.addEventListener('click', (event) => {
  const remove = event.target.closest('[data-delete-method]');
  if (remove) {
    const endpoint = selectedEndpoint(remove.dataset.deleteMethod);
    if (endpoint) askSwaggerDelete(endpoint.sourceId, endpoint.catalogMethodId);
    return;
  }
  const card = event.target.closest('[data-endpoint-id]');
  if (!card) return;

  selectedRouteStep = null;
  toggleEndpointSelection(card.dataset.endpointId);
  renderRoute();
});
methodList.addEventListener('keydown', event => {
  if (event.target.matches('[data-endpoint-id]') && ['Enter', ' '].includes(event.key)) {
    event.preventDefault();
    event.target.click();
  }
});

const scenarioDrag = installScenarioDrag({
  shelf: methodList,
  board: routeSteps,
  canvas: routeCanvas,
  resolveSource(card) {
    if (card.dataset.endpointId) {
      const endpoint = selectedEndpoint(card.dataset.endpointId);
      return endpoint ? { endpoint } : null;
    }
    const step = route[Number(card.dataset.stepIndex)];
    return step ? { step } : null;
  },
  insert(source, index) {
    if (source.endpoint) addEndpointToRoute(source.endpoint, index);
    else {
      const from = route.indexOf(source.step);
      if (from < 0) return;
      moveRouteStepTo(from, index);
    }
    selectedRouteStep = null;
    selectedEndpointIds = [];
    renderMethods();
    renderRoute();
  },
});

addSelectedButton.addEventListener('click', () => {
  addEndpointToRoute(selectedEndpoint(selectedEndpointIds[0]));
  selectedEndpointIds = [];
  renderMethods();
  renderRoute();
});

criticalRouteButton.addEventListener('click', () => {
  const suggestion = suggestCriticalRoute(endpoints);
  if (!suggestion.steps.length) {
    swaggerState.textContent = `Критический путь открытия игры не определён: отсутствуют GET ${suggestion.missing.join(', GET ')}. Текущий сценарий сохранён.`;
    return;
  }
  if (route.length && !window.confirm('Заменить текущий сценарий критическим путём открытия игры?')) return;
  route = suggestion.steps.map(endpointToRouteStep);
  routeNameInput.value = 'critical-game-open';
  selectedEndpointIds = [];
  saveWorkspace();
  renderMethods();
  renderRoute();
  const missing = suggestion.missing.length ? ` Недоступные шаги: ${suggestion.missing.join(', ')}.` : '';
  swaggerState.textContent = `Открытие игры: ${route.length} шагов. Используется готовая сессия; вход через Яндекс и полёт не включены.${missing}`;
});

connectButton.addEventListener('click', () => {
  selectedEndpointIds.map(selectedEndpoint).forEach((endpoint) => addEndpointToRoute(endpoint));
  selectedEndpointIds = [];
  renderMethods();
  renderRoute();
});

function setInsertionPreview(arrow) {
  if (scenarioDrag.isDragging()) return;
  document.querySelectorAll('.insertionPreview').forEach(element => element.classList.remove('insertionPreview'));
  if (!arrow) return;
  const sourceIndex = route.indexOf(selectedRouteStep);
  let source = sourceIndex >= 0 ? routeSteps.querySelector(`[data-step-index="${sourceIndex}"]`) : null;
  if (!source && selectedEndpointIds.length === 1) {
    source = [...methodList.querySelectorAll('[data-endpoint-id]')].find(card => card.dataset.endpointId === selectedEndpointIds[0]);
  }
  if (!source) source = document.querySelector('.dragging');
  if (source) {
    source.classList.add('insertionPreview');
    arrow.classList.add('insertionPreview');
  }
}
routeSteps.addEventListener('pointerover', event => setInsertionPreview(event.target.closest('[data-insert-index]')));
routeSteps.addEventListener('pointerout', event => setInsertionPreview(event.relatedTarget instanceof Element ? event.relatedTarget.closest('[data-insert-index]') : null));
routeSteps.addEventListener('focusin', event => setInsertionPreview(event.target.closest('[data-insert-index]')));
routeSteps.addEventListener('focusout', () => setInsertionPreview(null));

routeSteps.addEventListener('click', (event) => {
  setInsertionPreview(null);
  const insertion = event.target.closest('[data-insert-index]');
  if (insertion) {
    const target = Number(insertion.dataset.insertIndex);
    const source = route.indexOf(selectedRouteStep);
    if (source >= 0) moveRouteStepTo(source, target);
    else if (selectedEndpointIds.length === 1) {
      addEndpointToRoute(selectedEndpoint(selectedEndpointIds[0]), target);
      selectedEndpointIds = [];
      renderMethods();
    } else {
      swaggerState.textContent = 'Выберите один метод, затем нажмите стрелку между шагами.';
      return;
    }
    selectedRouteStep = null;
    renderRoute();
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) {
    const card = event.target.closest('[data-step-index]');
    if (!card) return;
    const step = route[Number(card.dataset.stepIndex)];
    selectedRouteStep = selectedRouteStep === step ? null : step;
    selectedEndpointIds = [];
    renderMethods();
    routeSteps.querySelectorAll('[data-step-index]').forEach(element => element.classList.toggle('selected', route[Number(element.dataset.stepIndex)] === selectedRouteStep));
    return;
  }

  const index = Number(button.dataset.index);
  selectedRouteStep = null;
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

routeSteps.addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.routeStep')) {
    event.preventDefault();
    event.target.click();
  }
});

loadTargetsList.addEventListener('input', (event) => {
  const input = event.target.closest('[data-load-weight-index]');
  if (input && input.value !== '' && input.validity.valid) {
    updateLoadWeight(Number(input.dataset.loadWeightIndex), Number(input.value));
  }
});

loadTargetsList.addEventListener('change', (event) => {
  const preset = event.target.closest('[data-load-preset-index]');
  if (preset?.value) {
    updateLoadWeight(Number(preset.dataset.loadPresetIndex), Number(preset.value));
    preset.value = '';
  }
});

loadTargetsList.addEventListener('click', (event) => {
  const bulk = event.target.closest('[data-load-all]');
  if (bulk) {
    const value = Number(bulk.dataset.loadAll);
    loadProfileTargets.forEach(target => { target.weight = value; });
    saveLoadProfileWorkspace();
    refreshLoadValues();
    return;
  }
  if (event.target.closest('input, label')) return;

  const card = event.target.closest('[data-load-card-index]');
  if (!card) return;

  const index = Number(card.dataset.loadCardIndex);
  const key = targetKey(loadProfileTargets[index]);
  expandedLoadTargetKey = expandedLoadTargetKey === key ? null : key;
  renderLoadTargets();
});

loadTargetsList.addEventListener('keydown', (event) => {
  const slider = event.target.closest('[data-load-range-index]');
  if (slider) {
    const index = Number(slider.dataset.loadRangeIndex);
    const changes = { ArrowUp: 10, ArrowRight: 10, ArrowDown: -10, ArrowLeft: -10, PageUp: 100, PageDown: -100 };
    if (event.key in changes || ['Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const value = event.key === 'Home' ? loadScaleMin : event.key === 'End' ? loadScaleMax : loadProfileTargets[index].weight + changes[event.key];
      updateLoadWeight(index, value);
    }
    return;
  }
  const input = event.target.closest('[data-load-weight-index]');
  if (input && event.key === 'Enter') {
    input.blur();
    return;
  }

  if (!['Enter', ' '].includes(event.key) || event.target.closest('input, button, select')) return;

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
  const value = input.value === '' ? loadProfileTargets[index].weight : Number(input.value);
  updateLoadWeight(index, value);
  input.value = loadProfileTargets[index].weight;
});

let loadPointer = null;
function moveLoadPoint(event) {
  if (!loadPointer || event.pointerId !== loadPointer.id) return;
  const { slider, index } = loadPointer;
  const y = event.clientY - slider.getBoundingClientRect().top;
  const ratio = 1 - (y - loadGraphTopPad) / (loadGraphHeight - loadGraphTopPad - loadGraphBottomPad);
  const value = Math.round((loadScaleMin + Math.max(0, Math.min(1, ratio)) * (loadScaleMax - loadScaleMin)) / 10) * 10;
  updateLoadWeight(index, value);
}
loadTargetsList.addEventListener('pointerdown', (event) => {
  const slider = event.target.closest('[data-load-range-index]');
  if (!slider || event.button !== 0) return;
  event.preventDefault();
  slider.focus();
  slider.setPointerCapture(event.pointerId);
  loadPointer = { slider, index: Number(slider.dataset.loadRangeIndex), id: event.pointerId };
  moveLoadPoint(event);
});
loadTargetsList.addEventListener('pointermove', moveLoadPoint);
loadTargetsList.addEventListener('pointerup', () => { loadPointer = null; });
loadTargetsList.addEventListener('pointercancel', () => { loadPointer = null; });

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

    swaggerState.textContent = `Сценарий "${data.route.name}" сохранен: ${data.route.stepsCount} шагов.`;
    await refresh();
    builderRouteSelect.value = data.route.fileName;
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
    commandSelect.value = `profile:${data.profile.fileName}`;
    updateCustomScenarioControls();
  } catch (error) {
    loadProfileState.textContent = error.message;
  }
});

commandSelect.dispatchEvent(new Event('change'));
restoreWorkspace();
restoreLoadProfileWorkspace();
if (loadScenarioSteps.length) {
  syncAllLoadTargets();
}
renderMethods();
renderRoute();
renderLoadMethods();
if (isFileMode) {
  statusText.textContent = 'Открыто как файл. Запусти make ui и открой http://127.0.0.1:8790/';
  tokenState.textContent = 'Локальный web-интерфейс работает только через сервер.';
  runOutput.textContent = 'Закрой эту вкладку file:// и запусти: make ui';
  runButton.disabled = true;
} else {
  lifecycleConnection = new EventSource('/api/lifecycle');
  refresh().catch((error) => {
    statusText.textContent = error.message;
  });
}
