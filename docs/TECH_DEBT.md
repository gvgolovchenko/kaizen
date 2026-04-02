# Kaizen — Технический долг

> Дата анализа: 2026-04-01 | Версия: 1.18.2

---

## Общая оценка: 8/10 (ХОРОШО)

Кодовая база чистая: нет TODO/FIXME/HACK/XXX, нет захардкоженных секретов, console.log полностью мигрирован на pino. Есть тесты (3 файла, все проходят). Основные проблемы — размер файлов и количество silent `.catch(() => {})`.

---

## Критический приоритет

*Нет критических проблем.*

---

## Высокий приоритет

### 1. process-runner.js — 2470 строк

Самый большой файл проекта. Содержит логику для всех типов процессов + smoke testing + checkpoint tracking + деплой.

**Рекомендация:** Разбить на модули:
- `develop-phase.js` — логика develop_release (~500 строк)
- `deploy-phase.js` — логика деплоя (~200 строк)
- `test-runner.js` — run_tests + merge setup (~300 строк)
- Оставить оркестрацию в process-runner.js

### 2. routes/api.js — 2041 строка

Все API-эндпоинты в одном файле. 70+ обработчиков.

**Рекомендация:** Разбить по доменам: `routes/products.js`, `routes/releases.js`, `routes/scenarios.js`, `routes/rc.js`, `routes/gitlab.js`.

### 3. GitLab: токен в URL.password

**Файл:** `server/gitlab-client.js:26`

```javascript
url.password = gl.access_token;
```

Токен передаётся через URL object. Безопасно для execFile, но `url.toString()` включает токен в строку — может утечь в логи при сериализации.

**Рекомендация:** Строить auth URL напрямую строкой, не через URL object.

---

## Средний приоритет

### 4. Silent `.catch(() => {})` — 39 шт.

Молчаливое подавление ошибок через `.catch(() => {})`. Безобидно в контексте cleanup/notification, но затрудняет отладку.

| Файл | Количество |
|------|------------|
| process-runner.js | 21 |
| ai-caller.js | 6 |
| routes/api.js | 5 |
| scenario-runner.js | 3 |
| scheduler.js | 2 |
| gitlab-client.js | 1 |
| smoke-tester.js | 1 |

**Основные категории:**
- git cleanup (merge --abort, branch -D) — допустимо
- уведомления (notify) — допустимо, но лучше логировать
- ROLLBACK — допустимо

**Рекомендация:** Заменить хотя бы для уведомлений на `.catch(err => log.warn(...))`.

### 5. Дублирование git remote setup

**Файлы:** `server/gitlab-client.js` — `pushToGitlab()` и `pushToDefaultBranch()`

Одинаковый код проверки/добавления git remote.

**Рекомендация:** Извлечь в `ensureGitRemote(projectPath, remoteName, authUrl)`.

### 6. Рассинхрон версии в package.json

`package.json` указывает `"version": "1.11.0"`, тогда как CLAUDE.md уже на 1.18.2. Версия в package.json не обновляется при релизах.

**Рекомендация:** Автоматически обновлять version в package.json при публикации релиза или убрать поле.

---

## Низкий приоритет

### 7. Нет линтера и pre-commit хуков

Нет ESLint, Prettier, husky. Нет автоматической проверки кода перед коммитом.

### 8. Тесты — только фронтенд

Есть 3 тест-файла (все проходят), но они тестируют только UI-логику:
- `app-notifications.test.js`
- `process-detail.test.js`
- `releases-status-changes.test.js`

Нет unit/integration тестов для серверного кода (process-runner, scheduler, queue-manager, api routes).

### 9. Playwright как production-зависимость

`playwright` (1.58.2) стоит в `dependencies`, хотя используется только в smoke-tester. Это тяжёлый пакет (~300 МБ с браузерами).

**Рекомендация:** Перенести в `optionalDependencies` или загружать динамически с graceful fallback.

---

## Что чисто

- **Нет TODO/FIXME/HACK/XXX** — единственное совпадение в строке 1258 process-runner.js это текст промпта для AI (инструкция по анализу), а не реальная метка в коде
- **Нет console.log/error/warn** — полная миграция на pino (structured logging). Единственное совпадение `console.error` — это строка в smoke-tester.js, которая ловит console.error от тестируемой страницы через Playwright, а не вызывает его сама
- **Секреты** берутся из .env (`DB_PASSWORD`, `RC_PASSWORD`, `TELEGRAM_BOT_TOKEN`, `GITLAB_TOKEN`). API-ключи маскируются в ответах
- **Нет** `|| true` в скриптах/Dockerfile
- **Нет** закомментированных блоков кода
- Минимальное дублирование (<10 строк)
- Фронтенд (public/js/) — без техдолга
