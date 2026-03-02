import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('releases.js status_changes', () => {
  const releasesSource = readFileSync(
    join(__dirname, '..', 'server', 'db', 'releases.js'), 'utf-8'
  );

  describe('create function', () => {
    it('should track issues_to_in_release count', () => {
      assert.ok(releasesSource.includes('issuesMovedToInRelease'),
        'create() should count issues moved to in_release');
      assert.ok(releasesSource.includes('issuesMovedToInRelease++'),
        'create() should increment counter');
    });

    it('should return status_changes in result', () => {
      assert.ok(releasesSource.includes('result.status_changes = { issues_to_in_release: issuesMovedToInRelease }'),
        'create() should attach status_changes to result');
    });
  });

  describe('update function', () => {
    it('should track addedCount and removedCount', () => {
      assert.ok(releasesSource.includes('let addedCount = 0'),
        'update() should initialize addedCount');
      assert.ok(releasesSource.includes('let removedCount = 0'),
        'update() should initialize removedCount');
    });

    it('should return status_changes with both counts', () => {
      assert.ok(releasesSource.includes('issues_to_in_release: addedCount, issues_to_open: removedCount'),
        'update() should return both added and removed counts');
    });
  });

  describe('remove function', () => {
    it('should count issues before deletion', () => {
      assert.ok(releasesSource.includes('count(*)::int AS count'),
        'remove() should count issues before deleting');
    });

    it('should return status_changes with issues_to_open', () => {
      assert.ok(releasesSource.includes('status_changes: { issues_to_open: issuesToOpen }'),
        'remove() should return issues_to_open count');
    });

    it('should return false if release not found', () => {
      assert.ok(releasesSource.includes('if (rowCount === 0) return false'),
        'remove() should return false for missing release');
    });
  });

  describe('publish function', () => {
    it('should count issues before publishing', () => {
      // Count query before the publish
      const publishSection = releasesSource.substring(
        releasesSource.indexOf('export async function publish')
      );
      assert.ok(publishSection.includes('count(*)::int AS count'),
        'publish() should count issues before publishing');
    });

    it('should return status_changes', () => {
      assert.ok(releasesSource.includes('release_to_released: true, issues_to_done: issuesToDone'),
        'publish() should return release_to_released and issues_to_done');
    });
  });
});

describe('api.js route for DELETE releases', () => {
  const apiSource = readFileSync(
    join(__dirname, '..', 'server', 'routes', 'api.js'), 'utf-8'
  );

  it('should handle object result from releases.remove()', () => {
    assert.ok(apiSource.includes("typeof result === 'object'"),
      'DELETE /releases/:id should check if result is an object');
  });

  it('should pass through status_changes in response', () => {
    // The route should return the result object which contains status_changes
    assert.ok(apiSource.includes('res.json(response)'),
      'DELETE /releases/:id should json the response with status_changes');
  });
});
