/**
 * Notifier — отправка уведомлений через АФИИНУ в Битрикс24.
 * Использует im.message.add через webhook REST API.
 */

const B24_WEBHOOK = process.env.BITRIX24_WEBHOOK_URL;
const B24_DEFAULT_USER = process.env.BITRIX24_NOTIFY_USER_ID || '9';
const KAIZEN_URL = `http://localhost:${process.env.PORT || 3034}`;

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
};

/**
 * Отправить уведомление.
 * @param {string} event — тип события (pipeline_completed, develop_failed, ...)
 * @param {object} data — данные для форматирования
 * @param {object} [opts] — опции: { userId, notifications }
 *   notifications — объект из product.automation.notifications
 */
export async function notify(event, data, opts = {}) {
  if (!B24_WEBHOOK) return;

  // Проверяем per-product настройки уведомлений
  const notifConfig = opts.notifications;
  if (notifConfig) {
    if (!notifConfig.enabled) return;
    if (notifConfig.events && !notifConfig.events.includes(event)) return;
  }

  const formatter = formatters[event];
  if (!formatter) {
    console.error(`Notifier: unknown event "${event}"`);
    return;
  }

  const message = formatter(data);
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
      console.error(`Notifier: Б24 API error ${resp.status}`);
      return;
    }

    const result = await resp.json();
    console.log(`Notifier: [${event}] → user ${userId}, msg_id: ${result.result}`);
  } catch (err) {
    console.error(`Notifier: send error for "${event}":`, err.message);
  }
}

/**
 * Helper: извлечь настройки уведомлений из продукта.
 */
export function getNotifyOpts(product) {
  const notif = product?.automation?.notifications;
  return notif ? { notifications: notif } : {};
}
