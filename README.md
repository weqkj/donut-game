# 🍩 Donut Game

Telegram Mini App: кейсы, лидерборд, профиль, ракета (provably fair, SHA-256), апгрейдер, промокоды/чеки, задания, вывод.
Валюта donut — виртуальная. Пополнение только Telegram Stars: **1 ⭐ = 18 donut**.

```
docs/     сайт для GitHub Pages (фронтенд, без секретов)
worker/   бэкенд на Cloudflare Workers + D1 (бот, Stars, баланс, ракета, админка)
```

Без сервера сайт работает в **демо-режиме** (локально, без Telegram) — удобно смотреть дизайн.

## Запуск (без терминала, всё через GitHub)
1. **GitHub Pages**: Settings → Pages → Deploy from branch → `main` / `/docs`.
2. **Cloudflare** (бесплатно): создай аккаунт → Storage & Databases → D1 → создай базу `donut` → скопируй её ID в `worker/wrangler.toml` (`database_id`).
   Создай API-токен (My Profile → API Tokens → шаблон «Edit Cloudflare Workers» + право D1:Edit) и запомни Account ID.
3. **GitHub** → Settings → Secrets and variables → Actions:
   - Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `BOT_TOKEN` (токен от BotFather), `WEBHOOK_SECRET` (любая случайная строка).
   - Variable: `WORKER_URL` (адрес воркера, `https://donut-game.<твой-аккаунт>.workers.dev`).
4. Actions → «Deploy worker» → Run workflow. Он накатит базу, задеплоит воркер, положит токен в секреты Cloudflare и поставит webhook.
5. В `docs/js/config.js` впиши `API_URL` (тот же адрес воркера).
6. BotFather → Menu Button / `/newapp` → URL `https://<аккаунт>.github.io/donut-game/`.

Обязательная подписка: канал `@nux0ku` уже заведён в `worker/schema.sql` (бот должен быть админом канала).

## Важно
- **Токен бота нельзя хранить в репозитории и на GitHub Pages** — только как секрет Worker.
- Баланс, кейсы, ракета считаются на сервере; сайт ничего не решает сам.
- Ракета: перед раундом публикуется `sha256(seed)`, после — `seed`; формула в `docs/js/fair.js` (идентична `worker/src/fair.js`). Возврат ≈95%, максимум 100x.
- Цены подарков — `docs/data/gifts.json` (звёзды ×18), кейсы и шансы — `docs/data/cases.json`.
- Вывод — заявка, админ подтверждает в админке и отправляет вручную. Проверь правила Telegram для Stars/Mini Apps.

## Ассеты
`docs/assets/{dog,gifts,rockets}/*.webp` — анимации. Пёс/подарки играют один раз (тап — снова), ракета — бесконечно.
Нет: `heart`, NFT-подарки (заглушки), иконки звезды/монеты.
