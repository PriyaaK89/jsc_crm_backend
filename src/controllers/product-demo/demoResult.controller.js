// controllers/product-demo/demoResult.controller.js
const dr = require('../../models/product-demo/demoResult.model');
const { HttpError } = dr;

async function run(res, fn) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ success: false, message: err.message });
    console.error('[demo-result]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong' });
  }
}

exports.setCrop = (req, res) => run(res, async () => {
  const cropId = Number(req.body.crop_id);
  if (!cropId) throw new HttpError(400, 'crop_id is required');
  await dr.setDemoCrop(req.params.id, cropId, req.user);
  res.json({ success: true, message: 'Crop set for this demo' });
});

exports.getGrowthFieldsForm = (req, res) => run(res, async () => {
  const data = await dr.getGrowthFieldsForm(req.params.id, req.params.customerId, req.user);
  res.json({ success: true, data });
});

exports.addResult = (req, res) => run(res, async () => {
  const data = await dr.addResultForCustomer({
    demoId: req.params.id,
    customerId: req.params.customerId,
    resultNo: req.params.resultNo,
    body: req.body,
    files: req.files || [],
    user: req.user,
  });
  res.status(201).json({ success: true, message: `Result ${data.result_no} saved`, data });
});

exports.getResultsForCustomer = (req, res) => run(res, async () => {
  const data = await dr.getResultsForCustomer(req.params.id, req.params.customerId, req.user);
  res.json({ success: true, data, max_results: dr.MAX_RESULTS });
});

exports.listDemoCustomersWithProgress = (req, res) => run(res, async () => {
  const data = await dr.listDemoCustomersWithProgress(req.params.id);
  res.json({ success: true, data });
});

exports.myPendingResultCustomers = (req, res) => run(res, async () => {
  const data = await dr.getMyPendingResultCustomers(req.user.id, {
    search: (req.query.search || '').trim(),
    page: req.query.page,
    limit: req.query.limit,
  });
  res.json({ success: true, data });
});

exports.getFinalEvaluationForm = (req, res) => run(res, async () => {
  const data = await dr.getFinalEvaluationForm(req.params.id, req.params.customerId, req.user);
  res.json({ success: true, data });
});