import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import {
  DEVELOPED_LABELS,
  updateIssueLabels,
  markIssueDeveloped,
  syncIssuesDeveloped,
} from '../server/gitlab-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('gitlab-client: label sync для фазы «Разработка завершена»', () => {
  describe('DEVELOPED_LABELS', () => {
    it('снимает «В работе» и «Требуется доработка»', () => {
      assert.deepEqual(DEVELOPED_LABELS.remove, ['В работе', 'Требуется доработка']);
    });

    it('ставит «Разработка завершена»', () => {
      assert.deepEqual(DEVELOPED_LABELS.add, ['Разработка завершена']);
    });

    it('иммутабельный объект', () => {
      assert.ok(Object.isFrozen(DEVELOPED_LABELS));
    });
  });

  describe('updateIssueLabels', () => {
    it('возвращает ошибку при отсутствии конфигурации GitLab', async () => {
      const res = await updateIssueLabels({}, 1, { add_labels: ['x'] });
      assert.equal(res.updated, false);
      assert.match(res.error, /не настроен/);
    });

    it('возвращает ошибку если нет лейблов на изменение', async () => {
      const deploy = { gitlab: { url: 'http://x', project_id: 1, access_token: 't' } };
      const res = await updateIssueLabels(deploy, 1, {});
      assert.equal(res.updated, false);
      assert.match(res.error, /no labels/);
    });

    it('шлёт PUT с remove_labels и add_labels (через fetch-моки)', async () => {
      const deploy = { gitlab: { url: 'http://gl.test', project_id: 42, access_token: 'tok' } };
      const origFetch = globalThis.fetch;
      let captured;
      globalThis.fetch = async (url, opts) => {
        captured = { url, opts };
        return {
          ok: true,
          json: async () => ({ labels: ['Разработка завершена'] }),
        };
      };
      try {
        const res = await updateIssueLabels(deploy, 29, {
          remove_labels: ['В работе'],
          add_labels: ['Разработка завершена'],
        });
        assert.equal(res.updated, true);
        assert.deepEqual(res.labels, ['Разработка завершена']);
        assert.equal(captured.opts.method, 'PUT');
        assert.match(captured.url, /\/api\/v4\/projects\/42\/issues\/29$/);
        const body = JSON.parse(captured.opts.body);
        assert.equal(body.remove_labels, 'В работе');
        assert.equal(body.add_labels, 'Разработка завершена');
        assert.equal(captured.opts.headers['PRIVATE-TOKEN'], 'tok');
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  describe('markIssueDeveloped', () => {
    it('обновляет лейблы + пишет комментарий по умолчанию', async () => {
      const deploy = { gitlab: { url: 'http://gl.test', project_id: 1, access_token: 't' } };
      const calls = [];
      const origFetch = globalThis.fetch;
      globalThis.fetch = async (url, opts) => {
        calls.push({ url, method: opts.method, body: opts.body });
        return { ok: true, json: async () => ({ labels: ['Разработка завершена'] }) };
      };
      try {
        const res = await markIssueDeveloped(deploy, 10);
        assert.equal(res.labels.updated, true);
        assert.equal(res.comment.commented, true);
        // 1) PUT /issues/10 — лейблы
        assert.ok(calls[0].url.endsWith('/issues/10'));
        assert.equal(calls[0].method, 'PUT');
        // 2) POST /issues/10/notes — комментарий
        assert.ok(calls[1].url.endsWith('/issues/10/notes'));
        assert.equal(calls[1].method, 'POST');
        assert.match(calls[1].body, /готово к тестированию/);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('пропускает комментарий при comment:false', async () => {
      const deploy = { gitlab: { url: 'http://gl.test', project_id: 1, access_token: 't' } };
      const origFetch = globalThis.fetch;
      let count = 0;
      globalThis.fetch = async () => {
        count++;
        return { ok: true, json: async () => ({ labels: [] }) };
      };
      try {
        const res = await markIssueDeveloped(deploy, 1, { comment: false });
        assert.equal(res.comment, null);
        assert.equal(count, 1, 'должен быть только вызов обновления лейблов');
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  describe('syncIssuesDeveloped', () => {
    it('пропускает задачи без gitlab_issue_id', async () => {
      const res = await syncIssuesDeveloped({}, [{ id: 'x' }, { id: 'y' }]);
      assert.deepEqual(res, { synced: 0, failed: 0 });
    });

    it('считает synced/failed по результатам каждой задачи', async () => {
      const deploy = { gitlab: { url: 'http://gl.test', project_id: 1, access_token: 't' } };
      const origFetch = globalThis.fetch;
      let n = 0;
      globalThis.fetch = async (url) => {
        n++;
        // PUT лейблов падает для 2-й задачи
        if (url.endsWith('/issues/2') && !url.includes('/notes')) {
          return { ok: false, status: 500, statusText: 'err' };
        }
        return { ok: true, json: async () => ({ labels: ['Разработка завершена'] }) };
      };
      try {
        const issues = [
          { gitlab_issue_id: 1 },
          { gitlab_issue_id: 2 },
          { gitlab_issue_id: 3 },
          { /* без ID — должен быть пропущен */ },
        ];
        const res = await syncIssuesDeveloped(deploy, issues);
        assert.equal(res.synced, 2);
        assert.equal(res.failed, 1);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });
});

describe('routes/api.js: PUT /issues/:id — GitLab label sync при done', () => {
  const source = readFileSync(
    join(__dirname, '..', 'server', 'routes', 'api.js'), 'utf-8'
  );

  it('вызывает markIssueDeveloped (не closeIssue) при status=done', () => {
    // Извлекаем блок PUT /issues/:id
    const match = source.match(/router\.put\('\/issues\/:id'[\s\S]+?^\}\);/m);
    assert.ok(match, 'блок PUT /issues/:id должен существовать');
    const block = match[0];
    assert.match(block, /markIssueDeveloped/, 'должен импортировать markIssueDeveloped');
    assert.doesNotMatch(block, /closeIssue/, 'не должен закрывать GitLab issue — нужен для тестировщика');
  });
});

describe('db/releases.js: publish() — GitLab label sync', () => {
  const source = readFileSync(
    join(__dirname, '..', 'server', 'db', 'releases.js'), 'utf-8'
  );

  it('импортирует syncIssuesDeveloped', () => {
    assert.match(source, /import\s*\{\s*syncIssuesDeveloped\s*\}\s*from\s*'\.\.\/gitlab-client\.js'/);
  });

  it('publish() вызывает syncIssuesDeveloped для задач релиза', () => {
    const publishBlock = source.match(/export async function publish[\s\S]+?^\}/m)?.[0] || '';
    assert.match(publishBlock, /syncIssuesDeveloped\(product\.deploy,\s*result\.issues\)/);
  });

  it('sync происходит после COMMIT (fire-and-forget, не в транзакции)', () => {
    const publishBlock = source.match(/export async function publish[\s\S]+?^\}/m)?.[0] || '';
    const commitIdx = publishBlock.indexOf("COMMIT");
    const syncIdx = publishBlock.indexOf('syncIssuesDeveloped');
    assert.ok(commitIdx > 0 && syncIdx > commitIdx, 'sync должен быть после COMMIT');
  });
});
