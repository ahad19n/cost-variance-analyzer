const config = require('./config');
const app = require('./app');

app.listen(config.port, () => {
  console.log(`Cost Variance Analyzer listening on http://localhost:${config.port} (${config.env})`);
  if (!config.llm.baseURL) console.log('LITELLM_BASE_URL not set: AI summaries will use the local fallback.');
});
