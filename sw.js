/* =====================================================
 * sw.js — Service Worker
 * 作用域：与站点根目录相同（GitHub Pages 的 /ExamHub/ 子路径下同样成立，
 * 因为所有预缓存路径都以 registration.scope 为基准解析）。
 *
 * 策略：
 *   - 导航请求（mode=navigate）→ 网络优先，失败回落 index.html 缓存（离线可用）
 *   - 同源静态资源        → 缓存优先并后台更新（stale-while-revalidate）
 *   - 跨域请求            → 不拦截
 *
 * 改动站点文件后请同步修改 VERSION，旧缓存会在 activate 时清理。
 * ===================================================== */
"use strict";

const VERSION = "2026.11.03-3";
const CACHE = "examhub-" + VERSION;

/* 应用外壳：离线时要能完整打开并学习，所以题库（~1MB）也一并预缓存 */
const CORE = [
  "./",
  "index.html",
  "css/style.css",
  "js/marked.min.js",
  "js/srs.js",
  "js/app.js",
  "data/questions.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-192.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
];

const abs = (p) => new URL(p, self.registration.scope).href;
const INDEX = abs("index.html");

/* ---------- 安装：预缓存 + 立即接管 ---------- */
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // 单个资源 404 不应让整次安装失败，因此逐个 add 并吞掉错误
      await Promise.allSettled(
        CORE.map((p) => cache.add(new Request(abs(p), { cache: "reload" })))
      );
      await self.skipWaiting();
    })()
  );
});

/* ---------- 激活：清掉旧版本缓存 ---------- */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("examhub-") && k !== CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

/* ---------- 取回 ---------- */
async function handleNavigate(request) {
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      const cache = await caches.open(CACHE);
      cache.put(INDEX, res.clone());
    }
    return res;
  } catch (err) {
    const cache = await caches.open(CACHE);
    return (
      (await cache.match(request, { ignoreSearch: true })) ||
      (await cache.match(INDEX)) ||
      new Response(
        "<!doctype html><meta charset=utf-8><title>ExamHub</title>" +
          "<p style=\"font:16px/1.7 system-ui;padding:2em\">离线状态下没有找到缓存页面，请联网后重新打开一次。</p>",
        { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
      )
    );
  }
}

async function handleAsset(request, event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });

  const network = fetch(request)
    .then((res) => {
      if (res && res.ok && (res.type === "basic" || res.type === "default")) {
        cache.put(request, res.clone());
      }
      return res;
    })
    .catch(() => null);

  // 有缓存先给缓存（秒开），后台顺手更新；无缓存则等网络
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const res = await network;
  return res || new Response("", { status: 504, statusText: "Offline" });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 跨域（如外链）交给浏览器

  if (request.mode === "navigate") {
    event.respondWith(handleNavigate(request));
    return;
  }
  event.respondWith(handleAsset(request, event));
});

/* ---------- 与页面通信 ---------- */
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
