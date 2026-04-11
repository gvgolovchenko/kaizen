/**
 * Notifier — отправка уведомлений через АФИИНУ в Битрикс24 и Telegram.
 * Б24: im.message.add через webhook REST API.
 * Telegram: sendMessage через Bot API.
 */

import { createLogger } from './logger.js';

const log = createLogger('notifier');

const B24_WEBHOOK = process.env.BITRIX24_WEBHOOK_URL;
const B24_DEFAULT_USER = process.env.BITRIX24_NOTIFY_USER_ID || '9';
const KAIZEN_URL = `http://localhost:${process.env.PORT || 3034}`;

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_DEFAULT_CHAT = process.env.TELEGRAM_NOTIFY_CHAT_ID;

/**
 * Форматирование сообщений по типу события.
 * Б24 поддерживает BB-code: [b], [i], [url], [br] и т.д.
 */
const formatters = {
  pipeline_completed({ product, version, release_id, stages_count, preset }) {
    return `[b]✅ Конвейер завершён[/b]\n` +
      `Продукт: [b]${product}[/b]\n` +
      `Релиз: v${version} (пресет: ${preset || 'custom'})\n` +
      `Этапов пройдено: ${stages_count}\n` +
      `[url=${KAIZEN_URL}/product.html?id=${release_id ? '' : ''}]Открыть в Kaizen[/url]`;
  },

  pipeline_failed({ product, version, stopped_at, error }) {
    return `[b]❌ Конвейер остановлен[/b]\n` +
      `Продукт: [b]${product}[/b]\n` +
      `Версия: v${version}\n` +
      `Остановлен на: [b]${stopped_at}[/b]\n` +
      `Ошибка: ${error || 'неизвестная'}`;
  },

  release_published({ product, version, issues_count, product_id }) {
    return `[b]🚀 Релиз опубликован[/b]\n` +
      `Продукт: [b]${product}[/b]\n` +
      `Версия: v${version}\n` +
      `Задач выполнено: ${issues_count}\n` +
      `[url=${KAIZEN_URL}/product.html?id=${product_id}]Открыть продукт[/url]`;
  },

  develop_completed({ product, version, branch, tests_passed, commit }) {
    const status = tests_passed ? '✅ тесты пройдены' : '⚠️ тесты не запускались';
    return `[b]🔧 Разработка завершена[/b]\n` +
      `Продукт: [b]${product}[/b]\n` +
      `Версия: v${version}\n` +
      `Ветка: ${branch}\n` +
      `Результат: ${status}\n` +
      (commit ? `Коммит: ${commit}` : '');
  },

  develop_failed({ product, version, error }) {
    return `[b]❌ Разработка не удалась[/b]\n` +
      `Продукт: [b]${product}[/b]\n` +
      `Версия: v${version}\n` +
      `Ошибка: ${error || 'тесты не пройдены'}`;
  },

  rc_sync_done({ product, new_count, updated_count, imported_count, product_id }) {
    let msg = `[b]🔄 RC-синхронизация[/b]\n` +
      `Продукт: [b]${product}[/b]\n` +
      `Новых тикетов: ${new_count}, обновлено: ${updated_count}`;
    if (imported_count > 0) {
      msg += `\nАвто-импортировано: ${imported_count}`;
    }
    msg += `\n[url=${KAIZEN_URL}/product.html?id=${product_id}]Открыть продукт[/url]`;
    return msg;
  },

  improve_completed({ product, suggestions_count, approved_count, product_id }) {
    return `[b]💡 AI-улучшение завершено[/b]\n` +
      `Продукт: [b]${product}[/b]\n` +
      `Предложений: ${suggestions_count}\n` +
      `Утверждено автоматически: ${approved_count}\n` +
      `[url=${KAIZEN_URL}/product.html?id=${product_id}]Открыть продукт[/url]`;
  },

  gitlab_sync_done({ product, new_count, updated_count, imported_count, product_id }) {
    let msg = `[b]🦊 GitLab синхронизация[/b]\n` +
      `Продукт: [b]${product}[/b]\n` +
      `Новых issues: ${new_count}, обновлено: ${updated_count}`;
    if (imported_count > 0) {
      msg += `\nАвто-импортировано: ${imported_count}`;
    }
    msg += `\n[url=${KAIZEN_URL}/product.html?id=${product_id}]Открыть продукт[/url]`;
    return msg;
  },

  scenario_completed({ scenario, preset, product, summary }) {
    return `[b]✅ Сценарий завершён[/b]\n` +
      `Сценарий: [b]${scenario}[/b]\n` +
      `Тип: ${preset}\n` +
      `Продукт: ${product}\n` +
      `Итог: ${summary || '—'}\n` +
      `[url=${KAIZEN_URL}/scenarios.html]Открыть сценарии[/url]`;
  },

  scenario_failed({ scenario, preset, product, error }) {
    return `[b]❌ Сценарий провален[/b]\n` +
      `Сценарий: [b]${scenario}[/b]\n` +
      `Тип: ${preset}\n` +
      `Продукт: ${product}\n` +
      `Ошибка: ${error || 'неизвестная'}\n` +
      `[url=${KAIZEN_URL}/scenarios.html]Открыть сценарии[/url]`;
  },
};

// Telegram-форматтеры (Markdown)
const tgFormatters = {
  gitlab_sync_done({ product, new_count, updated_count, imported_count, product_id }) {
    let msg = `🦊 *GitLab синхронизация*\n` +
      `Продукт: *${product}*\n` +
      `Новых issues: ${new_count}, обновлено: ${updated_count}`;
    if (imported_count > 0) {
      msg += `\nАвто\\-импортировано: ${imported_count}`;
    }
    msg += `\n[Открыть продукт](${KAIZEN_URL}/product.html?id=${product_id})`;
    return msg;
  },
};

/**
 * Отправить сообщение в Telegram.
 */
async function sendTelegram(chatId, text) {
  if (!TG_TOKEN) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'MarkdownV2' }),
    });
    if (!res.ok) {
      const err = await res.text();
      log.error({ status: res.status, response: err }, 'Telegram API error');
    }
  } catch (err) {
    log.error({ err: err.message }, 'Telegram send error');
  }
}

/**
 * Отправить уведомление.
 * @param {string} event — тип события (pipeline_completed, develop_failed, ...)
 * @param {object} data — данные для форматирования
 * @param {object} [opts] — опции: { userId, notifications }
 *   notifications — объект из product.automation.notifications
 */
export async function notify(event, data, opts = {}) {
  if (!B24_WEBHOOK && !TG_TOKEN) return;

  // Проверяем per-product настройки уведомлений
  const notifConfig = opts.notifications;
  if (notifConfig) {
    if (!notifConfig.enabled) return;
    if (notifConfig.events && !notifConfig.events.includes(event)) return;
  }

  const formatter = formatters[event];
  if (!formatter) {
    log.error({ event }, 'Unknown event type');
    return;
  }

  const message = formatter(data);

  // Б24
  if (B24_WEBHOOK) {
    const userId = notifConfig?.bitrix24_user_id || opts.userId || B24_DEFAULT_USER;
    try {
      const url = `${B24_WEBHOOK}im.message.add.json`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          DIALOG_ID: String(userId),
          MESSAGE: message,
        }),
      });
      if (!resp.ok) {
        log.error({ status: resp.status }, 'Б24 API error');
      } else {
        const result = await resp.json();
        log.info({ event, userId, msgId: result.result }, 'Sent to Б24');
      }
    } catch (err) {
      log.error({ event, err: err.message }, 'Б24 send error');
    }
  }

  // Telegram
  const tgFormatter = tgFormatters[event];
  const tgChatId = notifConfig?.telegram_chat_id || TG_DEFAULT_CHAT;
  if (TG_TOKEN && tgFormatter && tgChatId) {
    const tgMessage = tgFormatter(data);
    await sendTelegram(tgChatId, tgMessage);
    log.info({ event, chatId: tgChatId }, 'Sent to Telegram');
  }
}

/**
 * Helper: извлечь настройки уведомлений из продукта.
 */
export function getNotifyOpts(product) {
  const notif = product?.automation?.notifications;
  return notif ? { notifications: notif } : {};
}

const TYPE_LABELS = {
  bug_fix: '🐛 Исправления',
  feature: '✨ Новое',
  improvement: '⚡ Улучшения',
  refactoring: '🔧 Рефакторинг',
  documentation: '📄 Документация',
  other: '📌 Прочее',
};

/**
 * Опубликовать отчёт о релизе в Живую ленту Б24-группы.
 * Публикует только если в product.automation.notifications.b24_group_id задан ID группы.
 * @param {object} product — объект продукта
 * @param {object} release — объект релиза (с issues[])
 * @param {object} [extra] — доп. данные: { tests_passed, deploy_status, develop_duration_ms, model_name, pipeline_url }
 */
export async function postReleaseReport(product, release, extra = {}) {
  if (!B24_WEBHOOK) return;

  const groupId = product?.automation?.notifications?.b24_group_id;
  if (!groupId) return;

  const issues = release.issues || [];
  const version = release.version;
  const productName = product.name;
  const gitlabBase = product?.deploy?.gitlab?.url;
  const gitlabProjectId = product?.deploy?.gitlab?.project_id;

  // Строим URL задачи GitLab если возможно
  const issueUrl = (issue) => {
    if (!gitlabBase || !gitlabProjectId || !issue.gitlab_issue_id) return null;
    // Попробуем найти namespace по repo_url
    const repoUrl = product?.repo_url || '';
    const match = repoUrl.match(/\/([^/]+\/[^/]+?)(?:\.git)?$/);
    if (match) return `${gitlabBase}/${match[1]}/-/issues/${issue.gitlab_issue_id}`;
    return null;
  };

  // Группируем задачи по типу
  const byType = {};
  for (const issue of issues) {
    const key = issue.type || 'other';
    if (!byType[key]) byType[key] = [];
    byType[key].push(issue);
  }

  // Саммари-строка: X улучшений · Y исправлений · ...
  const TYPE_SHORT = {
    bug: 'исправлений', improvement: 'улучшений', feature: 'функций',
    refactoring: 'рефакторинг', docs: 'документация', other: 'прочих',
  };
  const summaryParts = Object.entries(byType).map(([type, list]) => `${list.length} ${TYPE_SHORT[type] || TYPE_SHORT.other}`);
  const summary = summaryParts.join(' · ');

  // Формируем тело отчёта
  let body = `[B]📦 ${productName} — v${version}[/B]\n`;
  if (release.name) body += `${release.name}\n`;
  if (summary) body += `[I]${summary}[/I]\n`;
  body += `\n`;

  if (issues.length === 0) {
    body += `Задач в релизе: 0\n`;
  } else {
    for (const [type, list] of Object.entries(byType)) {
      const label = TYPE_LABELS[type] || TYPE_LABELS.other;
      body += `[B]${label}[/B]\n`;
      for (const i of list) {
        const prio = i.priority === 'critical' ? ' 🔴' : i.priority === 'high' ? ' 🟠' : i.priority === 'medium' ? ' 🟡' : '';
        const url = issueUrl(i);
        const issueRef = i.gitlab_issue_id ? (url ? ` [url=${url}]#${i.gitlab_issue_id}[/url]` : ` #${i.gitlab_issue_id}`) : '';
        body += `• ${i.title}${issueRef}${prio}\n`;
      }
      body += `\n`;
    }
  }

  // Метаданные
  if (extra.tests_passed === true) body += `✅ Тесты пройдены\n`;
  else if (extra.tests_passed === false) body += `⚠️ Тесты не запускались\n`;

  if (extra.deploy_status === 'queued') body += `🚀 Деплой поставлен в очередь\n`;
  if (extra.pipeline_url) body += `🔗 [url=${extra.pipeline_url}]GitLab Pipeline[/url]\n`;

  if (extra.model_name) body += `🤖 Разработано: ${extra.model_name}\n`;

  if (extra.develop_duration_ms) {
    const sec = Math.round(extra.develop_duration_ms / 1000);
    const min = Math.floor(sec / 60);
    const s = sec % 60;
    body += `⏱ Время разработки: ${min > 0 ? `${min}м ` : ''}${s}с\n`;
  }

  body += `\n📅 Опубликован: ${new Date().toLocaleString('ru', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })} MSK`;

  try {
    const params = new URLSearchParams({
      POST_TITLE: `🚀 ${productName} v${version} — Релиз опубликован`,
      POST_MESSAGE: body,
      IMPORTANT: 'N',
    });
    params.append('DEST[]', `SG${groupId}`);
    const resp = await fetch(`${B24_WEBHOOK}log.blogpost.add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const result = await resp.json();
    if (result.error) {
      log.error({ error: result.error, groupId }, 'Б24 group post error');
    } else {
      log.info({ postId: result.result, groupId, version }, 'Release report posted to Б24 group');
    }
  } catch (err) {
    log.error({ err: err.message }, 'postReleaseReport error');
  }
}
