const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  readUsers,
  readObligations,
  writeObligations,
  readPolicies,
  writePolicies,
  readActivity,
  writeActivity,
} = require('./lib/store');

const app = express();
const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

const successMessages = {
  obligation_created: 'Obligation created successfully.',
  obligation_updated: 'Obligation updated successfully.',
  obligation_deleted: 'Obligation deleted successfully.',
  policy_created: 'Policy created successfully.',
  policy_updated: 'Policy updated successfully.',
  policy_deleted: 'Policy deleted successfully.',
  policy_acknowledged: 'Policy acknowledgement recorded successfully.',
  profile_switched: 'Active user profile changed.',
};

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function parseList(value = '') {
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeText(value = '') {
  return String(value).trim();
}

function buildId() {
  return crypto.randomUUID();
}

function parseCookies(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const index = part.indexOf('=');
      if (index === -1) return acc;
      const key = part.slice(0, index);
      const value = decodeURIComponent(part.slice(index + 1));
      acc[key] = value;
      return acc;
    }, {});
}

function isOverdue(dateString) {
  if (!dateString) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateString);
  target.setHours(0, 0, 0, 0);
  return target < today;
}

function isDueSoon(dateString, days = 30) {
  if (!dateString) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateString);
  target.setHours(0, 0, 0, 0);
  const diff = target.getTime() - today.getTime();
  const daysDiff = Math.ceil(diff / (1000 * 60 * 60 * 24));
  return daysDiff >= 0 && daysDiff <= days;
}

function formatPercent(value) {
  return `${Math.round(value)}%`;
}

function matchesQuery(text, query) {
  return text.toLowerCase().includes(query.toLowerCase());
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function statusClass(status, overdue = false) {
  if (overdue) return 'danger';
  const normalized = String(status || '').toLowerCase();
  if (['completed', 'approved'].includes(normalized)) return 'success';
  if (['in progress', 'under review'].includes(normalized)) return 'warning';
  if (['open', 'draft'].includes(normalized)) return 'neutral';
  return 'neutral';
}

function actionLabel(actionType) {
  const map = {
    obligation_created: 'Obligation created',
    obligation_updated: 'Obligation updated',
    obligation_completed: 'Obligation completed',
    obligation_deleted: 'Obligation deleted',
    policy_created: 'Policy created',
    policy_updated: 'Policy updated',
    policy_review: 'Policy review updated',
    policy_acknowledged: 'Policy acknowledged',
    policy_deleted: 'Policy deleted',
  };
  return map[actionType] || 'Activity';
}

function entityPath(entityType, entityId) {
  if (entityType === 'obligation') return `/obligations/${entityId}`;
  if (entityType === 'policy') return `/policies/${entityId}`;
  if (entityType === 'user') return '/users';
  return '/activity';
}

function sortByNewestDate(list, field) {
  return [...list].sort((a, b) => {
    if (!a[field]) return 1;
    if (!b[field]) return -1;
    return new Date(b[field]) - new Date(a[field]);
  });
}

async function buildBaseData() {
  const [users, obligations, policies, activity] = await Promise.all([
    readUsers(),
    readObligations(),
    readPolicies(),
    readActivity(),
  ]);

  const usersById = Object.fromEntries(users.map((user) => [user.id, user]));

  const obligationsWithOwner = obligations
    .map((item) => ({
      ...item,
      owner: usersById[item.ownerId] || null,
      overdue: isOverdue(item.deadline),
      dueSoon: isDueSoon(item.deadline),
      actionCount: Array.isArray(item.actions) ? item.actions.length : 0,
      evidenceCount: Array.isArray(item.evidence) ? item.evidence.length : 0,
    }))
    .sort((a, b) => {
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline) - new Date(b.deadline);
    });

  const policiesWithOwner = policies
    .map((item) => ({
      ...item,
      owner: usersById[item.ownerId] || null,
      overdue: isOverdue(item.nextReviewDate),
      dueSoon: isDueSoon(item.nextReviewDate),
      acknowledgementCount: Array.isArray(item.acknowledgements) ? item.acknowledgements.length : 0,
    }))
    .sort((a, b) => {
      if (!a.nextReviewDate) return 1;
      if (!b.nextReviewDate) return -1;
      return new Date(a.nextReviewDate) - new Date(b.nextReviewDate);
    });

  const activityWithUsers = sortByNewestDate(activity, 'timestamp').map((entry) => ({
    ...entry,
    actor: usersById[entry.actorUserId] || null,
    label: actionLabel(entry.actionType),
    href: entityPath(entry.entityType, entry.entityId),
  }));

  return {
    users,
    usersById,
    obligations: obligationsWithOwner,
    policies: policiesWithOwner,
    activity: activityWithUsers,
  };
}

async function logActivity({ actorUserId, actionType, message, entityType, entityId, entityLabel }) {
  const activity = await readActivity();
  activity.unshift({
    id: buildId(),
    timestamp: new Date().toISOString(),
    actorUserId,
    actionType,
    message,
    entityType,
    entityId,
    entityLabel,
  });
  await writeActivity(activity.slice(0, 120));
}

function getRenderContext(req) {
  const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const cookies = parseCookies(req.headers.cookie || '');
  const currentUser = users.find((user) => user.id === cookies.grc_user) || users[0] || null;

  return {
    flashSuccess: successMessages[req.query.success] || '',
    currentUser,
    currentPath: req.path,
    userDirectory: users,
    formatDate,
    formatDateTime,
    statusClass,
  };
}

function renderPage(res, view, data = {}, statusCode) {
  if (statusCode) res.status(statusCode);
  return res.render(view, {
    ...getRenderContext(res.req),
    ...data,
  });
}

function getCurrentUserId(req) {
  return getRenderContext(req).currentUser?.id || null;
}

function renderNotFound(res, title = 'Page Not Found') {
  return renderPage(res, 'not-found', { title, page: '' }, 404);
}

app.post('/session/user', async (req, res) => {
  const users = await readUsers();
  const userId = normalizeText(req.body.userId);
  const returnTo = normalizeText(req.body.returnTo) || '/';
  const validUser = users.find((user) => user.id === userId) || users[0];
  res.setHeader('Set-Cookie', `grc_user=${encodeURIComponent(validUser.id)}; Path=/; Max-Age=2592000; SameSite=Lax`);
  res.redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}success=profile_switched`);
});

app.get('/', async (req, res) => {
  const { users, obligations, policies, activity } = await buildBaseData();

  const completedObligations = obligations.filter((item) => item.status === 'Completed').length;
  const approvedPolicies = policies.filter((item) => item.status === 'Approved').length;

  const stats = {
    totalObligations: obligations.length,
    overdueObligations: obligations.filter((item) => item.overdue).length,
    dueSoonObligations: obligations.filter((item) => item.dueSoon).length,
    openObligations: obligations.filter((item) => item.status !== 'Completed').length,
    totalPolicies: policies.length,
    overduePolicies: policies.filter((item) => item.overdue).length,
    dueSoonPolicies: policies.filter((item) => item.dueSoon).length,
    acknowledgements: policies.reduce((sum, item) => sum + item.acknowledgementCount, 0),
    obligationsCompletionRate: obligations.length ? formatPercent((completedObligations / obligations.length) * 100) : '0%',
    policyApprovalRate: policies.length ? formatPercent((approvedPolicies / policies.length) * 100) : '0%',
  };

  const urgentObligations = obligations.filter((item) => item.overdue || item.dueSoon).slice(0, 5);
  const upcomingPolicies = policies.filter((item) => item.nextReviewDate).slice(0, 5);

  const ownerWorkload = users
    .map((user) => ({
      ...user,
      obligationCount: obligations.filter((item) => item.ownerId === user.id && item.status !== 'Completed').length,
      policyCount: policies.filter((item) => item.ownerId === user.id && item.status !== 'Approved').length,
    }))
    .filter((user) => user.obligationCount || user.policyCount)
    .sort((a, b) => (b.obligationCount + b.policyCount) - (a.obligationCount + a.policyCount))
    .slice(0, 6);

  renderPage(res, 'dashboard', {
    title: 'Dashboard',
    page: 'dashboard',
    stats,
    obligations: obligations.slice(0, 6),
    policies: policies.slice(0, 6),
    urgentObligations,
    upcomingPolicies,
    recentActivity: activity.slice(0, 8),
    ownerWorkload,
  });
});

app.get('/obligations', async (req, res) => {
  const { obligations } = await buildBaseData();
  const q = normalizeText(req.query.q);
  const status = normalizeText(req.query.status);

  const filteredObligations = obligations.filter((item) => {
    const haystack = [item.title, item.source, item.category, item.owner?.name || '', item.notes || ''].join(' ');
    const queryOk = q ? matchesQuery(haystack, q) : true;
    const statusOk = status ? item.status === status : true;
    return queryOk && statusOk;
  });

  const stats = {
    total: filteredObligations.length,
    overdue: filteredObligations.filter((item) => item.overdue).length,
    dueSoon: filteredObligations.filter((item) => item.dueSoon).length,
    completed: filteredObligations.filter((item) => item.status === 'Completed').length,
  };

  renderPage(res, 'obligations', {
    title: 'Compliance Obligations',
    page: 'obligations',
    obligations: filteredObligations,
    filters: { q, status },
    stats,
  });
});

app.get('/obligations/new', async (req, res) => {
  const { users } = await buildBaseData();
  renderPage(res, 'obligation-form', {
    title: 'New Obligation',
    page: 'obligations',
    users,
    obligation: null,
    formAction: '/obligations',
    submitLabel: 'Create obligation',
  });
});

app.post('/obligations', async (req, res) => {
  const obligations = await readObligations();
  const newObligation = {
    id: buildId(),
    title: normalizeText(req.body.title),
    source: normalizeText(req.body.source),
    category: normalizeText(req.body.category),
    ownerId: normalizeText(req.body.ownerId),
    status: normalizeText(req.body.status),
    deadline: normalizeText(req.body.deadline),
    actions: parseList(req.body.actions),
    evidence: parseList(req.body.evidence),
    notes: normalizeText(req.body.notes),
  };

  obligations.push(newObligation);
  await writeObligations(obligations);
  await logActivity({
    actorUserId: getCurrentUserId(req),
    actionType: 'obligation_created',
    message: `Created obligation "${newObligation.title}" and assigned ownership.`,
    entityType: 'obligation',
    entityId: newObligation.id,
    entityLabel: newObligation.title,
  });
  res.redirect('/obligations?success=obligation_created');
});

app.get('/obligations/:id', async (req, res) => {
  const { usersById, activity } = await buildBaseData();
  const obligations = await readObligations();
  const obligation = obligations.find((item) => item.id === req.params.id);
  if (!obligation) return renderNotFound(res, 'Obligation Not Found');

  renderPage(res, 'obligation-detail', {
    title: obligation.title,
    page: 'obligations',
    obligation: {
      ...obligation,
      owner: usersById[obligation.ownerId] || null,
      overdue: isOverdue(obligation.deadline),
      dueSoon: isDueSoon(obligation.deadline),
      actionCount: Array.isArray(obligation.actions) ? obligation.actions.length : 0,
      evidenceCount: Array.isArray(obligation.evidence) ? obligation.evidence.length : 0,
    },
    relatedActivity: activity.filter((entry) => entry.entityType === 'obligation' && entry.entityId === obligation.id).slice(0, 6),
  });
});

app.get('/obligations/:id/edit', async (req, res) => {
  const { users } = await buildBaseData();
  const obligations = await readObligations();
  const obligation = obligations.find((item) => item.id === req.params.id);
  if (!obligation) return renderNotFound(res, 'Obligation Not Found');

  renderPage(res, 'obligation-form', {
    title: 'Edit Obligation',
    page: 'obligations',
    users,
    obligation,
    formAction: `/obligations/${obligation.id}/update`,
    submitLabel: 'Update obligation',
  });
});

app.post('/obligations/:id/update', async (req, res) => {
  const obligations = await readObligations();
  const index = obligations.findIndex((item) => item.id === req.params.id);
  if (index === -1) return renderNotFound(res, 'Obligation Not Found');

  obligations[index] = {
    ...obligations[index],
    title: normalizeText(req.body.title),
    source: normalizeText(req.body.source),
    category: normalizeText(req.body.category),
    ownerId: normalizeText(req.body.ownerId),
    status: normalizeText(req.body.status),
    deadline: normalizeText(req.body.deadline),
    actions: parseList(req.body.actions),
    evidence: parseList(req.body.evidence),
    notes: normalizeText(req.body.notes),
  };

  await writeObligations(obligations);
  await logActivity({
    actorUserId: getCurrentUserId(req),
    actionType: obligations[index].status === 'Completed' ? 'obligation_completed' : 'obligation_updated',
    message: `Updated obligation "${obligations[index].title}".`,
    entityType: 'obligation',
    entityId: obligations[index].id,
    entityLabel: obligations[index].title,
  });
  res.redirect('/obligations?success=obligation_updated');
});

app.post('/obligations/:id/delete', async (req, res) => {
  const obligations = await readObligations();
  const record = obligations.find((item) => item.id === req.params.id);
  if (!record) return renderNotFound(res, 'Obligation Not Found');

  await writeObligations(obligations.filter((item) => item.id !== req.params.id));
  await logActivity({
    actorUserId: getCurrentUserId(req),
    actionType: 'obligation_deleted',
    message: `Deleted obligation "${record.title}" from the register.`,
    entityType: 'obligation',
    entityId: record.id,
    entityLabel: record.title,
  });
  res.redirect('/obligations?success=obligation_deleted');
});

app.get('/policies', async (req, res) => {
  const { policies } = await buildBaseData();
  const q = normalizeText(req.query.q);
  const status = normalizeText(req.query.status);

  const filteredPolicies = policies.filter((item) => {
    const haystack = [item.title, item.summary || '', item.owner?.name || '', item.version || ''].join(' ');
    const queryOk = q ? matchesQuery(haystack, q) : true;
    const statusOk = status ? item.status === status : true;
    return queryOk && statusOk;
  });

  const stats = {
    total: filteredPolicies.length,
    overdue: filteredPolicies.filter((item) => item.overdue).length,
    dueSoon: filteredPolicies.filter((item) => item.dueSoon).length,
    approved: filteredPolicies.filter((item) => item.status === 'Approved').length,
  };

  renderPage(res, 'policies', {
    title: 'Policies',
    page: 'policies',
    policies: filteredPolicies,
    filters: { q, status },
    stats,
  });
});

app.get('/policies/new', async (req, res) => {
  const { users } = await buildBaseData();
  renderPage(res, 'policy-form', {
    title: 'New Policy',
    page: 'policies',
    users,
    policy: null,
    formAction: '/policies',
    submitLabel: 'Create policy',
  });
});

app.post('/policies', async (req, res) => {
  const policies = await readPolicies();
  const newPolicy = {
    id: buildId(),
    title: normalizeText(req.body.title),
    version: normalizeText(req.body.version),
    ownerId: normalizeText(req.body.ownerId),
    status: normalizeText(req.body.status),
    lastReviewed: normalizeText(req.body.lastReviewed),
    nextReviewDate: normalizeText(req.body.nextReviewDate),
    documentPath: normalizeText(req.body.documentPath),
    summary: normalizeText(req.body.summary),
    acknowledgements: [],
  };

  policies.push(newPolicy);
  await writePolicies(policies);
  await logActivity({
    actorUserId: getCurrentUserId(req),
    actionType: 'policy_created',
    message: `Created policy "${newPolicy.title}" in the library.`,
    entityType: 'policy',
    entityId: newPolicy.id,
    entityLabel: newPolicy.title,
  });
  res.redirect('/policies?success=policy_created');
});

app.get('/policies/:id', async (req, res) => {
  const { users, usersById, activity } = await buildBaseData();
  const policies = await readPolicies();
  const policy = policies.find((item) => item.id === req.params.id);
  if (!policy) return renderNotFound(res, 'Policy Not Found');

  const acknowledgements = (policy.acknowledgements || []).map((entry) => ({
    ...entry,
    user: usersById[entry.userId] || null,
  }));

  renderPage(res, 'policy-detail', {
    title: policy.title,
    page: 'policies',
    policy: {
      ...policy,
      owner: usersById[policy.ownerId] || null,
      overdue: isOverdue(policy.nextReviewDate),
      dueSoon: isDueSoon(policy.nextReviewDate),
    },
    users,
    acknowledgements,
    relatedActivity: activity.filter((entry) => entry.entityType === 'policy' && entry.entityId === policy.id).slice(0, 6),
  });
});

app.get('/policies/:id/edit', async (req, res) => {
  const { users } = await buildBaseData();
  const policies = await readPolicies();
  const policy = policies.find((item) => item.id === req.params.id);
  if (!policy) return renderNotFound(res, 'Policy Not Found');

  renderPage(res, 'policy-form', {
    title: 'Edit Policy',
    page: 'policies',
    users,
    policy,
    formAction: `/policies/${policy.id}/update`,
    submitLabel: 'Update policy',
  });
});

app.post('/policies/:id/update', async (req, res) => {
  const policies = await readPolicies();
  const index = policies.findIndex((item) => item.id === req.params.id);
  if (index === -1) return renderNotFound(res, 'Policy Not Found');

  policies[index] = {
    ...policies[index],
    title: normalizeText(req.body.title),
    version: normalizeText(req.body.version),
    ownerId: normalizeText(req.body.ownerId),
    status: normalizeText(req.body.status),
    lastReviewed: normalizeText(req.body.lastReviewed),
    nextReviewDate: normalizeText(req.body.nextReviewDate),
    documentPath: normalizeText(req.body.documentPath),
    summary: normalizeText(req.body.summary),
  };

  await writePolicies(policies);
  await logActivity({
    actorUserId: getCurrentUserId(req),
    actionType: policies[index].status === 'Approved' ? 'policy_review' : 'policy_updated',
    message: `Updated policy "${policies[index].title}" and refreshed its governance metadata.`,
    entityType: 'policy',
    entityId: policies[index].id,
    entityLabel: policies[index].title,
  });
  res.redirect('/policies?success=policy_updated');
});

app.post('/policies/:id/acknowledge', async (req, res) => {
  const userId = normalizeText(req.body.userId);
  if (!userId) return res.redirect(`/policies/${req.params.id}`);

  const { usersById } = await buildBaseData();
  const policies = await readPolicies();
  const index = policies.findIndex((item) => item.id === req.params.id);
  if (index === -1) return renderNotFound(res, 'Policy Not Found');

  const acknowledgements = policies[index].acknowledgements || [];
  const alreadyExists = acknowledgements.some((entry) => entry.userId === userId);

  if (!alreadyExists) {
    acknowledgements.push({ userId, readAt: new Date().toISOString() });
    policies[index].acknowledgements = acknowledgements;
    await writePolicies(policies);
    const targetUser = usersById[userId];
    await logActivity({
      actorUserId: userId,
      actionType: 'policy_acknowledged',
      message: `${targetUser ? targetUser.name : 'Employee'} acknowledged "${policies[index].title}".`,
      entityType: 'policy',
      entityId: policies[index].id,
      entityLabel: policies[index].title,
    });
  }

  res.redirect(`/policies/${req.params.id}?success=policy_acknowledged`);
});

app.post('/policies/:id/delete', async (req, res) => {
  const policies = await readPolicies();
  const record = policies.find((item) => item.id === req.params.id);
  if (!record) return renderNotFound(res, 'Policy Not Found');

  await writePolicies(policies.filter((item) => item.id !== req.params.id));
  await logActivity({
    actorUserId: getCurrentUserId(req),
    actionType: 'policy_deleted',
    message: `Deleted policy "${record.title}" from the library.`,
    entityType: 'policy',
    entityId: record.id,
    entityLabel: record.title,
  });
  res.redirect('/policies?success=policy_deleted');
});

app.get('/activity', async (req, res) => {
  const { activity } = await buildBaseData();
  renderPage(res, 'activity', {
    title: 'Activity Log',
    page: 'activity',
    activity,
  });
});

app.get('/users', async (req, res) => {
  const { users, obligations, policies } = await buildBaseData();
  const directory = users.map((user) => ({
    ...user,
    obligationCount: obligations.filter((item) => item.ownerId === user.id).length,
    openObligations: obligations.filter((item) => item.ownerId === user.id && item.status !== 'Completed').length,
    policyCount: policies.filter((item) => item.ownerId === user.id).length,
    duePolicies: policies.filter((item) => item.ownerId === user.id && item.status !== 'Approved').length,
    acknowledgements: policies.reduce((sum, item) => sum + (item.acknowledgements || []).filter((entry) => entry.userId === user.id).length, 0),
  }));

  const accessStats = Object.entries(directory.reduce((acc, user) => {
    acc[user.accessRole] = (acc[user.accessRole] || 0) + 1;
    return acc;
  }, {})).map(([role, count]) => ({ role, count }));

  renderPage(res, 'users', {
    title: 'Users & Roles',
    page: 'users',
    users: directory,
    accessStats,
  });
});

app.use((req, res) => renderNotFound(res));

app.use((err, req, res, next) => {
  console.error(err);
  renderPage(res, 'error', {
    title: 'Server Error',
    page: '',
  }, 500);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
