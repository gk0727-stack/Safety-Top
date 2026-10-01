// Safety-Top 서비스워커
//
// 이 앱은 실시간 Firebase 데이터로 동작하는 대시보드라서, "오프라인이어도
// 무조건 예전 캐시를 보여준다" 식으로 만들면 오히려 위험하다(예전 버전이
// 보이거나, 최신 위험작업 정보가 아닌 옛날 정보를 보고 안전조치를 판단할
// 수 있음). 그래서 전략은 최대한 단순하고 보수적으로 간다:
//
//   1) 온라인일 때는 항상 네트워크에서 최신 버전을 받아온다(캐시를 먼저
//      보여주지 않음) — 지금까지 겪었던 "왜 예전 버전이 보이지?" 캐싱
//      혼란을 서비스워커가 더 키우지 않도록 하기 위함.
//   2) 완전히 오프라인일 때만, 마지막으로 접속에 성공했던 화면을 캐시에서
//      대신 보여준다(아예 흰 화면/브라우저 기본 오류 화면이 뜨는 것보다는
//      나음).
//   3) 새 서비스워커가 배포되면 기존 탭을 새로고침하지 않아도 바로
//      교체되도록 skipWaiting/clients.claim을 사용한다.
//   4) Firebase, 폰트(CDN) 등 외부 도메인 요청은 절대 가로채지 않는다 —
//      실시간 데이터/외부 리소스 요청을 캐시 레이어가 방해하면 안 됨.

const CACHE_NAME = 'safety-top-shell-v3';
const APP_SHELL_URL = self.registration.scope; // 이 서비스워커가 등록된 폴더의 index 문서

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(APP_SHELL_URL).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 같은 출처(GitHub Pages)의 GET 문서 요청만 다룬다.
  // Firebase/Firestore/폰트 CDN 등 다른 도메인 요청은 그대로 통과시킨다.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }
  if (req.mode !== 'navigate') {
    return;
  }

  // cache:'no-cache' — 브라우저 HTTP 캐시(GitHub Pages는 약 10분 캐시)에 남아 있는
  // 예전 index.html을 그대로 쓰지 말고, 항상 서버에 "바뀐 게 있는지" 확인하게 한다.
  // (새 버전을 올렸는데 한동안 예전 화면이 보이던 문제 방지)
  event.respondWith(
    fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        // 오프라인용으로는 "앱 화면(index.html)"만 저장한다. 다른 문서(PDF 등)나
        // 오류 페이지(404 등)가 앱 화면 자리에 저장되지 않도록 확인한다.
        const url = new URL(req.url);
        const isAppPage = url.pathname === new URL(APP_SHELL_URL).pathname || url.pathname.endsWith('/index.html');
        const isHtml = (res.headers.get('content-type') || '').includes('text/html');
        if (res.ok && isHtml && isAppPage) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(APP_SHELL_URL, resClone)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(APP_SHELL_URL))
  );
});
