const getTeamById = async (id) => {
  const [rows] = await db.query(
    'SELECT * FROM teams WHERE id = ?',
    [id]
  );
  return rows[0];
};