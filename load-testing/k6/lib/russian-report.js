function metricValue(metric, key) {
  if (!metric || !metric.values) {
    return null;
  }

  if (metric.values[key] !== undefined) {
    return metric.values[key];
  }

  const percentile = key.match(/^p\((\d+(?:\.\d+)?)\)$/);

  if (percentile) {
    const target = Number(percentile[1]);
    const foundKey = Object.keys(metric.values).find((valueKey) => {
      const found = valueKey.match(/^p\((\d+(?:\.\d+)?)\)$/);
      return found && Number(found[1]) === target;
    });

    if (foundKey) {
      return metric.values[foundKey];
    }
  }

  return null;
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-';
  }

  return Number(value).toFixed(digits);
}

function formatMs(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-';
  }

  if (value >= 1000) {
    return `${formatNumber(value / 1000, 2)} s`;
  }

  return `${formatNumber(value, 0)} ms`;
}

function formatRate(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-';
  }

  return `${formatNumber(value * 100, 2)}%`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusClass(ok) {
  return ok ? 'ok' : 'bad';
}

function thresholdRows(thresholds) {
  return thresholds
    .map((threshold) => {
      const ok = threshold.ok === true;
      return `<tr><td>${escapeHtml(threshold.metric)}</td><td>${escapeHtml(threshold.rule)}</td><td><span class="pill ${statusClass(ok)}">${ok ? 'Пройден' : 'Провален'}</span></td></tr>`;
    })
    .join('');
}

function endpointRows(metrics) {
  const rows = Object.keys(metrics)
    .filter((name) => name.startsWith('endpoint_') && name.endsWith('_duration'))
    .sort()
    .map((name) => {
      const metric = metrics[name];
      const label = name.replace(/^endpoint_/, '').replace(/_duration$/, '').replace(/_/g, ' / ');

      return `<tr>
        <td>${escapeHtml(label)}</td>
        <td>${formatMs(metricValue(metric, 'avg'))}</td>
        <td>${formatMs(metricValue(metric, 'med'))}</td>
        <td>${formatMs(metricValue(metric, 'p(90)'))}</td>
        <td>${formatMs(metricValue(metric, 'p(95)'))}</td>
        <td>${formatMs(metricValue(metric, 'p(99)'))}</td>
        <td>${formatMs(metricValue(metric, 'max'))}</td>
      </tr>`;
    });

  if (rows.length === 0) {
    return '<tr><td colspan="7">Нет отдельных endpoint-метрик для этого сценария.</td></tr>';
  }

  return rows.join('');
}

function summarizeThresholds(metrics) {
  const rows = [];

  for (const [metricName, metric] of Object.entries(metrics)) {
    if (!metric.thresholds) {
      continue;
    }

    for (const [rule, threshold] of Object.entries(metric.thresholds)) {
      rows.push({
        metric: metricName,
        rule,
        ok: threshold.ok,
      });
    }
  }

  return rows;
}

function buildResult(metrics) {
  const thresholds = summarizeThresholds(metrics);
  const thresholdFailed = thresholds.some((threshold) => threshold.ok === false);
  const httpFailedRate = metricValue(metrics.http_req_failed, 'rate') || 0;
  const checksRate = metricValue(metrics.checks, 'rate');
  const checkFailed = checksRate !== null && checksRate < 0.99;
  const hasFailures = thresholdFailed || httpFailedRate > 0 || checkFailed;

  return {
    thresholds,
    hasFailures,
  };
}

function textSummary(data, title) {
  const metrics = data.metrics || {};
  const duration = metrics.http_req_duration;
  const failed = metrics.http_req_failed;
  const checks = metrics.checks;
  const reqs = metrics.http_reqs;
  const iterations = metrics.iterations;
  const result = buildResult(metrics);

  return [
    '',
    `Русский отчет: ${title}`,
    `Статус: ${result.hasFailures ? 'тест не пройден, есть ошибки или проваленные пороги' : 'тест пройден'}`,
    `HTTP ошибок: ${formatRate(metricValue(failed, 'rate'))}`,
    `Проверки: ${formatRate(metricValue(checks, 'rate'))}`,
    `Запросов всего: ${formatNumber(metricValue(reqs, 'count'), 0)}`,
    `Итераций всего: ${formatNumber(metricValue(iterations, 'count'), 0)}`,
    `Latency avg/p95/p99: ${formatMs(metricValue(duration, 'avg'))} / ${formatMs(metricValue(duration, 'p(95)'))} / ${formatMs(metricValue(duration, 'p(99)'))}`,
    '',
  ].join('\n');
}

export function createRussianSummary(data, config = {}) {
  const title = config.title || __ENV.REPORT_TITLE || 'Нагрузочный тест k6';
  const reportPath = __ENV.RU_REPORT || '';
  const metrics = data.metrics || {};
  const duration = metrics.http_req_duration;
  const failed = metrics.http_req_failed;
  const checks = metrics.checks;
  const reqs = metrics.http_reqs;
  const iterations = metrics.iterations;
  const result = buildResult(metrics);
  const thresholds = result.thresholds;
  const hasFailures = result.hasFailures;

  const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7fb;
      --panel: #ffffff;
      --text: #17202a;
      --muted: #687386;
      --line: #dfe5ef;
      --ok: #0f8a53;
      --bad: #b42318;
      --accent: #2457c5;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    main {
      max-width: 1120px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }

    h1 {
      margin: 0 0 8px;
      font-size: 28px;
      letter-spacing: 0;
    }

    h2 {
      margin: 28px 0 12px;
      font-size: 18px;
      letter-spacing: 0;
    }

    .meta {
      color: var(--muted);
      margin-bottom: 24px;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }

    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
    }

    .label {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    .value {
      margin-top: 6px;
      font-size: 24px;
      font-weight: 700;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 3px 9px;
      font-size: 12px;
      font-weight: 700;
    }

    .pill.ok {
      color: var(--ok);
      background: #e8f6ef;
    }

    .pill.bad {
      color: var(--bad);
      background: #fdeceb;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }

    th, td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
      white-space: nowrap;
    }

    th {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0;
      background: #f9fafc;
    }

    tr:last-child td {
      border-bottom: 0;
    }

    .note {
      color: var(--muted);
      margin-top: 16px;
    }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">Сформировано k6. Среда: production. Итог: <span class="pill ${statusClass(!hasFailures)}">${hasFailures ? 'Есть проблемы' : 'Успешно'}</span></div>

    <section class="summary">
      <div class="card"><div class="label">HTTP ошибок</div><div class="value">${formatRate(metricValue(failed, 'rate'))}</div></div>
      <div class="card"><div class="label">Проверки</div><div class="value">${formatRate(metricValue(checks, 'rate'))}</div></div>
      <div class="card"><div class="label">Запросов</div><div class="value">${formatNumber(metricValue(reqs, 'count'), 0)}</div></div>
      <div class="card"><div class="label">Итераций</div><div class="value">${formatNumber(metricValue(iterations, 'count'), 0)}</div></div>
      <div class="card"><div class="label">Среднее время</div><div class="value">${formatMs(metricValue(duration, 'avg'))}</div></div>
      <div class="card"><div class="label">p95</div><div class="value">${formatMs(metricValue(duration, 'p(95)'))}</div></div>
      <div class="card"><div class="label">p99</div><div class="value">${formatMs(metricValue(duration, 'p(99)'))}</div></div>
      <div class="card"><div class="label">Максимум</div><div class="value">${formatMs(metricValue(duration, 'max'))}</div></div>
    </section>

    <h2>Пороги качества</h2>
    <table>
      <thead><tr><th>Метрика</th><th>Условие</th><th>Статус</th></tr></thead>
      <tbody>${thresholdRows(thresholds)}</tbody>
    </table>

    <h2>Разбивка по endpoint</h2>
    <table>
      <thead><tr><th>Endpoint</th><th>Avg</th><th>Med</th><th>p90</th><th>p95</th><th>p99</th><th>Max</th></tr></thead>
      <tbody>${endpointRows(metrics)}</tbody>
    </table>

    <p class="note">Если p95/p99 растут, но HTTP ошибок нет, сервер еще отвечает, но пользовательский опыт уже может ухудшаться. Без серверных метрик этот отчет показывает симптомы со стороны клиента.</p>
  </main>
</body>
</html>`;

  const output = {
    stdout: textSummary(data, title),
  };

  if (reportPath) {
    output[reportPath] = html;
  }

  return output;
}
