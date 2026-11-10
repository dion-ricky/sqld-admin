"use strict";

/* ------------------------------------------------------------------ *
 * API client
 * ------------------------------------------------------------------ */
async function api(path, options = {}) {
  const opts = { method: 'GET', ...options, headers: { ...(options.headers || {}) } };
  if (opts.method !== 'GET' && opts.headers['Content-Type'] === undefined) {
    opts.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`/api${path}`, opts);
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

/* ------------------------------------------------------------------ *
 * Error banner (single shared helper, textContent only)
 * ------------------------------------------------------------------ */
let errorTimer = null;
let errorPauseBound = false;

function pauseErrorDismiss() {
  if (errorTimer) {
    clearTimeout(errorTimer);
    errorTimer = null;
  }
}

function scheduleErrorDismiss() {
  pauseErrorDismiss();
  errorTimer = setTimeout(clearError, 8000);
}

function clearError() {
  pauseErrorDismiss();
  const banner = document.getElementById('error-banner');
  if (banner) banner.replaceChildren();
}

function bindErrorPause(banner) {
  if (errorPauseBound) return;
  errorPauseBound = true;
  banner.addEventListener('mouseenter', pauseErrorDismiss);
  banner.addEventListener('focusin', pauseErrorDismiss);
  banner.addEventListener('mouseleave', scheduleErrorDismiss);
  banner.addEventListener('focusout', scheduleErrorDismiss);
}

function showError(message) {
  const banner = document.getElementById('error-banner');
  if (!banner) return;
  banner.replaceChildren();
  bindErrorPause(banner);

  const div = document.createElement('div');
  div.className = 'error-banner';

  const text = document.createElement('span');
  text.className = 'error-text';
  text.textContent = message;

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'error-dismiss';
  dismiss.setAttribute('aria-label', 'Dismiss error');
  dismiss.textContent = '×';
  dismiss.addEventListener('click', clearError);

  div.append(text, dismiss);
  banner.appendChild(div);
  scheduleErrorDismiss();
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatNumber(n) {
  return Number(n).toLocaleString('en-US');
}

function formatCount(n, singular, plural) {
  const word = n === 1 ? singular : (plural || `${singular}s`);
  return `${formatNumber(n)} ${word}`;
}

function breadcrumb(items) {
  const nav = el('nav', 'breadcrumb');
  nav.setAttribute('aria-label', 'Breadcrumb');
  const list = el('ol');
  const entries = items || [];
  entries.forEach((item, index) => {
    const li = el('li');
    const current = !item.href || index === entries.length - 1;
    const node = current ? el('span', null, item.label) : el('a', null, item.label);
    if (current) node.setAttribute('aria-current', 'page');
    else node.href = item.href;
    if (item.label.length > 24) node.title = item.label;
    li.appendChild(node);
    list.appendChild(li);
  });
  nav.appendChild(list);
  return nav;
}

function pageHeader({ title, meta, actions, crumbs } = {}) {
  const wrapper = el('div');
  if (crumbs && crumbs.length) wrapper.appendChild(breadcrumb(crumbs));

  const header = el('header', 'page-header');
  const heading = el('div', 'page-heading');
  heading.appendChild(el('h1', null, title));
  if (meta !== undefined && meta !== null) heading.appendChild(el('p', 'page-meta', meta));
  header.appendChild(heading);

  const actionNodes = (actions || []).filter(Boolean);
  if (actionNodes.length) {
    const actionRow = el('div', 'page-actions');
    for (const node of actionNodes) actionRow.appendChild(node);
    header.appendChild(actionRow);
  }

  wrapper.appendChild(header);
  return wrapper;
}

function emptyState({ title, copy, actions } = {}) {
  const box = el('div', 'empty-state');
  box.appendChild(el('h2', null, title));
  if (copy) box.appendChild(el('p', null, copy));
  const actionNodes = (actions || []).filter(Boolean);
  if (actionNodes.length) {
    const actionRow = el('div', 'page-actions');
    for (const node of actionNodes) actionRow.appendChild(node);
    box.appendChild(actionRow);
  }
  return box;
}

function rowNumberCell(n, tag = 'td') {
  const cell = el(tag, 'row-num', n === undefined || n === null ? '' : String(n));
  cell.setAttribute('aria-hidden', 'true');
  return cell;
}

const NUMERIC_TYPES = new Set([
  'INT', 'INTEGER', 'TINYINT', 'SMALLINT', 'MEDIUMINT', 'BIGINT', 'INT2', 'INT8',
  'REAL', 'DOUBLE', 'DOUBLE PRECISION', 'FLOAT', 'NUMERIC', 'DECIMAL'
]);

function isNumericType(type) {
  if (!type) return false;
  const base = String(type).trim().toUpperCase().replace(/\(.*$/, '').trim();
  return NUMERIC_TYPES.has(base);
}

function inferNumericColumns(rows) {
  const width = (rows || []).reduce((max, row) => Math.max(max, row.length), 0);
  const result = new Array(width).fill(false);
  for (let c = 0; c < width; c += 1) {
    let sawValue = false;
    let numeric = true;
    for (const row of rows) {
      const value = row[c];
      if (value === null || value === undefined) continue;
      sawValue = true;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        numeric = false;
        break;
      }
    }
    result[c] = sawValue && numeric;
  }
  return result;
}

function setBusy(container, busy) {
  if (!container) return;
  if (busy) container.setAttribute('aria-busy', 'true');
  else container.removeAttribute('aria-busy');
}

function setPending(button, label) {
  if (!button) return () => {};
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  return () => {
    button.disabled = false;
    button.textContent = original;
  };
}

function guardExactMatch(input, button, expected) {
  if (!input) return () => {};

  const field = input.closest('.field') || input.parentElement;
  let hint = field ? field.querySelector('.field-hint') : null;
  if (field && !hint) {
    hint = el('p', 'field-hint');
    field.appendChild(hint);
  }
  if (hint) {
    if (!hint.id) hint.id = `${input.id || 'field'}-hint`;
    input.setAttribute('aria-describedby', hint.id);
  }

  const update = () => {
    const value = input.value;
    const matches = value === expected;
    if (button) button.disabled = !matches;
    if (hint) {
      if (matches) hint.textContent = 'Name matches.';
      else if (value === '') hint.textContent = `Type "${expected}" exactly.`;
      else hint.textContent = `Doesn't match yet. Type "${expected}" exactly.`;
    }
    if (value !== '' && !matches) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };

  input.addEventListener('input', update);
  update();
  return () => input.removeEventListener('input', update);
}

function loadingRows(columnCount, rowCount = 3) {
  const tbody = el('tbody');
  tbody.setAttribute('aria-hidden', 'true');
  for (let r = 0; r < rowCount; r += 1) {
    const tr = el('tr', 'loading-row');
    for (let c = 0; c < columnCount; c += 1) {
      const td = el('td');
      td.appendChild(el('span', 'loading-block'));
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  return tbody;
}

// Shared cell renderer. Values are already decoded by the backend:
// null, number, string, or { blob: true, bytes }.
function renderCell(td, value) {
  td.replaceChildren();
  const keepNum = td.classList.contains('num');
  td.className = keepNum ? 'num' : '';
  td.removeAttribute('title');

  if (value === null || value === undefined) {
    td.appendChild(el('span', 'cell-null', 'NULL'));
    return;
  }
  if (typeof value === 'object' && value.blob) {
    td.appendChild(el('span', 'cell-blob', `blob ${value.bytes} B`));
    return;
  }
  const s = String(value);
  const span = el('span', 'cell-text', s);
  if (s.length > 60) span.title = s;
  td.appendChild(span);
}

function openDialog(id) {
  const d = document.getElementById(id);
  if (d && typeof d.showModal === 'function') d.showModal();
}

function closeDialog(id) {
  const d = document.getElementById(id);
  if (d && d.open) d.close();
}

function focusField(input) {
  if (!input) return;
  input.focus();
  if (typeof input.select === 'function' && input.type === 'text') input.select();
}

function submitButtonFor(event) {
  if (event && event.submitter) return event.submitter;
  const form = event && event.target;
  return form && form.querySelector ? form.querySelector('button[type="submit"]') : null;
}

const exactMatchGuards = new Map();

function armExactMatchGuard(key, input, button, expected) {
  const previous = exactMatchGuards.get(key);
  if (previous) previous();
  if (!input) {
    exactMatchGuards.delete(key);
    return;
  }
  input.value = '';
  exactMatchGuards.set(key, guardExactMatch(input, button, expected));
}

// Context shared by the (once-bound) dialog submit handlers.
const dialogContext = { db: null, table: null, onDone: null };

/* ------------------------------------------------------------------ *
 * Hash router
 * ------------------------------------------------------------------ */
class HashRouter {
  constructor() {
    this.routes = [];
    this.currentPath = this.getCurrentPath();
    window.addEventListener('hashchange', () => {
      this.currentPath = this.getCurrentPath();
      this.render();
    });
  }

  getCurrentPath() {
    return window.location.hash.slice(1) || '/';
  }

  addRoute(pattern, handler) {
    const keys = [];
    const regex = new RegExp(
      '^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$'
    );
    this.routes.push({ regex, keys, handler });
  }

  navigate(path) {
    if (this.getCurrentPath() === path) {
      this.currentPath = path;
      this.render();
    } else {
      window.location.hash = path;
    }
  }

  updateNav() {
    document.querySelectorAll('.masthead-nav a').forEach((link) => {
      const href = (link.getAttribute('href') || '').replace(/^#/, '') || '/';
      const active = href === '/'
        ? this.currentPath === '/' || this.currentPath.startsWith('/db/')
        : this.currentPath === href;
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  render() {
    this.updateNav();
    for (const route of this.routes) {
      const m = this.currentPath.match(route.regex);
      if (m) {
        const params = {};
        route.keys.forEach((key, i) => { params[key] = decodeURIComponent(m[i + 1]); });
        const content = document.getElementById('content');
        if (content) content.replaceChildren();
        route.handler(params);
        return;
      }
    }
    this.currentPath = '/';
    this.updateNav();
    this.navigate('/');
  }
}

/* ------------------------------------------------------------------ *
 * Databases page
 * ------------------------------------------------------------------ */
class DatabasesPage {
  constructor(container, router) {
    this.container = container;
    this.router = router;
    this.databases = [];
    this.loading = true;
    this.loadFailed = false;
    this.render();
    this.load();
  }

  async load() {
    this.loading = true;
    this.loadFailed = false;
    this.render();
    try {
      this.databases = (await api('/databases')) || [];
      this.loading = false;
      this.loadFailed = false;
      this.render();
    } catch (error) {
      this.loading = false;
      this.loadFailed = true;
      this.render();
      showError("Couldn't load databases. " + error.message);
    }
  }

  newDatabaseButton() {
    const btn = el('button', 'btn-primary', 'New database');
    btn.type = 'button';
    btn.addEventListener('click', () => this.openNewDatabaseDialog());
    return btn;
  }

  adoptButton() {
    const btn = el('button', 'btn-secondary', 'Add existing');
    btn.type = 'button';
    btn.addEventListener('click', () => this.openAdoptDialog());
    return btn;
  }

  openNewDatabaseDialog() {
    dialogContext.db = null;
    dialogContext.table = null;
    dialogContext.onDone = () => this.load();
    const input = document.getElementById('new-database-name');
    if (input) input.value = '';
    openDialog('new-database-dialog');
  }

  openAdoptDialog() {
    dialogContext.db = null;
    dialogContext.table = null;
    dialogContext.onDone = () => this.load();
    const input = document.getElementById('adopt-database-name');
    if (input) input.value = '';
    openDialog('adopt-dialog');
  }

  openRenameDialog(db) {
    dialogContext.db = db;
    dialogContext.onDone = () => this.load();
    const current = document.getElementById('rename-current-name');
    if (current) current.textContent = db;
    const input = document.getElementById('rename-new-name');
    if (input) input.value = '';
    openDialog('rename-database-dialog');
  }

  openDuplicateDialog(db) {
    dialogContext.db = db;
    dialogContext.onDone = () => this.load();
    const current = document.getElementById('duplicate-current-name');
    if (current) current.textContent = db;
    const input = document.getElementById('duplicate-new-name');
    if (input) input.value = '';
    openDialog('duplicate-database-dialog');
  }

  openDeleteDialog(db) {
    dialogContext.db = db;
    dialogContext.onDone = () => this.load();
    const name = document.getElementById('delete-database-name');
    if (name) name.textContent = db;
    armExactMatchGuard(
      'delete-database',
      document.getElementById('delete-confirm-name'),
      document.getElementById('delete-database-confirm'),
      db
    );
    openDialog('delete-database-dialog');
  }

  render() {
    this.container.replaceChildren();

    const meta = this.loading
      ? 'Loading…'
      : (this.loadFailed ? 'Unavailable' : formatCount(this.databases.length, 'database'));

    this.container.appendChild(pageHeader({
      title: 'Databases',
      meta,
      actions: [this.newDatabaseButton(), this.adoptButton()],
      crumbs: [{ label: 'Databases' }]
    }));

    if (this.loading) {
      this.container.appendChild(this.renderRegister(true));
      return;
    }

    if (this.loadFailed) {
      this.container.appendChild(emptyState({
        title: "Couldn't load databases",
        copy: 'Reload the page to try again.'
      }));
      return;
    }

    if (this.databases.length === 0) {
      this.container.appendChild(emptyState({
        title: 'No databases yet',
        copy: 'Create a database to start adding tables and rows.',
        actions: [this.newDatabaseButton()]
      }));
      return;
    }

    this.container.appendChild(this.renderRegister(false));
  }

  renderRegister(loading) {
    const table = el('table', 'register');
    table.appendChild(el('caption', 'sr-only', loading ? 'Loading databases' : formatCount(this.databases.length, 'database')));

    const thead = el('thead');
    const headRow = el('tr');
    headRow.append(el('th', null, 'Name'), el('th', null, 'Actions'));
    thead.appendChild(headRow);
    table.appendChild(thead);

    if (loading) {
      table.appendChild(loadingRows(2));
      return table;
    }

    const tbody = el('tbody');
    for (const db of this.databases) {
      const tr = el('tr');

      const nameCell = el('td');
      const link = el('a', null, db);
      link.href = `#/db/${encodeURIComponent(db)}`;
      if (db.length > 24) link.title = db;
      nameCell.appendChild(link);
      tr.appendChild(nameCell);

      const actionsCell = el('td');
      const actions = el('div', 'row-actions');

      const open = el('button', 'btn-sm btn-ghost', 'Open');
      open.type = 'button';
      open.addEventListener('click', () => this.router.navigate(`/db/${encodeURIComponent(db)}`));

      const rename = el('button', 'btn-sm btn-ghost', 'Rename');
      rename.type = 'button';
      rename.addEventListener('click', () => this.openRenameDialog(db));

      const duplicate = el('button', 'btn-sm btn-ghost', 'Duplicate');
      duplicate.type = 'button';
      duplicate.addEventListener('click', () => this.openDuplicateDialog(db));

      const remove = el('button', 'btn-sm btn-danger', 'Delete');
      remove.type = 'button';
      remove.addEventListener('click', () => this.openDeleteDialog(db));

      actions.append(open, rename, duplicate, remove);
      actionsCell.appendChild(actions);
      tr.appendChild(actionsCell);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }
}

/* ------------------------------------------------------------------ *
 * Tables page
 * ------------------------------------------------------------------ */
class TablesPage {
  constructor(container, router, dbName) {
    this.container = container;
    this.router = router;
    this.dbName = dbName;
    this.tables = [];
    this.loading = true;
    this.loadFailed = false;
    this.render();
    this.load();
  }

  async load() {
    this.loading = true;
    this.loadFailed = false;
    this.render();
    try {
      this.tables = (await api(`/databases/${encodeURIComponent(this.dbName)}/tables`)) || [];
      this.loading = false;
      this.loadFailed = false;
      this.render();
    } catch (error) {
      this.loading = false;
      this.loadFailed = true;
      this.render();
      showError("Couldn't load tables. " + error.message);
    }
  }

  newTableButton() {
    const btn = el('button', 'btn-primary', 'New table');
    btn.type = 'button';
    btn.addEventListener('click', () => this.openNewTableDialog());
    return btn;
  }

  sqlConsoleButton() {
    const btn = el('button', 'btn-secondary', 'SQL console');
    btn.type = 'button';
    btn.addEventListener('click', () => this.router.navigate(`/db/${encodeURIComponent(this.dbName)}/sql`));
    return btn;
  }

  openNewTableDialog() {
    dialogContext.db = this.dbName;
    dialogContext.table = null;
    dialogContext.onDone = () => this.load();
    resetNewTableForm();
    openDialog('new-table-dialog');
  }

  openRenameTableDialog(tableName) {
    dialogContext.db = this.dbName;
    dialogContext.table = tableName;
    dialogContext.onDone = () => this.load();
    const current = document.getElementById('rename-table-current-name');
    if (current) current.textContent = tableName;
    const input = document.getElementById('rename-table-new-name');
    if (input) input.value = '';
    openDialog('rename-table-dialog');
  }

  openDropTableDialog(tableName) {
    dialogContext.db = this.dbName;
    dialogContext.table = tableName;
    dialogContext.onDone = () => this.load();
    const name = document.getElementById('drop-table-name');
    if (name) name.textContent = tableName;
    armExactMatchGuard(
      'drop-table',
      document.getElementById('drop-table-confirm-name'),
      document.getElementById('drop-table-confirm'),
      tableName
    );
    openDialog('drop-table-dialog');
  }

  render() {
    this.container.replaceChildren();

    const meta = this.loading
      ? 'Loading…'
      : (this.loadFailed ? 'Unavailable' : formatCount(this.tables.length, 'table'));

    this.container.appendChild(pageHeader({
      title: this.dbName,
      meta,
      actions: [this.newTableButton(), this.sqlConsoleButton()],
      crumbs: [{ label: 'Databases', href: '#/' }, { label: this.dbName }]
    }));

    if (this.loading) {
      this.container.appendChild(this.renderRegister(true));
      return;
    }

    if (this.loadFailed) {
      this.container.appendChild(emptyState({
        title: "Couldn't load tables",
        copy: 'Reload the page to try again.'
      }));
      return;
    }

    if (this.tables.length === 0) {
      this.container.appendChild(emptyState({
        title: `No tables in ${this.dbName}`,
        copy: 'Create a table, or open the SQL console to run a statement.',
        actions: [this.newTableButton(), this.sqlConsoleButton()]
      }));
      return;
    }

    this.container.appendChild(this.renderRegister(false));
  }

  renderRegister(loading) {
    const table = el('table', 'register');
    table.appendChild(el('caption', 'sr-only', loading ? 'Loading tables' : formatCount(this.tables.length, 'table')));

    const thead = el('thead');
    const headRow = el('tr');
    headRow.append(el('th', null, 'Name'), el('th', null, 'Actions'));
    thead.appendChild(headRow);
    table.appendChild(thead);

    if (loading) {
      table.appendChild(loadingRows(2));
      return table;
    }

    const tbody = el('tbody');
    for (const tableName of this.tables) {
      const tr = el('tr');

      const nameCell = el('td');
      const link = el('a', null, tableName);
      link.href = `#/db/${encodeURIComponent(this.dbName)}/table/${encodeURIComponent(tableName)}`;
      if (tableName.length > 24) link.title = tableName;
      nameCell.appendChild(link);
      tr.appendChild(nameCell);

      const actionsCell = el('td');
      const actions = el('div', 'row-actions');

      const open = el('button', 'btn-sm btn-ghost', 'Open');
      open.type = 'button';
      open.addEventListener('click', () => this.router.navigate(`/db/${encodeURIComponent(this.dbName)}/table/${encodeURIComponent(tableName)}`));

      const rename = el('button', 'btn-sm btn-ghost', 'Rename');
      rename.type = 'button';
      rename.addEventListener('click', () => this.openRenameTableDialog(tableName));

      const drop = el('button', 'btn-sm btn-danger', 'Drop');
      drop.type = 'button';
      drop.addEventListener('click', () => this.openDropTableDialog(tableName));

      actions.append(open, rename, drop);
      actionsCell.appendChild(actions);
      tr.appendChild(actionsCell);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }
}

/* ------------------------------------------------------------------ *
 * Table view page
 * ------------------------------------------------------------------ */
class TableViewPage {
  constructor(container, router, dbName, tableName) {
    this.container = container;
    this.router = router;
    this.dbName = dbName;
    this.tableName = tableName;
    this.currentPage = 0;
    this.pageSize = 25;
    this.columns = [];
    this.rows = [];
    this.total = 0;
    this.loading = true;
    this.loadFailed = false;
    this.rowsLoading = false;
    this.rowsRequestSeq = 0;
    this.render();   // build the shell once
    this.load();     // then load data once
  }

  async load() {
    this.loading = true;
    this.loadFailed = false;
    this.rowsLoading = false;
    this.rowsRequestSeq += 1;
    this.currentPage = 0;
    this.updateMeta();
    this.renderDataTab();
    this.renderSchemaTab();

    try {
      const [schema, rowsData] = await Promise.all([
        api(`/databases/${encodeURIComponent(this.dbName)}/tables/${encodeURIComponent(this.tableName)}`),
        api(`/databases/${encodeURIComponent(this.dbName)}/tables/${encodeURIComponent(this.tableName)}/rows?limit=${this.pageSize}&offset=${this.currentPage * this.pageSize}`)
      ]);
      this.columns = (schema && schema.columns) || [];
      this.rows = (rowsData && rowsData.rows) || [];
      this.total = rowsData && typeof rowsData.total === 'number' ? rowsData.total : this.rows.length;
      this.loading = false;
      this.loadFailed = false;
      this.updateMeta();
      this.renderDataTab();
      this.renderSchemaTab();
    } catch (error) {
      this.loading = false;
      this.loadFailed = true;
      this.updateMeta();
      this.renderDataTab();
      this.renderSchemaTab();
      showError(`Couldn't load table data. ${error.message}`);
    }
  }

  async loadRows() {
    const seq = (this.rowsRequestSeq += 1);
    this.rowsLoading = true;
    this.loadFailed = false;
    this.renderDataTab();

    try {
      const rowsData = await api(`/databases/${encodeURIComponent(this.dbName)}/tables/${encodeURIComponent(this.tableName)}/rows?limit=${this.pageSize}&offset=${this.currentPage * this.pageSize}`);
      if (seq !== this.rowsRequestSeq) return;
      this.rows = (rowsData && rowsData.rows) || [];
      this.total = rowsData && typeof rowsData.total === 'number' ? rowsData.total : this.rows.length;
      this.rowsLoading = false;

      const totalPages = Math.max(1, Math.ceil(this.total / this.pageSize));
      if (this.currentPage > totalPages - 1) {
        this.currentPage = totalPages - 1;
        this.updateMeta();
        this.loadRows();
        return;
      }

      this.updateMeta();
      this.renderDataTab();
    } catch (error) {
      if (seq !== this.rowsRequestSeq) return;
      this.rowsLoading = false;
      this.loadFailed = true;
      this.updateMeta();
      this.renderDataTab();
      showError(`Couldn't load table data. ${error.message}`);
    }
  }

  updateMeta() {
    if (!this.metaEl) return;
    if (this.loading) this.metaEl.textContent = 'Loading…';
    else if (this.loadFailed) this.metaEl.textContent = 'Unavailable';
    else this.metaEl.textContent = formatCount(this.total, 'row');
  }

  render() {
    this.container.replaceChildren();

    const header = pageHeader({
      title: this.tableName,
      meta: 'Loading…',
      crumbs: [
        { label: 'Databases', href: '#/' },
        { label: this.dbName, href: `#/db/${encodeURIComponent(this.dbName)}` },
        { label: this.tableName }
      ]
    });
    this.container.appendChild(header);
    this.metaEl = header.querySelector('.page-meta');

    const tabs = el('div', 'tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Table views');

    const dataBtn = el('button', 'tab-btn active', 'Data');
    dataBtn.type = 'button';
    dataBtn.id = 'data-tab-btn';
    dataBtn.setAttribute('role', 'tab');
    dataBtn.setAttribute('aria-controls', 'data-tab');
    dataBtn.setAttribute('aria-selected', 'true');
    dataBtn.tabIndex = 0;

    const schemaBtn = el('button', 'tab-btn', 'Schema');
    schemaBtn.type = 'button';
    schemaBtn.id = 'schema-tab-btn';
    schemaBtn.setAttribute('role', 'tab');
    schemaBtn.setAttribute('aria-controls', 'schema-tab');
    schemaBtn.setAttribute('aria-selected', 'false');
    schemaBtn.tabIndex = -1;

    const tabOrder = ['data', 'schema'];
    const onKeydown = (e) => {
      const current = e.currentTarget === schemaBtn ? 'schema' : 'data';
      let next = null;
      if (e.key === 'ArrowRight') next = tabOrder[(tabOrder.indexOf(current) + 1) % tabOrder.length];
      else if (e.key === 'ArrowLeft') next = tabOrder[(tabOrder.indexOf(current) - 1 + tabOrder.length) % tabOrder.length];
      else if (e.key === 'Home') next = 'data';
      else if (e.key === 'End') next = 'schema';
      if (!next) return;
      e.preventDefault();
      this.showTab(next);
      const target = next === 'data' ? dataBtn : schemaBtn;
      target.focus();
    };

    dataBtn.addEventListener('click', () => this.showTab('data'));
    schemaBtn.addEventListener('click', () => this.showTab('schema'));
    dataBtn.addEventListener('keydown', onKeydown);
    schemaBtn.addEventListener('keydown', onKeydown);
    tabs.append(dataBtn, schemaBtn);
    this.container.appendChild(tabs);

    const dataPanel = el('div', 'tab-content active');
    dataPanel.id = 'data-tab';
    dataPanel.setAttribute('role', 'tabpanel');
    dataPanel.setAttribute('aria-labelledby', 'data-tab-btn');
    dataPanel.tabIndex = 0;

    const schemaPanel = el('div', 'tab-content');
    schemaPanel.id = 'schema-tab';
    schemaPanel.setAttribute('role', 'tabpanel');
    schemaPanel.setAttribute('aria-labelledby', 'schema-tab-btn');
    schemaPanel.tabIndex = 0;
    schemaPanel.hidden = true;

    this.container.append(dataPanel, schemaPanel);

    this.dataBtn = dataBtn;
    this.schemaBtn = schemaBtn;
    this.dataPanel = dataPanel;
    this.schemaPanel = schemaPanel;

    this.renderDataTab();
    this.renderSchemaTab();
  }

  showTab(name) {
    const isData = name !== 'schema';

    if (this.dataBtn) {
      this.dataBtn.classList.toggle('active', isData);
      this.dataBtn.setAttribute('aria-selected', isData ? 'true' : 'false');
      this.dataBtn.tabIndex = isData ? 0 : -1;
    }
    if (this.schemaBtn) {
      this.schemaBtn.classList.toggle('active', !isData);
      this.schemaBtn.setAttribute('aria-selected', isData ? 'false' : 'true');
      this.schemaBtn.tabIndex = isData ? -1 : 0;
    }
    if (this.dataPanel) {
      this.dataPanel.classList.toggle('active', isData);
      this.dataPanel.hidden = !isData;
    }
    if (this.schemaPanel) {
      this.schemaPanel.classList.toggle('active', !isData);
      this.schemaPanel.hidden = isData;
    }
  }

  sqlConsoleButton() {
    const btn = el('button', 'btn-primary', 'SQL console');
    btn.type = 'button';
    btn.addEventListener('click', () => this.router.navigate(`/db/${encodeURIComponent(this.dbName)}/sql`));
    return btn;
  }

  openAddColumnDialog() {
    dialogContext.db = this.dbName;
    dialogContext.table = this.tableName;
    dialogContext.onDone = () => this.load();
    resetAddColumnForm();
    openDialog('add-column-dialog');
  }

  renderDataTab() {
    const panel = this.dataPanel;
    if (!panel) return;
    panel.replaceChildren();
    setBusy(panel, this.loading || this.rowsLoading);

    if (this.loading || this.rowsLoading) {
      const frame = el('div', 'table-frame');
      const table = el('table', 'data-table');
      table.appendChild(el('caption', 'sr-only', 'Loading table data'));
      table.appendChild(loadingRows(Math.max(1, this.columns.length + 1)));
      frame.appendChild(table);
      panel.appendChild(frame);
      return;
    }

    if (this.loadFailed) {
      panel.appendChild(emptyState({
        title: "Couldn't load table data",
        copy: 'Reload the page to try again.'
      }));
      return;
    }

    if (this.total === 0) {
      const frame = el('div', 'table-frame');
      frame.appendChild(emptyState({
        title: 'This table has no rows',
        copy: 'Insert rows with the SQL console, then reload this page.',
        actions: [this.sqlConsoleButton()]
      }));
      panel.appendChild(frame);
      return;
    }

    const totalPages = Math.max(1, Math.ceil(this.total / this.pageSize));
    if (this.currentPage > totalPages - 1) this.currentPage = totalPages - 1;
    if (this.currentPage < 0) this.currentPage = 0;

    const start = this.currentPage * this.pageSize + 1;
    const end = Math.min(start + this.rows.length - 1, this.total);
    const pageRows = this.rows;

    const frame = el('div', 'table-frame');

    const toolbar = el('div', 'table-toolbar');
    const selectLabel = el('label', 'select-label', 'Rows');
    const select = el('select', 'page-size-select');
    for (const size of [25, 50, 100]) {
      const option = document.createElement('option');
      option.value = String(size);
      option.textContent = String(size);
      if (size === this.pageSize) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      this.pageSize = parseInt(select.value, 10);
      this.currentPage = 0;
      this.loadRows();
    });
    selectLabel.appendChild(select);
    toolbar.appendChild(selectLabel);
    frame.appendChild(toolbar);

    const scroll = el('div', 'table-scroll');
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', 'Table data');
    scroll.tabIndex = 0;

    const table = el('table', 'data-table');
    table.appendChild(el('caption', 'sr-only', `Rows ${formatNumber(start)}\u2013${formatNumber(end)} of ${formatNumber(this.total)}`));

    const numericColumns = this.columns.map((column) => isNumericType(column.type));

    const thead = el('thead');
    const headRow = el('tr');
    const gutter = rowNumberCell('', 'th');
    gutter.setAttribute('scope', 'col');
    headRow.appendChild(gutter);
    this.columns.forEach((column, index) => {
      const th = el('th', null, column.name);
      th.setAttribute('scope', 'col');
      th.appendChild(el('span', 'col-type', column.type || ''));
      if (numericColumns[index]) th.classList.add('num');
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    pageRows.forEach((row, rowIndex) => {
      const tr = el('tr');
      tr.appendChild(rowNumberCell(start + rowIndex));
      row.forEach((cell, cellIndex) => {
        const td = el('td');
        if (numericColumns[cellIndex]) td.classList.add('num');
        renderCell(td, cell);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    frame.appendChild(scroll);

    const footer = el('div', 'table-footer');
    footer.appendChild(el('span', 'range', `${formatNumber(start)}\u2013${formatNumber(end)} of ${formatNumber(this.total)}`));

    const nav = el('div', 'pagination-nav');
    const prev = el('button', 'btn-sm btn-secondary', 'Previous');
    prev.type = 'button';
    prev.disabled = this.currentPage === 0 || this.rowsLoading;
    prev.addEventListener('click', () => {
      if (this.currentPage > 0 && !this.rowsLoading) { this.currentPage -= 1; this.loadRows(); }
    });
    const next = el('button', 'btn-sm btn-secondary', 'Next');
    next.type = 'button';
    next.disabled = this.currentPage >= totalPages - 1 || this.rowsLoading;
    next.addEventListener('click', () => {
      if (this.currentPage < totalPages - 1 && !this.rowsLoading) { this.currentPage += 1; this.loadRows(); }
    });
    nav.append(prev, next);
    footer.appendChild(nav);

    frame.appendChild(footer);
    panel.appendChild(frame);
  }

  renderSchemaTab() {
    const panel = this.schemaPanel;
    if (!panel) return;
    panel.replaceChildren();
    setBusy(panel, this.loading);

    if (this.loading) {
      const frame = el('div', 'table-frame');
      const table = el('table', 'data-table');
      table.appendChild(loadingRows(5));
      frame.appendChild(table);
      panel.appendChild(frame);
      return;
    }

    if (this.loadFailed) {
      panel.appendChild(emptyState({
        title: "Couldn't load table data",
        copy: 'Reload the page to try again.'
      }));
      return;
    }

    if (this.columns.length === 0) {
      panel.appendChild(emptyState({
        title: 'No columns',
        copy: 'This table has no schema information to show.'
      }));
      return;
    }

    const header = el('div', 'schema-header');
    header.appendChild(el('h2', null, 'Table schema'));
    const addBtn = el('button', 'btn-primary', 'Add column');
    addBtn.type = 'button';
    addBtn.addEventListener('click', () => this.openAddColumnDialog());
    header.appendChild(addBtn);
    panel.appendChild(header);

    const table = el('table', 'data-table');
    table.appendChild(el('caption', 'sr-only', 'Table schema'));

    const thead = el('thead');
    const headRow = el('tr');
    for (const label of ['#', 'Column', 'Type', 'Constraints', 'Default']) {
      const th = el('th', null, label);
      th.setAttribute('scope', 'col');
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    this.columns.forEach((column, index) => {
      const tr = el('tr');

      const ordinal = rowNumberCell(String(index + 1).padStart(2, '0'));
      ordinal.classList.add('ordinal');
      tr.appendChild(ordinal);

      tr.appendChild(el('td', null, column.name));
      tr.appendChild(el('td', null, column.type || ''));

      const constraints = el('td');
      if (column.pk) constraints.appendChild(el('span', 'chip chip-pk', 'PK'));
      if (column.pk && column.notnull) constraints.appendChild(document.createTextNode(' '));
      if (column.notnull) constraints.appendChild(el('span', 'chip chip-null', 'NOT NULL'));
      tr.appendChild(constraints);

      tr.appendChild(el(
        'td',
        null,
        column.dflt_value !== null && column.dflt_value !== undefined ? String(column.dflt_value) : ''
      ));

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    panel.appendChild(table);
  }
}

/* ------------------------------------------------------------------ *
 * SQL console page
 * ------------------------------------------------------------------ */
class SQLConsolePage {
  constructor(container, router, dbName) {
    this.container = container;
    this.router = router;
    this.dbName = dbName;
    this.running = false;
    this.render();
  }

  render() {
    this.container.replaceChildren();

    const wrap = el('div', 'sql-console');

    wrap.appendChild(pageHeader({
      title: 'SQL console',
      meta: this.dbName,
      crumbs: [
        { label: 'Databases', href: '#/' },
        { label: this.dbName, href: `#/db/${encodeURIComponent(this.dbName)}` },
        { label: 'SQL console' }
      ]
    }));

    const note = el('div', 'note note-warn');
    note.appendChild(el('strong', null, 'Careful'));
    note.appendChild(el('p', null, 'SQL runs as written. There is no confirmation and no undo.'));
    wrap.appendChild(note);

    const editor = el('div', 'sql-editor');
    const editorBar = el('div', 'editor-bar');
    editorBar.appendChild(el('span', 'editor-title', 'Query'));
    editorBar.appendChild(el('span', 'field-hint', 'Ctrl + Enter to run'));
    editor.appendChild(editorBar);

    const textarea = document.createElement('textarea');
    textarea.id = 'sql-input';
    textarea.setAttribute('aria-label', 'SQL query');
    textarea.placeholder = 'Enter SQL here...';
    textarea.rows = 10;
    editor.appendChild(textarea);

    const controls = el('div', 'controls');
    const limitControl = el('div', 'limit-control');
    const limitLabel = document.createElement('label');
    limitLabel.htmlFor = 'limit-input';
    limitLabel.textContent = 'Row limit';
    const limitInput = document.createElement('input');
    limitInput.type = 'number';
    limitInput.id = 'limit-input';
    limitInput.value = '100';
    limitInput.min = '1';
    limitInput.max = '1000';
    limitControl.append(limitLabel, limitInput);

    const runBtn = el('button', 'btn-primary', 'Run query');
    runBtn.id = 'run-button';
    runBtn.type = 'button';
    controls.append(limitControl, runBtn);
    editor.appendChild(controls);
    wrap.appendChild(editor);

    const resultsContainer = el('div', 'results-container');
    const resultsHeader = el('div', 'results-header');
    resultsHeader.appendChild(el('h2', null, 'Results'));
    const info = el('div', 'results-info');
    info.id = 'results-info';
    resultsHeader.appendChild(info);
    resultsContainer.appendChild(resultsHeader);
    const grid = el('div');
    grid.id = 'results-grid';
    resultsContainer.appendChild(grid);
    wrap.appendChild(resultsContainer);

    this.container.appendChild(wrap);

    this.sqlInput = textarea;
    this.limitInput = limitInput;
    this.resultsInfo = info;
    this.resultsGrid = grid;
    this.runBtn = runBtn;

    runBtn.addEventListener('click', () => this.execute());
    textarea.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        if (!this.running) this.execute();
      }
    });
  }

  async execute() {
    if (this.running) return;
    const sql = this.sqlInput.value.trim();
    if (!sql) { showError('Please enter SQL to execute'); return; }
    const limit = Math.max(1, Math.min(1000, parseInt(this.limitInput.value, 10) || 100));

    this.running = true;
    const restore = setPending(this.runBtn, 'Running…');
    this.resultsGrid.replaceChildren();
    this.resultsInfo.textContent = '';

    try {
      const data = await api(`/databases/${encodeURIComponent(this.dbName)}/sql`, {
        method: 'POST',
        body: JSON.stringify({ sql, args: [] })
      });
      this.displayResults(data.columns || [], data.rows || [], limit);
    } catch (error) {
      showError(`Couldn't run query. ${error.message}`);
    } finally {
      this.running = false;
      restore();
    }
  }

  displayResults(columns, rows, limit) {
    const limited = rows.slice(0, limit);
    this.resultsInfo.textContent = limited.length < rows.length
      ? `Showing ${formatNumber(limited.length)} of ${formatNumber(rows.length)} rows`
      : formatCount(limited.length, 'row');

    this.resultsGrid.replaceChildren();

    if (limited.length === 0) {
      this.resultsGrid.appendChild(emptyState({
        title: 'No rows returned',
        copy: "The statement ran, but it didn't return any rows."
      }));
      return;
    }

    const numericColumns = inferNumericColumns(limited);

    const frame = el('div', 'table-frame');
    const scroll = el('div', 'results-grid table-scroll');
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', 'Query results');
    scroll.tabIndex = 0;

    const table = el('table', 'results-table');
    table.appendChild(el('caption', 'sr-only', 'Query results'));

    const thead = el('thead');
    const headRow = el('tr');
    const gutter = rowNumberCell('', 'th');
    gutter.setAttribute('scope', 'col');
    headRow.appendChild(gutter);
    columns.forEach((name, index) => {
      const th = el('th', null, name);
      th.setAttribute('scope', 'col');
      if (numericColumns[index]) th.classList.add('num');
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    limited.forEach((row, rowIndex) => {
      const tr = el('tr');
      tr.appendChild(rowNumberCell(rowIndex + 1));
      row.forEach((cell, cellIndex) => {
        const td = el('td');
        if (numericColumns[cellIndex]) td.classList.add('num');
        renderCell(td, cell);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    scroll.appendChild(table);
    frame.appendChild(scroll);
    this.resultsGrid.appendChild(frame);
  }
}

/* ------------------------------------------------------------------ *
 * Auth page
 * ------------------------------------------------------------------ */
class AuthPage {
  constructor(container) {
    this.container = container;
    this.authConfig = null;
    this.databases = [];
    this.loading = true;
    this.loadFailed = false;
    this.accessSelect = null;
    this.databaseSelect = null;
    this.expirySelect = null;
    this.generateBtn = null;
    this.databaseHint = null;
    this.resultEl = null;
    this.render();
    this.load();
  }

  async load() {
    this.loading = true;
    this.loadFailed = false;
    this.render();
    try {
      const [authConfig, databases] = await Promise.all([
        api('/auth/config'),
        api('/databases')
      ]);
      this.authConfig = authConfig || {};
      this.databases = databases || [];
      this.loading = false;
      this.loadFailed = false;
      this.render();
    } catch (error) {
      this.loading = false;
      this.loadFailed = true;
      this.render();
      showError("Couldn't load auth settings. " + error.message);
    }
  }

  render() {
    this.container.replaceChildren();

    const meta = this.loading
      ? 'Loading…'
      : (this.loadFailed ? 'Unavailable' : 'Generate sqld credentials');

    this.container.appendChild(pageHeader({
      title: 'Auth',
      meta,
      crumbs: [{ label: 'Auth' }]
    }));

    if (this.loading) {
      this.container.appendChild(el('p', 'field-hint', 'Loading auth settings…'));
      return;
    }

    if (this.loadFailed) {
      this.container.appendChild(emptyState({
        title: "Couldn't load auth settings",
        copy: 'Reload the page to try again.'
      }));
      return;
    }

    const authConfig = this.authConfig || {};

    if (authConfig.appAuthDisabled) {
      const warning = el('div', 'note note-warn');
      warning.appendChild(el('strong', null, 'App authentication is disabled'));
      warning.appendChild(el('p', null, 'Anyone who can reach this page can mint sqld tokens. Set ADMIN_USER and ADMIN_PASSWORD and ALLOW_NO_AUTH=false before exposing this app.'));
      this.container.appendChild(warning);
    }

    const note = el('div', 'note');
    note.appendChild(el('strong', null, 'Tokens are shown once'));
    note.appendChild(el('p', null, 'Each token is displayed once and is not stored by this app. Treat it as a full credential for its scope.'));
    this.container.appendChild(note);

    if (!authConfig.signingEnabled) {
      this.container.appendChild(emptyState({
        title: 'Token signing is not configured',
        copy: 'Mount the signing key and set SQLD_JWT_PRIVATE_KEY_FILE, then reload this page.'
      }));
      return;
    }

    this.renderForm(authConfig);
  }

  renderForm(authConfig) {
    const form = el('form', 'auth-form');
    form.addEventListener('submit', (event) => this.onSubmit(event));

    // Access
    const accessField = el('div', 'field');
    const accessLabel = el('label', null, 'Access');
    accessLabel.htmlFor = 'auth-access';
    const accessSelect = document.createElement('select');
    accessSelect.id = 'auth-access';
    const writeOption = document.createElement('option');
    writeOption.value = 'write';
    writeOption.textContent = 'Read/write';
    const readOption = document.createElement('option');
    readOption.value = 'read';
    readOption.textContent = 'Read-only';
    accessSelect.append(writeOption, readOption);
    accessField.append(accessLabel, accessSelect);

    // Database
    const databaseField = el('div', 'field');
    const databaseLabel = el('label', null, 'Database');
    databaseLabel.htmlFor = 'auth-database';
    const databaseSelect = document.createElement('select');
    databaseSelect.id = 'auth-database';
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = 'All databases';
    databaseSelect.appendChild(allOption);
    for (const database of this.databases) {
      const option = document.createElement('option');
      option.value = database;
      option.textContent = database;
      databaseSelect.appendChild(option);
    }
    if (this.databases.length > 0) {
      databaseSelect.value = this.databases[0];
    }
    const databaseHint = el('p', 'field-hint');
    databaseField.append(databaseLabel, databaseSelect, databaseHint);

    // Expiry
    const expiryField = el('div', 'field');
    const expiryLabel = el('label', null, 'Expires');
    expiryLabel.htmlFor = 'auth-expiry';
    const expirySelect = document.createElement('select');
    expirySelect.id = 'auth-expiry';
    const expiryOptions = Array.isArray(authConfig.expiryOptions) ? authConfig.expiryOptions : [];
    for (const option of expiryOptions) {
      const node = document.createElement('option');
      node.value = String(option.seconds);
      node.textContent = option.label;
      if (option.seconds === authConfig.defaultExpirySeconds) node.selected = true;
      expirySelect.appendChild(node);
    }
    expiryField.append(expiryLabel, expirySelect);

    const generateBtn = el('button', 'btn-primary', 'Generate token');
    generateBtn.type = 'submit';

    form.append(accessField, databaseField, expiryField, generateBtn);
    this.container.appendChild(form);

    const resultEl = el('div');
    this.container.appendChild(resultEl);

    this.accessSelect = accessSelect;
    this.databaseSelect = databaseSelect;
    this.expirySelect = expirySelect;
    this.generateBtn = generateBtn;
    this.databaseHint = databaseHint;
    this.resultEl = resultEl;

    accessSelect.addEventListener('change', () => this.updateDatabaseAvailability());
    databaseSelect.addEventListener('change', () => this.updateDatabaseAvailability());
    this.updateDatabaseAvailability();
  }

  updateDatabaseAvailability() {
    if (!this.databaseSelect) return;
    const readOnly = this.accessSelect.value === 'read';
    const allOption = this.databaseSelect.querySelector('option[value=""]');
    if (allOption) allOption.disabled = readOnly;

    if (readOnly && this.databaseSelect.value === '' && this.databases.length > 0) {
      this.databaseSelect.value = this.databases[0];
    }

    const noDatabase = this.databases.length === 0;
    if (this.generateBtn) this.generateBtn.disabled = readOnly && noDatabase;

    if (this.databaseHint) {
      if (readOnly && noDatabase) {
        this.databaseHint.textContent = 'Create a database first to generate a read-only token.';
      } else if (this.databaseSelect.value === '') {
        this.databaseHint.textContent = 'All databases grants read/write access to every database.';
      } else {
        this.databaseHint.textContent = '';
      }
    }
  }

  async onSubmit(event) {
    event.preventDefault();
    if (!this.authConfig || !this.authConfig.signingEnabled) return;

    const access = this.accessSelect.value;
    const database = this.databaseSelect.value === '' ? null : this.databaseSelect.value;
    const expiresInSeconds = Number(this.expirySelect.value);
    if (access === 'read' && database === null) return;

    if (this.resultEl) this.resultEl.replaceChildren();
    const restore = setPending(this.generateBtn, 'Generating…');

    try {
      const data = await api('/auth/tokens', {
        method: 'POST',
        body: JSON.stringify({ database, access, expiresInSeconds })
      });
      this.showResult(data, { database, access });
    } catch (error) {
      showError("Couldn't generate token. " + error.message);
    } finally {
      restore();
      this.updateDatabaseAvailability();
    }
  }

  showResult(data, request) {
    if (!this.resultEl || !data || typeof data.token !== 'string') return;
    const token = data.token;
    this.resultEl.replaceChildren();

    const field = el('div', 'field');
    const label = document.createElement('label');
    label.htmlFor = 'auth-token';
    label.textContent = 'Token';

    const textarea = document.createElement('textarea');
    textarea.id = 'auth-token';
    textarea.className = 'token-output';
    textarea.rows = 4;
    textarea.readOnly = true;
    textarea.value = token;

    const copyBtn = el('button', 'btn-secondary', 'Copy');
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', async () => {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(token);
          copyBtn.textContent = 'Copied';
          return;
        }
      } catch {
        // Fall through to manual selection.
      }
      textarea.focus();
      textarea.select();
    });

    const expires = data.expiresAt ? new Date(data.expiresAt) : null;
    const expiryText = expires && !Number.isNaN(expires.getTime())
      ? `Expires ${expires.toISOString()}. Copy it now. It is not stored.`
      : 'Copy it now. It is not stored.';

    const scope = request.database === null
      ? 'All databases (read/write)'
      : `${request.database} (${request.access === 'write' ? 'read/write' : 'read-only'})`;

    const actions = el('div', 'page-actions');
    actions.appendChild(copyBtn);

    field.append(
      label,
      textarea,
      el('p', 'field-hint', expiryText),
      el('p', 'field-hint', `Scope: ${scope}`),
      actions
    );
    this.resultEl.appendChild(field);
  }
}

/* ------------------------------------------------------------------ *
 * Dialog form helpers + one-time bindings
 * ------------------------------------------------------------------ */
let columnRowCounter = 1;

function resetNewTableForm() {
  const form = document.getElementById('new-table-form');
  if (!form) return;
  const nameInput = document.getElementById('new-table-name');
  if (nameInput) nameInput.value = '';
  const list = form.querySelector('.columns-list');
  if (!list) return;
  const rows = list.querySelectorAll('.column-row');
  rows.forEach((row, i) => {
    if (i > 0) {
      row.remove();
      return;
    }
    row.querySelectorAll('.column-name, .column-default').forEach((input) => { input.value = ''; });
    row.querySelectorAll('.column-pk, .column-notnull').forEach((input) => { input.checked = false; });
    const select = row.querySelector('.column-type');
    if (select) select.selectedIndex = 0;
  });
}

function resetAddColumnForm() {
  const form = document.getElementById('add-column-form');
  if (form) form.reset();
  const type = document.getElementById('add-column-type');
  if (type) type.selectedIndex = 0;
}

function bindDialogs() {
  const on = (id, event, fn) => {
    const node = document.getElementById(id);
    if (node) node.addEventListener(event, fn);
  };

  // Cancel/close buttons: close the enclosing <dialog> (no inline handlers, CSP-safe).
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.cancel-btn, .dialog-close');
    if (!btn) return;
    const dialog = btn.closest('dialog');
    if (dialog && dialog.open) dialog.close();
  });

  // New database
  on('new-database-form', 'submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('new-database-name');
    const name = input ? input.value.trim() : '';
    if (!name) { focusField(input); return; }
    const restore = setPending(submitButtonFor(e), 'Creating…');
    try {
      await api('/databases', { method: 'POST', body: JSON.stringify({ name }) });
      closeDialog('new-database-dialog');
      e.target.reset();
      if (dialogContext.onDone) dialogContext.onDone();
    } catch (error) {
      showError(`Couldn't create database. ${error.message}`);
      focusField(input);
    } finally {
      restore();
    }
  });

  // Adopt existing
  on('adopt-form', 'submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('adopt-database-name');
    const name = input ? input.value.trim() : '';
    if (!name) { focusField(input); return; }
    const restore = setPending(submitButtonFor(e), 'Adding…');
    try {
      await api('/databases/adopt', { method: 'POST', body: JSON.stringify({ name }) });
      closeDialog('adopt-dialog');
      e.target.reset();
      if (dialogContext.onDone) dialogContext.onDone();
    } catch (error) {
      showError(`Couldn't add database. ${error.message}`);
      focusField(input);
    } finally {
      restore();
    }
  });

  // Rename database
  on('rename-database-form', 'submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('rename-new-name');
    const newName = input ? input.value.trim() : '';
    const db = dialogContext.db;
    if (!newName || !db) { focusField(input); return; }
    const restore = setPending(submitButtonFor(e), 'Renaming…');
    try {
      await api(`/databases/${encodeURIComponent(db)}`, { method: 'PATCH', body: JSON.stringify({ name: newName }) });
      closeDialog('rename-database-dialog');
      e.target.reset();
      if (dialogContext.onDone) dialogContext.onDone();
    } catch (error) {
      showError(`Couldn't rename database. ${error.message}`);
      focusField(input);
    } finally {
      restore();
    }
  });

  // Duplicate database (fork uses { to })
  on('duplicate-database-form', 'submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('duplicate-new-name');
    const newName = input ? input.value.trim() : '';
    const db = dialogContext.db;
    if (!newName || !db) { focusField(input); return; }
    const restore = setPending(submitButtonFor(e), 'Duplicating…');
    try {
      await api(`/databases/${encodeURIComponent(db)}/fork`, { method: 'POST', body: JSON.stringify({ to: newName }) });
      closeDialog('duplicate-database-dialog');
      e.target.reset();
      if (dialogContext.onDone) dialogContext.onDone();
    } catch (error) {
      showError(`Couldn't duplicate database. ${error.message}`);
      focusField(input);
    } finally {
      restore();
    }
  });

  // Delete database (requires typing the exact name)
  on('delete-database-form', 'submit', async (e) => {
    e.preventDefault();
    const db = dialogContext.db;
    const input = document.getElementById('delete-confirm-name');
    const confirmBtn = document.getElementById('delete-database-confirm');
    if (!db) return;
    if (!input || input.value !== db) {
      focusField(input);
      return;
    }
    const restore = setPending(confirmBtn || submitButtonFor(e), 'Deleting…');
    try {
      await api(`/databases/${encodeURIComponent(db)}`, { method: 'DELETE' });
      closeDialog('delete-database-dialog');
      e.target.reset();
      if (dialogContext.onDone) dialogContext.onDone();
    } catch (error) {
      showError(`Couldn't delete database. ${error.message}`);
      focusField(input);
    } finally {
      restore();
    }
  });

  // New table (dynamic column rows)
  on('new-table-form', 'submit', async (e) => {
    e.preventDefault();
    const db = dialogContext.db;
    const tableNameInput = document.getElementById('new-table-name');
    const tableName = tableNameInput ? tableNameInput.value.trim() : '';
    const columns = {};
    let valid = true;
    let firstInvalidName = null;
    for (const row of document.querySelectorAll('#new-table-form .column-row')) {
      const nameInput = row.querySelector('.column-name');
      const name = nameInput ? nameInput.value.trim() : '';
      if (!name) { valid = false; firstInvalidName = nameInput; break; }
      const type = row.querySelector('.column-type').value;
      const pk = row.querySelector('.column-pk').checked;
      const notNull = row.querySelector('.column-notnull').checked;
      const def = row.querySelector('.column-default').value.trim();
      let spec = type;
      if (pk) spec += ' PRIMARY KEY';
      if (notNull) spec += ' NOT NULL';
      if (def !== '') spec += ` DEFAULT ${def}`;
      columns[name] = spec;
    }
    if (!tableName || !valid || Object.keys(columns).length === 0) {
      showError('Table name and at least one named column are required.');
      focusField(!tableName ? tableNameInput : (firstInvalidName || tableNameInput));
      return;
    }
    const restore = setPending(submitButtonFor(e), 'Creating…');
    try {
      await api(`/databases/${encodeURIComponent(db)}/tables`, { method: 'POST', body: JSON.stringify({ table: tableName, columns }) });
      closeDialog('new-table-dialog');
      e.target.reset();
      resetNewTableForm();
      if (dialogContext.onDone) dialogContext.onDone();
    } catch (error) {
      showError(`Couldn't create table. ${error.message}`);
      focusField(tableNameInput);
    } finally {
      restore();
    }
  });

  // Add/remove dynamic column rows in the new-table dialog
  const columnsList = document.querySelector('#new-table-form .columns-list');
  if (columnsList) {
    columnsList.addEventListener('click', (e) => {
      if (e.target.classList.contains('remove-column')) {
        const rows = columnsList.querySelectorAll('.column-row');
        if (rows.length > 1) e.target.closest('.column-row').remove();
      }
    });
  }
  on('add-column-btn', 'click', () => {
    const list = document.querySelector('#new-table-form .columns-list');
    if (!list) return;
    const template = list.querySelector('.column-row');
    if (!template) return;
    const clone = template.cloneNode(true);
    columnRowCounter += 1;
    const id = columnRowCounter;
    const controls = [
      ['.column-name', `new-table-column-${id}-name`],
      ['.column-type', `new-table-column-${id}-type`],
      ['.column-default', `new-table-column-${id}-default`]
    ];
    for (const [selector, newId] of controls) {
      const control = clone.querySelector(selector);
      if (!control) continue;
      const oldId = control.id;
      control.id = newId;
      if (oldId) {
        const label = clone.querySelector(`label[for="${oldId}"]`);
        if (label) label.htmlFor = newId;
      }
    }
    clone.querySelectorAll('.column-name, .column-default').forEach((input) => { input.value = ''; });
    clone.querySelectorAll('.column-pk, .column-notnull').forEach((input) => { input.checked = false; });
    list.appendChild(clone);
  });

  // Rename table
  on('rename-table-form', 'submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('rename-table-new-name');
    const newName = input ? input.value.trim() : '';
    const db = dialogContext.db;
    const table = dialogContext.table;
    if (!newName || !db || !table) { focusField(input); return; }
    const restore = setPending(submitButtonFor(e), 'Renaming…');
    try {
      await api(`/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}`, { method: 'PATCH', body: JSON.stringify({ name: newName }) });
      closeDialog('rename-table-dialog');
      e.target.reset();
      if (dialogContext.onDone) dialogContext.onDone();
    } catch (error) {
      showError(`Couldn't rename table. ${error.message}`);
      focusField(input);
    } finally {
      restore();
    }
  });

  // Drop table (requires typing the exact name)
  on('drop-table-form', 'submit', async (e) => {
    e.preventDefault();
    const db = dialogContext.db;
    const table = dialogContext.table;
    const input = document.getElementById('drop-table-confirm-name');
    const confirmBtn = document.getElementById('drop-table-confirm');
    if (!db || !table) return;
    if (!input || input.value !== table) {
      focusField(input);
      return;
    }
    const restore = setPending(confirmBtn || submitButtonFor(e), 'Dropping…');
    try {
      await api(`/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}`, { method: 'DELETE' });
      closeDialog('drop-table-dialog');
      e.target.reset();
      if (dialogContext.onDone) dialogContext.onDone();
    } catch (error) {
      showError(`Couldn't drop table. ${error.message}`);
      focusField(input);
    } finally {
      restore();
    }
  });

  // Add column
  on('add-column-form', 'submit', async (e) => {
    e.preventDefault();
    const db = dialogContext.db;
    const table = dialogContext.table;
    const nameInput = document.getElementById('add-column-name');
    const name = nameInput ? nameInput.value.trim() : '';
    const type = document.getElementById('add-column-type').value;
    const notNull = document.getElementById('add-column-notnull').checked;
    const defaultValue = document.getElementById('add-column-default').value;
    if (!name) { showError('Column name is required.'); focusField(nameInput); return; }
    if (!db || !table) { focusField(nameInput); return; }
    const payload = { name, type, notNull };
    if (defaultValue !== '') payload.defaultValue = defaultValue;
    const restore = setPending(submitButtonFor(e), 'Adding…');
    try {
      await api(`/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}/columns`, { method: 'POST', body: JSON.stringify(payload) });
      closeDialog('add-column-dialog');
      e.target.reset();
      resetAddColumnForm();
      if (dialogContext.onDone) dialogContext.onDone();
    } catch (error) {
      showError(`Couldn't add column. ${error.message}`);
      focusField(nameInput);
    } finally {
      restore();
    }
  });
}

/* ------------------------------------------------------------------ *
 * App bootstrap
 * ------------------------------------------------------------------ */
function main() {
  const router = new HashRouter();

  router.addRoute('/', () => {
    new DatabasesPage(document.getElementById('content'), router);
  });
  router.addRoute('/db/:db', (params) => {
    new TablesPage(document.getElementById('content'), router, params.db);
  });
  router.addRoute('/db/:db/table/:table', (params) => {
    new TableViewPage(document.getElementById('content'), router, params.db, params.table);
  });
  router.addRoute('/db/:db/sql', (params) => {
    new SQLConsolePage(document.getElementById('content'), router, params.db);
  });
  router.addRoute('/auth', () => {
    new AuthPage(document.getElementById('content'));
  });

  bindDialogs();

  // Nav-link listeners attached exactly once.
  document.querySelectorAll('nav a').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const href = (link.getAttribute('href') || '').replace(/^#/, '');
      router.navigate(href || '/');
    });
  });

  router.render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
