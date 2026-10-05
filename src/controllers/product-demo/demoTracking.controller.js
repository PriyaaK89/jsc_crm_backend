// controllers/product-demo/demoTracking.controller.js
const tr = require('../../models/product-demo/demoTracking.model');
const { HttpError } = tr;

async function run(res, fn) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ success: false, message: err.message });
    console.error('[demo-tracking]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong' });
  }
}

const idOf = (v, name) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${name}`);
  return n;
};

// POST /:id/customers/:customerId/results/:resultNo/tracking/start
exports.startTracking = (req, res) => run(res, async () => {
  const data = await tr.startTracking({
    demoId: idOf(req.params.id, 'demo id'),
    customerId: idOf(req.params.customerId, 'customer id'),
    resultNo: req.params.resultNo,
    body: req.body,
    user: req.user,
  });
  res.status(data.resumed ? 200 : 201).json({
    success: true,
    message: data.resumed ? 'Field tracking resumed' : 'Field tracking started',
    data,
  });
});

// POST /tracking/:trackId/points   body: { points: [{ latitude, longitude, accuracy?, speed?, recorded_at? }] }
exports.addPoints = (req, res) => run(res, async () => {
  const data = await tr.addPoints({
    trackId: idOf(req.params.trackId, 'track id'),
    points: req.body && req.body.points,
    user: req.user,
  });
  res.json({ success: true, data });
});

// POST /tracking/:trackId/end   body: { latitude?, longitude?, accuracy?, points? }
exports.endTracking = (req, res) => run(res, async () => {
  const data = await tr.endTracking({
    trackId: idOf(req.params.trackId, 'track id'),
    body: req.body,
    user: req.user,
  });
  res.json({ success: true, message: 'Field tracking ended', data });
});

// GET /tracking/active  (the app calls this on launch to resume)
exports.myActiveTrack = (req, res) => run(res, async () => {
  res.json({ success: true, data: await tr.getMyActiveTrack(req.user) });
});

// GET /:id/tracks?linked=1
exports.listDemoTracks = (req, res) => run(res, async () => {
  const data = await tr.listDemoTracks(idOf(req.params.id, 'demo id'), req.user, {
    linkedOnly: req.query.linked === '1',
  });
  res.json({ success: true, data });
});

// GET /tracking/:trackId?max_points=2000
exports.getTrack = (req, res) => run(res, async () => {
  const data = await tr.getTrackDetail(idOf(req.params.trackId, 'track id'), req.user, {
    maxPoints: req.query.max_points,
  });
  res.json({ success: true, data });
});