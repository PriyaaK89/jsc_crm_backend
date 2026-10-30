// Small helpers shared by the Beat Plan controllers

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// wraps an async controller: HttpError -> proper JSON, anything else -> 500
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    console.error("BEAT ERROR:", err);
    return res
      .status(500)
      .json({ success: false, message: "Something went wrong" });
  }
};

const ok = (res, data, message = "OK", status = 200) =>
  res.status(status).json({ success: true, message, data });

const toId = (value, label = "id") => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${label}`);
  return n;
};

const clean = (value, max) => {
  const s = String(value ?? "").trim();
  return s.length > max ? s.slice(0, max) : s;
};

module.exports = { HttpError, wrap, ok, toId, clean };