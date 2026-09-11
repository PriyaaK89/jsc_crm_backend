const festivalCache = new Map(); // key: "2026-10" → { data, fetchedAt }
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — festival dates don't change intraday

exports.getFestivalSuggestions = async (req, res) => {
  try {
    const { month, year } = req.query;
    if (!month || !year) {
      return res.status(400).json({ message: "month and year are required" });
    }

    const cacheKey = `${year}-${month}`;
    const cached = festivalCache.get(cacheKey);

    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return res.json({ month: Number(month), year: Number(year), festivals: cached.data });
    }

    const url = `https://calendarific.com/api/v2/holidays?api_key=${process.env.CALENDARIFIC_API_KEY}&country=IN&year=${year}&month=${month}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Calendarific responded ${response.status}`);
    }
    const json = await response.json();

    const festivals = (json.response?.holidays || []).map((h) => ({
      date: h.date.iso.slice(0, 10), // "2026-10-20"
      name: h.name,
      type: h.type?.[0] || "Festival", // e.g. "National holiday", "Religious"
    }));

    festivalCache.set(cacheKey, { data: festivals, fetchedAt: Date.now() });

    return res.json({ month: Number(month), year: Number(year), festivals });
  } catch (error) {
    console.error("Festival Suggestion Error:", error.message);
    // Fail-open: HR just sees no hints that month, calendar still fully usable
    return res.json({ month: Number(req.query.month), year: Number(req.query.year), festivals: [] });
  }
};