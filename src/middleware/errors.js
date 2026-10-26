const config = require('../config');

function notFound(req, res, next) {
  const err = new Error('Page not found');
  err.status = 404;
  err.expose = true;
  next(err);
}

// Never leak stack traces or internal messages to the client.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode || 500;
  let message = err.expose ? err.message : 'Something went wrong.';

  if (err.code === 'EBADCSRFTOKEN' || err.message === 'invalid csrf token') {
    status = 403;
    message = 'Invalid or missing security token. Reload the page and try again.';
  } else if (err.code === 'LIMIT_FILE_SIZE') {
    status = 413;
    message = 'File too large (max 2 MB).';
  } else if (err.name === 'MulterError') {
    status = 400;
    message = 'Invalid upload.';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Request body too large.';
  }

  if (status >= 500 && !config.isTest) console.error(err);

  res.status(status);
  if (req.accepts(['html', 'json']) === 'json' || req.xhr || req.is('multipart/form-data') || req.is('application/json')) {
    return res.json({ error: message });
  }
  return res.render('error', { status, message });
}

module.exports = { notFound, errorHandler };
