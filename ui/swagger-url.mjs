import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';

function isPublicIPv4(address) {
  const [a, b] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) ||
    (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0));
}

async function requestPublicUrl(url, signal) {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Нужна ссылка HTTP или HTTPS без логина и пароля в адресе.');
  }
  // Pin the validated DNS result so a second resolution cannot reach a private address.
  const addresses = await dns.lookup(url.hostname, { family: 4, all: true });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(({ address }) => !isPublicIPv4(address))) {
    throw new Error('DNS вернул непубличный адрес, возможна подмена VPN. Используй загрузку файла или сеть без подмены DNS.');
  }
  const transport = url.protocol === 'https:' ? https.request : http.request;
  return new Promise((resolve, reject) => {
    const req = transport(url, {
      signal,
      agent: false,
      headers: { Accept: 'application/json, application/yaml, text/yaml, */*' },
      lookup: (_host, options, callback) => {
        const selected = addresses[0];
        if (options.all) callback(null, [selected]);
        else callback(null, selected.address, selected.family);
      },
    }, resolve);
    req.on('error', reject);
    req.end();
  });
}

export async function downloadSwagger(input) {
  let url;
  try {
    url = new URL(String(input || '').trim());
  } catch {
    throw new Error('Укажи полную ссылку на Swagger/OpenAPI: https://example.com/openapi.json');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const abort = new Promise((_, reject) => controller.signal.addEventListener('abort', () => {
    reject(new Error('Загрузка заняла больше 15 секунд. Проверь доступность ссылки.'));
  }, { once: true }));
  const download = async () => {
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      let response;
      try {
        response = await requestPublicUrl(url, controller.signal);
      } catch (error) {
        if (error.code) throw new Error('Не удалось подключиться к документу. Проверь адрес, сеть и сертификат HTTPS.');
        throw error;
      }
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.destroy();
        const location = response.headers.location;
        if (!location || redirects === 5) throw new Error('Слишком много перенаправлений или отсутствует адрес перехода.');
        url = new URL(location, url);
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.destroy();
        throw new Error(`Не удалось загрузить документ: HTTP ${response.statusCode}. Проверь ссылку и доступ к документу.`);
      }
      const maxBytes = 5 * 1024 * 1024;
      if (Number(response.headers['content-length']) > maxBytes) {
        response.destroy();
        throw new Error('Документ больше 5 МБ.');
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response) {
        size += chunk.length;
        if (size > maxBytes) throw new Error('Документ больше 5 МБ.');
        chunks.push(chunk);
      }
      const content = Buffer.concat(chunks).toString('utf8');
      if (/text\/html/i.test(response.headers['content-type'] || '') || /^\s*<(?:!doctype|html)/i.test(content)) {
        throw new Error('По ссылке открывается HTML-страница. Укажи JSON/YAML спецификацию, например /docs-json или /openapi.json.');
      }
      return { content, name: url.pathname.split('/').pop() || 'openapi' };
    }
  };
  try {
    return await Promise.race([download(), abort]);
  } finally {
    clearTimeout(timer);
  }
}
