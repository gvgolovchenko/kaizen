/**
 * CI/CD file generator for Kaizen products.
 * Generates .gitlab-ci.yml and Dockerfile based on product settings.
 */

/**
 * Generate .gitlab-ci.yml content based on deploy config.
 */
export function generateGitlabCI(product, deploy) {
  const method = deploy?.target?.method || 'docker';
  const techStack = (product.tech_stack || '').toLowerCase();

  // Detect runtime
  const isNode = techStack.includes('node') || techStack.includes('express') || techStack.includes('nuxt') || techStack.includes('vue');
  const isDotnet = techStack.includes('.net') || techStack.includes('dotnet') || techStack.includes('c#');
  const isPHP = techStack.includes('php') || techStack.includes('laravel');

  const image = isNode ? 'node:22-alpine' : isDotnet ? 'mcr.microsoft.com/dotnet/sdk:8.0' : isPHP ? 'php:8.2-cli' : 'alpine:latest';
  const testCmd = isNode ? 'npm ci && npm test' : isDotnet ? 'dotnet test' : isPHP ? 'composer install && php artisan test' : 'echo "No tests configured"';

  if (method === 'docker') {
    return generateDockerCI(image, testCmd, deploy);
  }
  return generateNativeCI(image, testCmd, deploy);
}

function generateDockerCI(image, testCmd, deploy) {
  const host = deploy?.target?.host || '$DEPLOY_HOST';
  const user = deploy?.target?.user || '$DEPLOY_USER';
  const composePath = deploy?.target?.docker_compose_path || '$DEPLOY_PATH/docker-compose.yml';
  const postCmd = deploy?.target?.post_deploy_cmd || '';

  return `stages:
  - test
  - build
  - deploy

variables:
  DOCKER_TLS_CERTDIR: ""

test:
  stage: test
  image: ${image}
  script:
    - ${testCmd}
  rules:
    - if: $CI_MERGE_REQUEST_IID
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

build:
  stage: build
  image: docker:latest
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
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

deploy:
  stage: deploy
  image: alpine:latest
  before_script:
    - apk add --no-cache openssh-client
    - eval $(ssh-agent -s)
    - echo "$SSH_PRIVATE_KEY" | ssh-add -
    - mkdir -p ~/.ssh && chmod 700 ~/.ssh
    - echo "$SSH_KNOWN_HOSTS" >> ~/.ssh/known_hosts
  script:
    - ssh ${user}@${host} "cd $(composePath.replace(/\/docker-compose\.yml$/, '')) && docker compose pull && docker compose up -d"${postCmd ? `\n    - ssh ${user}@${host} "${postCmd}"` : ''}
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  environment:
    name: production
`;
}

function generateNativeCI(image, testCmd, deploy) {
  const host = deploy?.target?.host || '$DEPLOY_HOST';
  const user = deploy?.target?.user || '$DEPLOY_USER';
  const pm2Name = deploy?.target?.pm2_name || '$PM2_NAME';
  const projectPath = deploy?.target?.project_path_on_server || '$PROJECT_PATH';
  const postCmd = deploy?.target?.post_deploy_cmd || '';

  return `stages:
  - test
  - deploy

test:
  stage: test
  image: ${image}
  script:
    - ${testCmd}
  rules:
    - if: $CI_MERGE_REQUEST_IID
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

deploy:
  stage: deploy
  image: alpine:latest
  before_script:
    - apk add --no-cache openssh-client
    - eval $(ssh-agent -s)
    - echo "$SSH_PRIVATE_KEY" | ssh-add -
    - mkdir -p ~/.ssh && chmod 700 ~/.ssh
    - echo "$SSH_KNOWN_HOSTS" >> ~/.ssh/known_hosts
  script:
    - ssh ${user}@${host} "cd ${projectPath} && git pull && npm ci --production && pm2 restart ${pm2Name}"${postCmd ? `\n    - ssh ${user}@${host} "${postCmd}"` : ''}
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  environment:
    name: production
`;
}

/**
 * Generate Dockerfile based on tech stack.
 */
export function generateDockerfile(product) {
  const techStack = (product.tech_stack || '').toLowerCase();

  if (techStack.includes('.net') || techStack.includes('dotnet')) {
    return generateDotnetDockerfile(product);
  }

  if (techStack.includes('php') || techStack.includes('laravel')) {
    return generatePHPDockerfile(product);
  }

  // Default: Node.js
  return generateNodeDockerfile(product);
}

function generateNodeDockerfile(product) {
  const port = product.port || 3000;
  return `FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

EXPOSE ${port}
CMD ["node", "server/index.js"]
`;
}

function generateDotnetDockerfile(product) {
  const port = product.port || 5000;
  return `FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY *.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app .
EXPOSE ${port}
ENTRYPOINT ["dotnet", "App.dll"]
`;
}

function generatePHPDockerfile(product) {
  return `FROM php:8.2-fpm-alpine
WORKDIR /var/www/html

RUN apk add --no-cache composer
COPY composer.* ./
RUN composer install --no-dev --optimize-autoloader

COPY . .
RUN chown -R www-data:www-data storage bootstrap/cache

EXPOSE 9000
CMD ["php-fpm"]
`;
}

/**
 * Generate docker-compose.yml for a product.
 */
export function generateDockerCompose(product, deploy) {
  const port = product.port || 3000;
  const serviceName = deploy?.target?.service_name || product.name.toLowerCase().replace(/[^a-z0-9]/g, '-');

  return `version: "3.8"

services:
  ${serviceName}:
    image: \${CI_REGISTRY_IMAGE:-${serviceName}}:latest
    container_name: ${serviceName}
    restart: unless-stopped
    ports:
      - "${port}:${port}"
    env_file:
      - .env
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:${port}/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
`;
}
