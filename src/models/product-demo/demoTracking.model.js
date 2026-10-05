// models/product-demo/demoTracking.model.js
// Field tracking: one session per (customer, result stage). The employee's app
// streams GPS points; on result upload the session is linked to the result.
const db = require('../../config/db');
const { HttpError } = require('./httpError');
const m = require('./productDemo.model'); // canApproveDemo, RESULT_ELIGIBLE_STATUSES, MAX_RESULTS

// ---- CONFIG -----------------------------------------------------------
const TRACKING_REQUIRED = false;          // true => a result cannot be submitted without a field track
const MIN_POINTS_WHEN_REQUIRED = 2;
const MAX_POINTS_PER_REQUEST = 500;
const MAX_ACCURACY_M = 100;               // points/start fixes worse than this are rejected
const MIN_SEGMENT_M = 2;                  // ignore GPS jitter when summing distance
const MAX_SPEED_MPS = 60;                 // ignore impossible jumps (> 216 km/h) when summing distance
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const PAST_TOLERANCE_MS = 2 * 60 * 1000;
const DEFAULT_RETURN_POINTS = 2000;
const MAX_RETURN_POINTS = 5000;
// -------------------------------------------------------------------------

const isBlank = (v) => v === undefined || v === null || v === '';
const num = (v) => (v === null || v === undefined ? null : Number(v));

function parseCoord(lat, lng) {
  if (isBlank(lat) || isBlank(lng)) return null;
  const la = Number(lat);
  const lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  if (la === 0 && lo === 0) return null; // classic "no GPS fix" value
  return { lat: Number(la.toFixed(7)), lng: Number(lo.toFixed(7)) };
}

function optNum(v, { min, max } = {}) {
  if (isBlank(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || (min !== undefined && n < min) || (max !== undefined && n > max)) return null;
  return n;
}

// accepts epoch ms, epoch seconds, or an ISO string; missing => now
function parseTimeMs(v) {
  if (isBlank(v)) return Date.now();
  if (typeof v === 'number' || /^\d+$/.test(String(v))) {
    const n = Number(v);
    return Math.round(n < 1e11 ? n * 1000 : n);
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function haversineM(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

const isInvolved = (demo, user) =>
  Number(demo.created_by) === Number(user.id) || Number(demo.field_officer_id) === Number(user.id);

async function assertCanView(conn, user, demo) {
  if (isInvolved(demo, user)) return;
  if (await m.canApproveDemo(conn, user, demo)) return;
  throw new HttpError(403, 'Not allowed to view tracking for this demo');
}

async function loadOwnedTrack(conn, trackId, user) {
  const [[t]] = await conn.query(
    `SELECT t.*, UNIX_TIMESTAMP(t.started_at) * 1000 AS started_ms
       FROM demo_field_tracks t WHERE t.id = ? FOR UPDATE`,
    [trackId]
  );
  if (!t) throw new HttpError(404, 'Tracking session not found');
  if (Number(t.user_id) !== Number(user.id)) throw new HttpError(403, 'This tracking session belongs to another user');
  return t;
}

// ------------------------------------------------------------ point ingest
async function ingestPoints(conn, track, rawPoints) {
  if (!Array.isArray(rawPoints)) throw new HttpError(400, 'points must be an array');
  if (rawPoints.length > MAX_POINTS_PER_REQUEST) {
    throw new HttpError(400, `Send at most ${MAX_POINTS_PER_REQUEST} points per request`);
  }

  const startedMs = Number(track.started_ms);
  const now = Date.now();
  const rows = [];
  const seen = new Set();

  for (const p of rawPoints) {
    if (!p) continue;
    const c = parseCoord(p.latitude ?? p.lat, p.longitude ?? p.lng);
    const ms = parseTimeMs(p.recorded_at ?? p.timestamp);
    if (!c || ms === null) continue;
    if (ms < startedMs - PAST_TOLERANCE_MS || ms > now + FUTURE_TOLERANCE_MS) continue;
    const acc = optNum(p.accuracy, { min: 0, max: 99999 });
    if (acc !== null && acc > MAX_ACCURACY_M) continue;
    if (seen.has(ms)) continue;
    seen.add(ms);
    rows.push([track.id, c.lat, c.lng, acc, optNum(p.speed, { min: 0, max: 999 }), ms]);
  }

  if (!rows.length) return { inserted: 0, received: rawPoints.length };

  const [r] = await conn.query(
    `INSERT IGNORE INTO demo_field_track_points
       (track_id, latitude, longitude, accuracy_m, speed_mps, recorded_at_ms)
     VALUES ?`,
    [rows]
  );
  const inserted = r.affectedRows;

  if (inserted > 0) {
    const latest = rows.reduce((a, b) => (b[5] > a[5] ? b : a));
    const lastMs = isBlank(track.last_point_at_ms) ? 0 : Number(track.last_point_at_ms);
    if (latest[5] >= lastMs) {
      await conn.query(
        `UPDATE demo_field_tracks
            SET point_count = point_count + ?, last_lat = ?, last_lng = ?, last_point_at_ms = ?
          WHERE id = ?`,
        [inserted, latest[1], latest[2], latest[5], track.id]
      );
    } else {
      await conn.query('UPDATE demo_field_tracks SET point_count = point_count + ? WHERE id = ?', [inserted, track.id]);
    }
  }
  return { inserted, received: rawPoints.length };
}

async function computeDistance(conn, trackId) {
  const [pts] = await conn.query(
    `SELECT latitude, longitude, recorded_at_ms
       FROM demo_field_track_points WHERE track_id = ? ORDER BY recorded_at_ms ASC`,
    [trackId]
  );
  let total = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = haversineM(Number(a.latitude), Number(a.longitude), Number(b.latitude), Number(b.longitude));
    const dt = (Number(b.recorded_at_ms) - Number(a.recorded_at_ms)) / 1000;
    if (seg < MIN_SEGMENT_M || dt <= 0 || seg / dt > MAX_SPEED_MPS) continue;
    total += seg;
  }
  return {
    distance: Math.round(total * 100) / 100,
    count: pts.length,
    last: pts.length ? pts[pts.length - 1] : null,
  };
}

async function finalizeTrack(conn, track, endPt = null) {
  const { distance, count, last } = await computeDistance(conn, track.id);
  const endLat = endPt ? endPt.lat : last ? Number(last.latitude) : track.start_lat;
  const endLng = endPt ? endPt.lng : last ? Number(last.longitude) : track.start_lng;
  await conn.query(
    `UPDATE demo_field_tracks
        SET status = 'ENDED', ended_at = NOW(),
            end_lat = ?, end_lng = ?, total_distance_m = ?, point_count = ?,
            duration_sec = GREATEST(0, TIMESTAMPDIFF(SECOND, started_at, NOW()))
      WHERE id = ?`,
    [endLat, endLng, distance, count, track.id]
  );
}

// ------------------------------------------------------------ shaping
function shapeTrack(t) {
  return {
    id: t.id,
    demo_id: t.demo_id,
    demo_no: t.demo_no,
    demo_request_customer_id: t.demo_request_customer_id,
    customer_name: t.customer_name || null,
    result_no: t.result_no,
    user_id: t.user_id,
    employee_name: t.employee_name || null,
    status: t.status,
    demo_result_id: t.demo_result_id,
    linked: !!t.demo_result_id,
    started_at: t.started_at,
    ended_at: t.ended_at,
    start: { lat: num(t.start_lat), lng: num(t.start_lng) },
    end: t.end_lat === null || t.end_lat === undefined ? null : { lat: num(t.end_lat), lng: num(t.end_lng) },
    last: t.last_lat === null || t.last_lat === undefined ? null : { lat: num(t.last_lat), lng: num(t.last_lng) },
    point_count: Number(t.point_count) || 0,
    total_distance_m: num(t.total_distance_m),
    duration_sec: t.status === 'ENDED' ? num(t.duration_sec) : num(t.elapsed_sec),
  };
}

const TRACK_SELECT = `
  SELECT t.*, d.demo_no, u.name AS employee_name, c.name AS customer_name,
         TIMESTAMPDIFF(SECOND, t.started_at, COALESCE(t.ended_at, NOW())) AS elapsed_sec
    FROM demo_field_tracks t
    JOIN demo_requests d ON d.id = t.demo_id
    JOIN demo_request_customers dc ON dc.id = t.demo_request_customer_id
    JOIN customers c ON c.id = dc.party_id
    LEFT JOIN users u ON u.id = t.user_id`;

async function getTrackSummary(trackId) {
  const [[t]] = await db.query(`${TRACK_SELECT} WHERE t.id = ?`, [trackId]);
  return t ? shapeTrack(t) : null;
}

// ------------------------------------------------------------ START
async function startTracking({ demoId, customerId, resultNo, body, user }) {
  resultNo = Number(resultNo);
  if (![1, 2, 3].includes(resultNo)) throw new HttpError(400, 'result number must be 1, 2 or 3');

  const b = body || {};
  const start = parseCoord(b.latitude, b.longitude);
  if (!start) throw new HttpError(400, 'A valid current location (latitude, longitude) is required to start tracking');
  const accuracy = optNum(b.accuracy, { min: 0, max: 99999 });
  if (accuracy !== null && accuracy > MAX_ACCURACY_M) {
    throw new HttpError(400, `GPS accuracy is too low (${Math.round(accuracy)} m). Move to an open area and try again`);
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[demo]] = await conn.query('SELECT * FROM demo_requests WHERE id = ?', [demoId]);
    if (!demo) throw new HttpError(404, 'Demo request not found');
    if (!isInvolved(demo, user)) throw new HttpError(403, 'Only the employee assigned to this demo can start field tracking');
    if (!m.RESULT_ELIGIBLE_STATUSES.includes(demo.status)) {
      throw new HttpError(400, `Field tracking is available only after approval (current status: ${demo.status})`);
    }

    const [[cust]] = await conn.query(
      'SELECT * FROM demo_request_customers WHERE id = ? AND demo_id = ? FOR UPDATE',
      [customerId, demoId]
    );
    if (!cust) throw new HttpError(404, 'This customer is not part of this demo');
    if (cust.is_removed) throw new HttpError(400, 'This customer was removed from the demo');
    if (resultNo !== Number(cust.results_count) + 1) {
      throw new HttpError(400, `Tracking can only be started for the next result (result ${Number(cust.results_count) + 1})`);
    }

    // one running session per user
    const [mine] = await conn.query(
      `SELECT t.id, t.demo_request_customer_id, t.result_no, d.demo_no
         FROM demo_field_tracks t JOIN demo_requests d ON d.id = t.demo_id
        WHERE t.user_id = ? AND t.status = 'ACTIVE' FOR UPDATE`,
      [user.id]
    );
    if (mine.length) {
      const same = mine.find(
        (t) => Number(t.demo_request_customer_id) === Number(customerId) && Number(t.result_no) === resultNo
      );
      if (same) {
        await conn.commit();
        const data = await getTrackSummary(same.id);
        return { ...data, resumed: true };
      }
      throw new HttpError(
        400,
        `You already have field tracking running for ${mine[0].demo_no} (result ${mine[0].result_no}). End it before starting a new one`
      );
    }

    const [[other]] = await conn.query(
      `SELECT id FROM demo_field_tracks
        WHERE demo_request_customer_id = ? AND result_no = ? AND status = 'ACTIVE' LIMIT 1`,
      [customerId, resultNo]
    );
    if (other) throw new HttpError(400, 'Field tracking is already running for this customer and result by another user');

    const nowMs = Date.now();
    const [ins] = await conn.query(
      `INSERT INTO demo_field_tracks
        (demo_id, demo_request_customer_id, result_no, user_id, status,
         start_lat, start_lng, last_lat, last_lng, last_point_at_ms, point_count)
       VALUES (?,?,?,?,'ACTIVE',?,?,?,?,?,1)`,
      [demoId, customerId, resultNo, user.id, start.lat, start.lng, start.lat, start.lng, nowMs]
    );
    await conn.query(
      `INSERT INTO demo_field_track_points (track_id, latitude, longitude, accuracy_m, recorded_at_ms)
       VALUES (?,?,?,?,?)`,
      [ins.insertId, start.lat, start.lng, accuracy, nowMs]
    );
    await conn.commit();

    const data = await getTrackSummary(ins.insertId);
    return { ...data, resumed: false };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ------------------------------------------------------------ POINTS
async function addPoints({ trackId, points, user }) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const track = await loadOwnedTrack(conn, trackId, user);
    if (track.status !== 'ACTIVE') throw new HttpError(400, 'This tracking session has already ended');
    const { inserted, received } = await ingestPoints(conn, track, points);
    await conn.commit();
    const [[row]] = await db.query('SELECT point_count FROM demo_field_tracks WHERE id = ?', [trackId]);
    return { accepted: inserted, skipped: received - inserted, point_count: Number(row.point_count) };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ------------------------------------------------------------ END
async function endTracking({ trackId, body, user }) {
  const b = body || {};
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const track = await loadOwnedTrack(conn, trackId, user);

    if (track.status === 'ENDED') {            // idempotent
      await conn.commit();
      return getTrackSummary(trackId);
    }

    if (Array.isArray(b.points) && b.points.length) await ingestPoints(conn, track, b.points);

    const endPt = parseCoord(b.latitude, b.longitude);
    if (endPt) {
      await ingestPoints(conn, track, [
        { latitude: endPt.lat, longitude: endPt.lng, accuracy: b.accuracy, recorded_at: Date.now() },
      ]);
    }

    await finalizeTrack(conn, track, endPt);
    await conn.commit();
    return getTrackSummary(trackId);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ------------------------------------------------------------ MY ACTIVE
async function getMyActiveTrack(user) {
  const [[t]] = await db.query(
    `${TRACK_SELECT} WHERE t.user_id = ? AND t.status = 'ACTIVE' ORDER BY t.id DESC LIMIT 1`,
    [user.id]
  );
  return t ? shapeTrack(t) : null;
}

// ------------------------------------------------------------ RESULT LINKING
// Called inside addResultForCustomer's transaction.
// 1) resolveTrackForResult: before photos are uploaded (so a rejection leaves no orphan files)
// 2) attachTrackToResult: after the result row exists
async function resolveTrackForResult(conn, { demoId, customerId, resultNo, user, trackId }) {
  let track = null;

  if (!isBlank(trackId)) {
    const id = Number(trackId);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid track_id');
    const [[t]] = await conn.query(
      `SELECT * FROM demo_field_tracks
        WHERE id = ? AND demo_id = ? AND demo_request_customer_id = ? AND result_no = ? FOR UPDATE`,
      [id, demoId, customerId, resultNo]
    );
    if (!t) throw new HttpError(400, 'This tracking session does not belong to this customer and result');
    if (Number(t.user_id) !== Number(user.id)) throw new HttpError(403, 'This tracking session belongs to another user');
    if (t.demo_result_id) throw new HttpError(400, 'This tracking session is already attached to a result');
    track = t;
  } else {
    const [[t]] = await conn.query(
      `SELECT * FROM demo_field_tracks
        WHERE demo_request_customer_id = ? AND result_no = ? AND user_id = ? AND demo_result_id IS NULL
        ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [customerId, resultNo, user.id]
    );
    track = t || null;
  }

  if (TRACKING_REQUIRED) {
    if (!track) throw new HttpError(400, 'Field tracking is required: start and end tracking before submitting this result');
    if (Number(track.point_count) < MIN_POINTS_WHEN_REQUIRED) {
      throw new HttpError(400, 'Field tracking has too few GPS points. Please track the field again');
    }
  }
  return track;
}

async function attachTrackToResult(conn, track, resultId) {
  if (track.status === 'ACTIVE') await finalizeTrack(conn, track); // employee forgot to press End
  await conn.query('UPDATE demo_field_tracks SET demo_result_id = ? WHERE id = ?', [resultId, track.id]);
}

// ------------------------------------------------------------ ADMIN / VIEW
async function listDemoTracks(demoId, user, { linkedOnly = false } = {}) {
  const [[demo]] = await db.query('SELECT * FROM demo_requests WHERE id = ?', [demoId]);
  if (!demo) throw new HttpError(404, 'Demo request not found');
  await assertCanView(db, user, demo);

  const [rows] = await db.query(
    `${TRACK_SELECT}
      WHERE t.demo_id = ? ${linkedOnly ? 'AND t.demo_result_id IS NOT NULL' : ''}
      ORDER BY dc.id ASC, t.result_no ASC, t.id ASC`,
    [demoId]
  );
  return rows.map(shapeTrack);
}

function samplePoints(points, max) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i += 1) out.push(points[Math.round(i * step)]);
  return out;
}

async function getTrackDetail(trackId, user, { maxPoints } = {}) {
  const [[t]] = await db.query(`${TRACK_SELECT} WHERE t.id = ?`, [trackId]);
  if (!t) throw new HttpError(404, 'Tracking session not found');

  const [[demo]] = await db.query('SELECT * FROM demo_requests WHERE id = ?', [t.demo_id]);
  await assertCanView(db, user, demo);

  const [pts] = await db.query(
    `SELECT latitude, longitude, accuracy_m, speed_mps, recorded_at_ms
       FROM demo_field_track_points WHERE track_id = ? ORDER BY recorded_at_ms ASC`,
    [trackId]
  );
  const all = pts.map((p) => ({
    lat: Number(p.latitude),
    lng: Number(p.longitude),
    accuracy: num(p.accuracy_m),
    speed: num(p.speed_mps),
    t: Number(p.recorded_at_ms),
  }));

  const track = shapeTrack(t);
  if (t.status === 'ACTIVE') {                   // live view: distance so far
    const { distance } = await computeDistance(db, trackId);
    track.total_distance_m = distance;
  }

  let bounds = null;
  if (all.length) {
    bounds = {
      min_lat: Math.min(...all.map((p) => p.lat)),
      max_lat: Math.max(...all.map((p) => p.lat)),
      min_lng: Math.min(...all.map((p) => p.lng)),
      max_lng: Math.max(...all.map((p) => p.lng)),
    };
  }

  const limit = Math.min(Math.max(Number(maxPoints) || DEFAULT_RETURN_POINTS, 2), MAX_RETURN_POINTS);
  const points = samplePoints(all, limit);
  return { track, points, total_points: all.length, returned_points: points.length, bounds };
}

module.exports = {
  HttpError, TRACKING_REQUIRED,
  startTracking, addPoints, endTracking, getMyActiveTrack,
  resolveTrackForResult, attachTrackToResult,
  listDemoTracks, getTrackDetail,
};