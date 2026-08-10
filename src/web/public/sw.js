'use strict';

// ТЗ 3.3: офлайн-режим. Кэшируем только статическую "оболочку" приложения
// (стили/скрипты/офлайн-страницу) -- серверный EJS-рендеринг сессионный и
// его кэшировать нельзя. Навигация при отсутствии сети падает на
// /pwa/offline.html, где offline.js работает поверх ранее
// синхронизированных в IndexedDB данных.
//
// PHA-91 QA: кэш ниже cache-first и без билд-пайплайна с хэшами файлов --
// единственный сигнал браузеру перекачать SHELL_ASSETS заново это смена
// самого CACHE_NAME (тогда activate ниже удалит старый ключ, а fetch
// поймает промах кэша и уйдёт в сеть). На iPhone поймали ровно это: styles.css
// закэшировался ДО того, как в нём появилось нужное отчётам правило, и с
// той версией sw.js висел часами, потому что имя кэша не менялось между
// деплоями. Правило: **бампать CACHE_NAME при любом изменении файла из
// SHELL_ASSETS** (styles.css, offline.js, dexie.min.js, manifest,
// offline.html), не только когда правится сам sw.js.
const CACHE_NAME = 'phaeton-shell-v2';
const SHELL_ASSETS = [
  '/styles.css',
  '/offline.js',
  '/vendor/dexie.min.js',
  '/manifest.webmanifest',
  '/pwa/offline.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
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
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/pwa/offline.html'))
    );
    return;
  }

  if (url.origin === self.location.origin && SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
  }
});
