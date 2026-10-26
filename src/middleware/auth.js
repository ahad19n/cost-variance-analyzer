const { q } = require('../db');
const { idParam } = require('../services/validate');

function requireAuth(req, res, next) {
  if (req.session.userId) return next();
  if (req.accepts(['html', 'json']) === 'json') return res.status(401).json({ error: 'Authentication required' });
  return res.redirect('/login');
}

// Loads :id only if it belongs to the logged-in user. Other users' projects get the same
// 404 as non-existent ones, so attackers cannot even enumerate which IDs exist.
function loadOwnedProject(req, res, next) {
  const id = idParam.safeParse(req.params.id);
  const project = id.success ? q.projectForOwner.get(id.data, req.session.userId) : null;
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    err.expose = true;
    return next(err);
  }
  req.project = project;
  return next();
}

module.exports = { requireAuth, loadOwnedProject };
