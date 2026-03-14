# Kaizen — Руководство по деплою через GitLab CI/CD

> Версия 1.12.0 | 2026-03-14

---

## Что это

Kaizen умеет автоматически деплоить продукты через GitLab CI/CD:

1. **После develop_release** — ветка автоматически пушится в GitLab
2. **При push в main** — GitLab Runner собирает фронтенд и деплоит на сервер
3. **При публикации релиза** — опционально запускается авто-деплой

```
[Kaizen develop_release]
  → git commit + push ветки в GitLab
  → Merge Request / merge в main
  → GitLab CI/CD pipeline:
      build-front (npm ci + build)  →  deploy (rsync + composer/npm)
  → Приложение обновлено на сервере
```

---

## Что было сделано для A-CDM (эталонный пример)

### Исходные данные

| Параметр | Значение |
|----------|---------|
| GitLab | `http://192.168.206.48` |
| Проект | `rivc/acdm-web` (ID: 14) |
| Сервер деплоя | `192.168.196.213` (Astra Linux) |
| Стек | Laravel 11 (back/) + Vue 3 + Vite (front/) |
| Метод | rsync (нет Docker на сервере) |

### Что настроено

1. **SSH-ключ** для CI → сервер деплоя (ed25519)
2. **GitLab CI/CD Variables**: `SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS`
3. **`.gitlab-ci.yml`** в репозитории — 2 стадии: build + deploy
4. **Deploy config** в Kaizen — JSONB `deploy` в продукте A-CDM
5. **rsync** установлен на сервере 213

### Pipeline A-CDM

```yaml
stages:
  - build    # npm ci + vite build → front/www/ (артефакт)
  - deploy   # rsync back/ + composer install + rsync front/www/
```

- **build-front**: ~60с (node:22-alpine в Docker)
- **deploy**: ~18с (rsync через SSH)

---

## Как настроить для нового проекта

### Шаг 1. Подготовка GitLab

**1.1. Создать проект в GitLab** (если ещё нет):
```
http://192.168.206.48 → New Project → rivc/<project-name>
```

**1.2. Узнать Project ID**:
```bash
curl -s --header "PRIVATE-TOKEN: <token>" \
  "http://192.168.206.48/api/v4/projects?search=<name>" \
  | python3 -c "import json,sys; [print(f'ID: {p[\"id\"]}, Path: {p[\"path_with_namespace\"]}') for p in json.load(sys.stdin)]"
```

**1.3. Получить или создать Personal Access Token**:
- GitLab → User Settings → Access Tokens
- Scopes: `api`, `read_repository`, `write_repository`

### Шаг 2. SSH-ключ для деплоя

**2.1. Сгенерировать ключ**:
```bash
ssh-keygen -t ed25519 -C "gitlab-ci-deploy@<project>" -f /tmp/deploy-key -N ""
```

**2.2. Добавить публичный ключ на сервер деплоя**:
```bash
ssh <user>@<deploy-host> "mkdir -p ~/.ssh && echo '$(cat /tmp/deploy-key.pub)' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

**2.3. Проверить**:
```bash
ssh -i /tmp/deploy-key <user>@<deploy-host> "echo OK"
```

**2.4. Добавить переменные в GitLab CI/CD**:

```bash
# SSH_PRIVATE_KEY (env_var, НЕ file)
curl -s -X POST "http://192.168.206.48/api/v4/projects/<PROJECT_ID>/variables" \
  --header "PRIVATE-TOKEN: <token>" \
  --form "key=SSH_PRIVATE_KEY" \
  --form "value=$(cat /tmp/deploy-key)" \
  --form "variable_type=env_var" \
  --form "protected=false"

# SSH_KNOWN_HOSTS
curl -s -X POST "http://192.168.206.48/api/v4/projects/<PROJECT_ID>/variables" \
  --header "PRIVATE-TOKEN: <token>" \
  --form "key=SSH_KNOWN_HOSTS" \
  --form "value=$(ssh-keyscan -H <deploy-host> 2>/dev/null)" \
  --form "variable_type=env_var" \
  --form "protected=false"
```

**2.5. Убедиться что на сервере деплоя установлен rsync**:
```bash
ssh <user>@<deploy-host> "which rsync || sudo apt-get install -y rsync"
```

### Шаг 3. `.gitlab-ci.yml`

Создать файл в корне репозитория. Шаблоны ниже.

#### Шаблон: Laravel + Vue SPA (как A-CDM)

```yaml
stages:
  - build
  - deploy

build-front:
  stage: build
  image: node:22-alpine
  tags:
    - deploy-php          # тег runner на 192.168.206.48
  script:
    - cd front
    - npm ci
    - npm run build
  artifacts:
    paths:
      - front/www/        # или front/dist/ — куда собирается SPA
    expire_in: 1 hour
  rules:
    - if: $CI_COMMIT_BRANCH == "main"

deploy:
  stage: deploy
  image: alpine:latest
  tags:
    - deploy-php
  needs:
    - build-front
  before_script:
    - apk add --no-cache openssh-client rsync
    - eval $(ssh-agent -s)
    - echo "$SSH_PRIVATE_KEY" | tr -d '\r' > /tmp/deploy_key
    - chmod 400 /tmp/deploy_key
    - ssh-add /tmp/deploy_key
    - rm /tmp/deploy_key
    - mkdir -p ~/.ssh && chmod 700 ~/.ssh
    - echo "$SSH_KNOWN_HOSTS" >> ~/.ssh/known_hosts
  script:
    # Backend
    - rsync -avz --delete --exclude='.env' --exclude='vendor/' --exclude='storage/' --exclude='bootstrap/cache/' back/ <user>@<host>:/var/www/<project>/back/
    - ssh <user>@<host> "cd /var/www/<project>/back && composer install --no-dev --optimize-autoloader --no-interaction && php artisan config:cache && php artisan route:cache"
    # Frontend
    - rsync -avz --delete front/www/ <user>@<host>:/var/www/<project>/front/www/
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
  environment:
    name: production
    url: http://<host>:<port>
```

#### Шаблон: Node.js (Express/Nuxt) + pm2

```yaml
stages:
  - deploy

deploy:
  stage: deploy
  image: alpine:latest
  tags:
    - deploy-php
  before_script:
    - apk add --no-cache openssh-client rsync
    - eval $(ssh-agent -s)
    - echo "$SSH_PRIVATE_KEY" | tr -d '\r' > /tmp/deploy_key
    - chmod 400 /tmp/deploy_key
    - ssh-add /tmp/deploy_key
    - rm /tmp/deploy_key
    - mkdir -p ~/.ssh && chmod 700 ~/.ssh
    - echo "$SSH_KNOWN_HOSTS" >> ~/.ssh/known_hosts
  script:
    - rsync -avz --delete --exclude='.env' --exclude='node_modules/' --exclude='.git/' . <user>@<host>:/opt/<project>/
    - ssh <user>@<host> "cd /opt/<project> && npm ci --production && pm2 restart <pm2-name>"
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
  environment:
    name: production
```

#### Шаблон: Docker Compose

```yaml
stages:
  - build
  - deploy

build:
  stage: build
  image: docker:latest
  tags:
    - deploy-php
  services:
    - docker:dind
  before_script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
  script:
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA
    - docker tag $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA $CI_REGISTRY_IMAGE:latest
    - docker push $CI_REGISTRY_IMAGE:latest
  rules:
    - if: $CI_COMMIT_BRANCH == "main"

deploy:
  stage: deploy
  image: alpine:latest
  tags:
    - deploy-php
  needs:
    - build
  before_script:
    - apk add --no-cache openssh-client
    - eval $(ssh-agent -s)
    - echo "$SSH_PRIVATE_KEY" | tr -d '\r' > /tmp/deploy_key
    - chmod 400 /tmp/deploy_key
    - ssh-add /tmp/deploy_key
    - rm /tmp/deploy_key
    - mkdir -p ~/.ssh && chmod 700 ~/.ssh
    - echo "$SSH_KNOWN_HOSTS" >> ~/.ssh/known_hosts
  script:
    - ssh <user>@<host> "cd /opt/<project> && docker compose pull && docker compose up -d"
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
  environment:
    name: production
```

### Шаг 4. Настройка в Kaizen

Через UI (таб «Деплой» на странице продукта) или API:

```bash
curl -X PUT http://localhost:3034/api/products/<product_id> \
  -H "Content-Type: application/json" \
  -d '{
    "deploy": {
      "gitlab": {
        "url": "http://192.168.206.48",
        "project_id": <ID>,
        "remote_url": "http://oauth2:<token>@192.168.206.48/rivc/<project>.git",
        "default_branch": "main",
        "access_token": "<token>"
      },
      "target": {
        "host": "192.168.196.213",
        "port": 22,
        "user": "opii",
        "method": "native"
      },
      "auto_deploy": {
        "on_publish": false
      }
    }
  }'
```

### Шаг 5. Проверить Runner

Убедиться что shared runners включены для проекта:
```bash
curl -s -X PUT "http://192.168.206.48/api/v4/projects/<ID>" \
  --header "PRIVATE-TOKEN: <token>" \
  --data "shared_runners_enabled=true"
```

Доступные runners на `192.168.206.48`:

| Runner | Теги | Тип | Executor |
|--------|------|-----|----------|
| #2 opii-gitlab2 | `deploy-dotnet`, `deploy-php` | shared | Docker |
| #4 (без имени) | `RIVC` | shared, run_untagged | shell |

Для jobs с Docker-образами (`image:`) используй теги `deploy-php` или `deploy-dotnet`.

---

## Как пользоваться

### Автоматический деплой при push

После настройки — каждый push в `main` автоматически запускает pipeline:

```bash
git push origin main
# → GitLab CI/CD: build → deploy → приложение обновлено
```

### Деплой через Kaizen (после develop_release)

1. Kaizen выполняет `develop_release` → создаёт ветку, коммитит код
2. Если `deploy.gitlab` настроен — ветка автоматически пушится в GitLab
3. Создайте Merge Request в GitLab и мержите в `main`
4. Pipeline запускается автоматически

### Авто-деплой при публикации релиза

Включите в настройках продукта:
- UI: таб «Деплой» → чекбокс «Авто-деплой при публикации релиза»
- API: `deploy.auto_deploy.on_publish: true`

При `POST /releases/:id/publish` Kaizen автоматически:
1. Мержит ветку релиза в default branch
2. Пушит в GitLab
3. Ожидает завершения CI/CD pipeline
4. Логирует результат

### Ручной деплой через MCP

```
> Задеплой релиз A-CDM v2.1.0
```

Claude Code вызовет `kaizen_deploy_release` → мерж + push → pipeline.

### Генерация CI-файлов

Kaizen может сгенерировать `.gitlab-ci.yml` и `Dockerfile` по стеку продукта:

- UI: таб «Деплой» → кнопки «Сгенерировать»
- MCP: `kaizen_generate_ci`
- API: `POST /api/products/:id/generate-ci`

### Мониторинг pipeline

- UI: http://192.168.206.48/rivc/<project>/-/pipelines
- MCP: `kaizen_deploy_status` (по SHA коммита)
- API: `GET /api/products/:id/pipeline-status?sha=<sha>`

---

## Чеклист для нового проекта

- [ ] Проект в GitLab (`http://192.168.206.48`)
- [ ] Access Token с правами `api`, `read_repository`, `write_repository`
- [ ] SSH-ключ сгенерирован и добавлен на сервер деплоя
- [ ] CI/CD Variables в GitLab: `SSH_PRIVATE_KEY` (env_var), `SSH_KNOWN_HOSTS`
- [ ] `rsync` установлен на сервере деплоя
- [ ] `.gitlab-ci.yml` в репозитории (по шаблону)
- [ ] Shared runners включены для проекта
- [ ] Deploy config в Kaizen (таб «Деплой» или API)
- [ ] Права на сервере: deploy-user в группе `www-data` (для Laravel)
- [ ] Тестовый push → pipeline success

---

## Troubleshooting

| Проблема | Причина | Решение |
|----------|---------|---------|
| `runner_system_failure` | Runners не привязаны к проекту | `shared_runners_enabled=true` |
| `npm: not found` | Job без Docker-образа | Добавить `image: node:22-alpine` |
| `error in libcrypto` | SSH-ключ как file variable | Использовать `env_var` тип + записать в файл через `echo` |
| `rsync: команда не найдена` | Нет rsync на сервере | `sudo apt-get install -y rsync` |
| `Permission denied` (storage) | Composer/artisan от другого пользователя | `sudo usermod -aG www-data <user>` + `chmod -R g+w storage/` |
| `не найден git репозиторий` | На сервере нет `.git` | Использовать rsync вместо `git pull` |
| Pipeline не создаётся | Нет `.gitlab-ci.yml` в ветке | Закоммитить файл в `main` |

---

## Текущие проекты с настроенным деплоем

| Проект | GitLab | Сервер | Метод | Pipeline |
|--------|--------|--------|-------|----------|
| A-CDM | rivc/acdm-web (ID:14) | 192.168.196.213 | rsync | build-front → deploy (~80с) |
