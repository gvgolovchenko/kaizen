import * as rcClient from './rc-client.js';
import * as rcTickets from './db/rc-tickets.js';
import * as issues from './db/issues.js';
import * as products from './db/products.js';

const PRIORITY_MAP = { 4: 'critical', 3: 'high', 1: 'medium' };
const TYPE_MAP = { 1: 'bug', 2: 'improvement', 3: 'improvement', 4: 'improvement' };

export async function syncTickets(productId) {
  const product = await products.getById(productId);
  if (!product) throw new Error('Product not found');
  if (!product.rc_system_id) throw new Error('Product has no rc_system_id');

  const tickets = await rcClient.getTickets(product.rc_system_id, product.rc_module_id);

  let newCount = 0;
  let updatedCount = 0;

  for (const ticket of tickets) {
    const result = await rcTickets.upsert(productId, ticket);
    if (result.is_new) {
      newCount++;
    } else {
      updatedCount++;
    }
  }

  return { new: newCount, updated: updatedCount, total: tickets.length };
}

export async function importTicket(rcTicketCacheId) {
  const ticket = await rcTickets.getById(rcTicketCacheId);
  if (!ticket) throw new Error('RC ticket not found');
  if (ticket.sync_status === 'imported') throw new Error('Ticket already imported');

  const issue = await issues.create({
    product_id: ticket.product_id,
    title: ticket.title,
    description: ticket.description || '',
    type: TYPE_MAP[ticket.rc_type_id] || 'improvement',
    priority: PRIORITY_MAP[ticket.rc_priority_id] || 'medium',
    rc_ticket_id: ticket.rc_ticket_id,
  });

  await rcTickets.updateSyncStatus(rcTicketCacheId, 'imported', issue.id);

  return issue;
}

export async function importBulk(rcTicketCacheIds) {
  const results = [];
  for (const id of rcTicketCacheIds) {
    const issue = await importTicket(id);
    results.push(issue);
  }
  return results;
}

/**
 * Auto-import new RC tickets matching priority rules.
 * @param {string} productId
 * @param {string[]} priorityRules - e.g. ['critical', 'high']
 * @returns {{ imported: number, tickets: object[] }}
 */
export async function autoImportByRules(productId, priorityRules = []) {
  if (!priorityRules.length) return { imported: 0, tickets: [] };

  // Get all "new" tickets
  const newTickets = await rcTickets.getByProduct(productId, 'new');

  // Map Kaizen priority names back to RC priority IDs for filtering
  const rcPriorityByKaizen = {};
  for (const [rcId, kaizenName] of Object.entries(PRIORITY_MAP)) {
    rcPriorityByKaizen[kaizenName] = Number(rcId);
  }

  const matching = newTickets.filter(t => {
    const kaizenPriority = PRIORITY_MAP[t.rc_priority_id] || 'medium';
    return priorityRules.includes(kaizenPriority);
  });

  const imported = [];
  for (const ticket of matching) {
    try {
      const issue = await importTicket(ticket.id);
      imported.push(issue);
    } catch {
      // skip already imported or other errors
    }
  }

  return { imported: imported.length, tickets: imported };
}
