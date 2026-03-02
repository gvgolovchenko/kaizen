import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('notifyStatusChanges in app.js', () => {
  const appSource = readFileSync(
    join(__dirname, '..', 'public', 'js', 'app.js'), 'utf-8'
  );

  it('should export notifyStatusChanges function', () => {
    assert.ok(appSource.includes('export function notifyStatusChanges'),
      'app.js should export notifyStatusChanges');
  });

  it('should accept action and details parameters', () => {
    assert.ok(appSource.includes('{ action, details }'),
      'notifyStatusChanges should destructure action and details');
  });

  it('should use toast-info class', () => {
    assert.ok(appSource.includes("'toast toast-info'"),
      'should use toast-info CSS class');
  });

  it('should render toast-title with action', () => {
    assert.ok(appSource.includes('toast-title'),
      'should render toast-title div');
  });

  it('should render toast-detail for each detail', () => {
    assert.ok(appSource.includes('toast-detail'),
      'should render toast-detail div for each detail');
  });

  it('should auto-remove after 5 seconds', () => {
    assert.ok(appSource.includes('5000'),
      'should use 5000ms timeout for removal');
  });

  it('should call ensureContainer before creating toast', () => {
    const fnBody = appSource.substring(
      appSource.indexOf('function notifyStatusChanges'),
      appSource.indexOf('function notifyStatusChanges') + 500
    );
    assert.ok(fnBody.includes('ensureContainer()'),
      'should call ensureContainer()');
  });

  it('should use escapeHtml for action text', () => {
    const fnBody = appSource.substring(
      appSource.indexOf('function notifyStatusChanges'),
      appSource.indexOf('function notifyStatusChanges') + 500
    );
    assert.ok(fnBody.includes('escapeHtml(action)'),
      'should escape action text');
  });
});

describe('toast-info CSS styles', () => {
  const cssSource = readFileSync(
    join(__dirname, '..', 'public', 'css', 'style.css'), 'utf-8'
  );

  it('should define .toast-info styles', () => {
    assert.ok(cssSource.includes('.toast-info'),
      'CSS should include .toast-info');
  });

  it('should use blue background for info toasts', () => {
    assert.ok(cssSource.includes('#1e40af'),
      'toast-info should have blue background #1e40af');
  });

  it('should define .toast-title styles', () => {
    assert.ok(cssSource.includes('.toast-title'),
      'CSS should include .toast-title');
  });

  it('should define .toast-detail styles', () => {
    assert.ok(cssSource.includes('.toast-detail'),
      'CSS should include .toast-detail');
  });

  it('toast-title should be bold', () => {
    const titleSection = cssSource.substring(
      cssSource.indexOf('.toast-title'),
      cssSource.indexOf('.toast-title') + 100
    );
    assert.ok(titleSection.includes('font-weight: 600'),
      '.toast-title should have font-weight: 600');
  });

  it('toast-detail should have left border', () => {
    const detailSection = cssSource.substring(
      cssSource.indexOf('.toast-detail'),
      cssSource.indexOf('.toast-detail') + 200
    );
    assert.ok(detailSection.includes('border-left'),
      '.toast-detail should have border-left');
  });
});

describe('product.js notification integration', () => {
  const productSource = readFileSync(
    join(__dirname, '..', 'public', 'js', 'product.js'), 'utf-8'
  );

  it('should import notifyStatusChanges', () => {
    assert.ok(productSource.includes('notifyStatusChanges'),
      'product.js should import notifyStatusChanges');
  });

  it('should call notifyStatusChanges on release creation', () => {
    const createSection = productSource.substring(
      productSource.indexOf('handleReleaseSubmit'),
      productSource.indexOf('handleReleaseSubmit') + 800
    );
    assert.ok(createSection.includes("action: 'Релиз создан'"),
      'handleReleaseSubmit should show "Релиз создан" notification');
  });

  it('should call notifyStatusChanges on release publish', () => {
    const fnStart = productSource.indexOf('window.publishRelease');
    assert.ok(fnStart !== -1, 'publishRelease function should exist');
    const publishSection = productSource.substring(fnStart, fnStart + 600);
    assert.ok(publishSection.includes("action: 'Релиз опубликован'"),
      'publishRelease should show "Релиз опубликован" notification');
  });

  it('should call notifyStatusChanges on release delete', () => {
    const fnStart = productSource.indexOf('window.deleteRelease');
    assert.ok(fnStart !== -1, 'deleteRelease function should exist');
    const deleteSection = productSource.substring(fnStart, fnStart + 600);
    assert.ok(deleteSection.includes("action: 'Релиз удалён'"),
      'deleteRelease should show "Релиз удалён" notification');
  });

  it('should read status_changes from API response', () => {
    // Check that we read result.status_changes in the handlers
    assert.ok(productSource.includes('result.status_changes'),
      'should read status_changes from result');
  });
});

describe('process-detail.js notification integration', () => {
  const pdSource = readFileSync(
    join(__dirname, '..', 'public', 'js', 'process-detail.js'), 'utf-8'
  );

  it('should import notifyStatusChanges', () => {
    assert.ok(pdSource.includes('notifyStatusChanges'),
      'process-detail.js should import notifyStatusChanges');
  });

  it('should call notifyStatusChanges in approveProcess', () => {
    const approveSection = pdSource.substring(
      pdSource.indexOf('approveProcess'),
      pdSource.indexOf('approveProcess') + 800
    );
    assert.ok(approveSection.includes("action: 'Предложения утверждены'"),
      'approveProcess should show "Предложения утверждены" notification');
  });
});
