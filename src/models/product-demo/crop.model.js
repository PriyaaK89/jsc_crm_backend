// models/product-demo/crop.model.js
// Crop master + admin-configurable growth-field catalog (Part 19-21).
const db = require('../../config/db');
const { HttpError } = require('./httpError');

const INPUT_TYPES = ['NUMBER', 'TEXT', 'DROPDOWN', 'DATE', 'BOOLEAN'];
const CROP_APPROVER_ROLES = ['ADMIN', 'SUPER_ADMIN'];
const CROP_PERMISSION = 'crop_manage';

async function canManageCrops(user) {
  const [rows] = await db.query(
    `SELECT 1
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE u.id = ?
        AND (r.name IN (?) OR EXISTS (
              SELECT 1 FROM user_permissions up
                JOIN permissions p ON p.id = up.permission_id
               WHERE up.user_id = u.id AND up.is_allowed = 1 AND p.code = ?
            ))
      LIMIT 1`,
    [user.id, CROP_APPROVER_ROLES, CROP_PERMISSION]
  );
  return rows.length > 0;
}

async function requireCropAccess(user) {
  if (!(await canManageCrops(user))) throw new HttpError(403, 'You do not have access to manage crops');
}

// ============================================================ crop seasons
// The season of a crop (Kharif / Rabi / Zaid …) comes from the one season list
// (bp_setting_options, list_key SEASON — the list Business Plans use). A crop may grow in more
// than one season (e.g. Maize: Kharif and Rabi); the link is crop_season_map (crop_id, season).
// Stock items belong to a crop (stock_items.crop_id), so "products of a crop in a season" =
// stock items whose crop is linked to that season. Advance Booking uses exactly that.

// -> list of season names as stored in the season list, or undefined when not sent
async function readSeasons(list, { required }) {
  if (list === undefined || list === null) {
    if (required) throw new HttpError(400, 'Select the season(s) of the crop');
    return undefined;
  }
  if (!Array.isArray(list)) throw new HttpError(400, 'seasons must be a list of season names');
  const wanted = [...new Set(list.map((s) => String(s || '').trim()).filter(Boolean))];
  if (required && !wanted.length) throw new HttpError(400, 'Select the season(s) of the crop');
  if (!wanted.length) return [];
  const [rows] = await db.query(
    `SELECT value FROM bp_setting_options WHERE list_key = 'SEASON' AND is_active = 1`
  );
  const byLower = new Map(rows.map((r) => [String(r.value).toLowerCase(), r.value]));
  const bad = wanted.filter((s) => !byLower.has(s.toLowerCase()));
  if (bad.length) throw new HttpError(400, `Not in the season list: ${bad.join(', ')}`);
  return [...new Set(wanted.map((s) => byLower.get(s.toLowerCase())))];
}

// seasons in which the crop's products are in a Draft / Open advance booking season — these
// cannot be taken off the crop while that booking season runs
async function seasonsInUseByBooking(cropId) {
  const [rows] = await db.query(
    `SELECT DISTINCT s.season, s.name
       FROM abs_season_products sp
       JOIN abs_seasons s ON s.id = sp.season_id
       JOIN stock_items si ON si.id = sp.stock_item_id
      WHERE si.crop_id = ? AND s.status IN ('DRAFT', 'OPEN')`,
    [cropId]
  );
  return rows;
}

async function writeSeasons(conn, cropId, seasons, userId) {
  await conn.query('DELETE FROM crop_season_map WHERE crop_id = ?', [cropId]);
  if (seasons.length) {
    await conn.query(
      'INSERT INTO crop_season_map (crop_id, season, created_by) VALUES ?',
      [seasons.map((s) => [cropId, s, userId || null])]
    );
  }
}

async function getCropSeasons(cropIds) {
  const out = new Map();
  if (!cropIds.length) return out;
  const [rows] = await db.query(
    'SELECT crop_id, season FROM crop_season_map WHERE crop_id IN (?) ORDER BY season ASC',
    [cropIds]
  );
  for (const r of rows) {
    const id = Number(r.crop_id);
    if (!out.has(id)) out.set(id, []);
    out.get(id).push(r.season);
  }
  return out;
}

// ============================================================ crops
// body: { crop_name, description, seasons: ['Kharif', 'Rabi'] }  (seasons required)
async function createCrop({ crop_name, description, seasons }, userId) {
  const name = (crop_name || '').trim();
  if (!name) throw new HttpError(400, 'crop_name is required');
  const list = await readSeasons(seasons, { required: true });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      'INSERT INTO crops (crop_name, description, created_by) VALUES (?,?,?)',
      [name, description || null, userId]
    );
    await writeSeasons(conn, r.insertId, list, userId);
    await conn.commit();
    return r.insertId;
  } catch (e) {
    await conn.rollback();
    if (e.code === 'ER_DUP_ENTRY') throw new HttpError(400, 'A crop with this name already exists');
    throw e;
  } finally {
    conn.release();
  }
}

// body: { crop_name, description, seasons }  — seasons left out = unchanged
async function updateCrop(id, { crop_name, description, seasons }, userId) {
  const sets = [];
  const vals = [];
  if (crop_name !== undefined) {
    const name = (crop_name || '').trim();
    if (!name) throw new HttpError(400, 'crop_name cannot be empty');
    sets.push('crop_name = ?');
    vals.push(name);
  }
  if (description !== undefined) { sets.push('description = ?'); vals.push(description || null); }
  const list = await readSeasons(seasons, { required: seasons !== undefined });
  if (list !== undefined) {
    const [[exists]] = await db.query('SELECT id FROM crops WHERE id = ?', [id]);
    if (!exists) throw new HttpError(404, 'Crop not found');
    const removed = (await seasonsInUseByBooking(id)).filter((u) => !list.includes(u.season));
    if (removed.length) {
      throw new HttpError(
        409,
        `Products of this crop are in the advance booking season ${removed.map((u) => `${u.name} (${u.season})`).join(', ')}; ` +
        `${[...new Set(removed.map((u) => u.season))].join(', ')} cannot be removed from the crop until that booking season is closed`
      );
    }
  }
  if (!sets.length && list === undefined) return;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    if (sets.length) await conn.query(`UPDATE crops SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
    if (list !== undefined) await writeSeasons(conn, Number(id), list, userId);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    if (e.code === 'ER_DUP_ENTRY') throw new HttpError(400, 'A crop with this name already exists');
    throw e;
  } finally {
    conn.release();
  }
}

async function setCropActive(id, isActive) {
  const [r] = await db.query('UPDATE crops SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, id]);
  if (!r.affectedRows) throw new HttpError(404, 'Crop not found');
}

// each crop also carries seasons: ['Kharif', …] and product_count (its stock items)
async function listCrops({ includeInactive = false } = {}) {
  const [rows] = await db.query(
    `SELECT c.id, c.crop_name, c.description, c.is_active, c.created_at,
            (SELECT COUNT(*) FROM stock_items si WHERE si.crop_id = c.id) AS product_count
       FROM crops c
      ${includeInactive ? '' : 'WHERE c.is_active = 1'}
      ORDER BY c.crop_name ASC`
  );
  const seasons = await getCropSeasons(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, product_count: Number(r.product_count) || 0, seasons: seasons.get(Number(r.id)) || [] }));
}

async function getCrop(id) {
  const [[row]] = await db.query('SELECT * FROM crops WHERE id = ?', [id]);
  if (!row) return null;
  const seasons = await getCropSeasons([Number(row.id)]);
  return { ...row, seasons: seasons.get(Number(row.id)) || [] };
}

// ============================================================ growth field catalog
function validateFieldPayload(b, { partial = false } = {}) {
  if (!partial) {
    if (!(b.field_code || '').trim()) throw new HttpError(400, 'field_code is required');
    if (!(b.field_name || '').trim()) throw new HttpError(400, 'field_name is required');
  }
  if (b.input_type !== undefined && !INPUT_TYPES.includes(b.input_type)) {
    throw new HttpError(400, `input_type must be one of ${INPUT_TYPES.join(', ')}`);
  }
  if (b.min_value !== undefined && b.min_value !== null && b.max_value !== undefined && b.max_value !== null) {
    if (Number(b.min_value) > Number(b.max_value)) throw new HttpError(400, 'min_value cannot exceed max_value');
  }
}

async function createGrowthField(b, userId) {
  validateFieldPayload(b);
  try {
    const [r] = await db.query(
      `INSERT INTO crop_growth_fields
        (field_code, field_name, description, input_type, default_unit,
         min_value, max_value, decimal_places, help_text, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        b.field_code.trim(), b.field_name.trim(), b.description || null,
        b.input_type || 'NUMBER', b.default_unit || null,
        b.min_value ?? null, b.max_value ?? null, b.decimal_places ?? null,
        b.help_text || null, userId,
      ]
    );
    return r.insertId;
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new HttpError(400, 'A field with this field_code already exists');
    throw e;
  }
}

async function updateGrowthField(id, b) {
  validateFieldPayload(b, { partial: true });
  const cols = ['field_code', 'field_name', 'description', 'input_type', 'default_unit',
    'min_value', 'max_value', 'decimal_places', 'help_text'];
  const sets = [];
  const vals = [];
  for (const c of cols) {
    if (b[c] !== undefined) { sets.push(`${c} = ?`); vals.push(b[c] === '' ? null : b[c]); }
  }
  if (!sets.length) return;
  try {
    await db.query(`UPDATE crop_growth_fields SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new HttpError(400, 'A field with this field_code already exists');
    throw e;
  }
}

async function setGrowthFieldActive(id, isActive) {
  const [r] = await db.query('UPDATE crop_growth_fields SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, id]);
  if (!r.affectedRows) throw new HttpError(404, 'Field not found');
}

async function listGrowthFields({ includeInactive = false } = {}) {
  const [rows] = await db.query(
    `SELECT * FROM crop_growth_fields
      ${includeInactive ? '' : 'WHERE is_active = 1'}
      ORDER BY field_name ASC`
  );
  return rows;
}

// ---- options for DROPDOWN fields ----
async function addFieldOption(fieldId, { option_label, option_value, display_order }) {
  const label = (option_label || '').trim();
  const value = (option_value || '').trim();
  if (!label || !value) throw new HttpError(400, 'option_label and option_value are required');
  const [[field]] = await db.query('SELECT id, input_type FROM crop_growth_fields WHERE id = ?', [fieldId]);
  if (!field) throw new HttpError(404, 'Field not found');
  if (field.input_type !== 'DROPDOWN') throw new HttpError(400, 'Options can only be added to DROPDOWN fields');
  const [r] = await db.query(
    'INSERT INTO crop_growth_field_options (field_id, option_label, option_value, display_order) VALUES (?,?,?,?)',
    [fieldId, label, value, display_order || 0]
  );
  return r.insertId;
}

async function setFieldOptionActive(optionId, isActive) {
  const [r] = await db.query('UPDATE crop_growth_field_options SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, optionId]);
  if (!r.affectedRows) throw new HttpError(404, 'Option not found');
}

async function listFieldOptions(fieldId, { includeInactive = false } = {}) {
  const [rows] = await db.query(
    `SELECT * FROM crop_growth_field_options
      WHERE field_id = ? ${includeInactive ? '' : 'AND is_active = 1'}
      ORDER BY display_order ASC, id ASC`,
    [fieldId]
  );
  return rows;
}

// ============================================================ crop <-> field mapping
// async function mapFieldToCrop(cropId, fieldId, { display_order, is_required, unit_override, help_text, is_active, result_stage }, userId) {
//   const active = is_active === undefined ? 1 : (is_active ? 1 : 0);
//     const stage = Number(result_stage) === 3 ? 3 : 2;

//   const [[crop]] = await db.query('SELECT id FROM crops WHERE id = ? AND is_active = 1', [cropId]);
//   if (!crop) throw new HttpError(400, 'Invalid or inactive crop');
//   const [[field]] = await db.query('SELECT id, is_active FROM crop_growth_fields WHERE id = ?', [fieldId]);
//   if (!field) throw new HttpError(400, 'Invalid field');
//   if (active && !field.is_active) throw new HttpError(400, 'This field is inactive in the master library');

//   const [[existing]] = await db.query(
//     'SELECT id FROM crop_growth_field_mapping WHERE crop_id = ? AND field_id = ?',
//     [cropId, fieldId]
//   );
//   if (existing) {
//     await db.query(
//       `UPDATE crop_growth_field_mapping
//           SET display_order = ?, is_required = ?, unit_override = ?, help_text = ?, is_active = ?
//         WHERE id = ?`,
//       [display_order || 0, is_required ? 1 : 0, unit_override || null, help_text || null, active, existing.id]
//     );
//     return existing.id;
//   }
//   const [r] = await db.query(
//     `INSERT INTO crop_growth_field_mapping
//       (crop_id, field_id, display_order, is_required, unit_override, help_text, is_active, created_by)
//      VALUES (?,?,?,?,?,?,?,?)`,
//     [cropId, fieldId, display_order || 0, is_required ? 1 : 0, unit_override || null, help_text || null, active, userId]
//   );
//   return r.insertId;
// }


async function mapFieldToCrop(
  cropId,
  fieldId,
  {
    display_order,
    is_required,
    unit_override,
    help_text,
    result_stage,
    is_active
  },
  userId
) {
  // Stage 2 or 3 only
  const stage = Number(result_stage) === 3 ? 3 : 2;

  // Active status
  const active = is_active === undefined ? 1 : (is_active ? 1 : 0);

  // Validate crop
  const [[crop]] = await db.query(
    'SELECT id FROM crops WHERE id = ? AND is_active = 1',
    [cropId]
  );

  if (!crop) {
    throw new HttpError(400, 'Invalid or inactive crop');
  }

  // Validate field master
  const [[field]] = await db.query(
    'SELECT id, is_active FROM crop_growth_fields WHERE id = ?',
    [fieldId]
  );

  if (!field) {
    throw new HttpError(400, 'Invalid field');
  }

  // Cannot activate an inactive master field
  if (active && !field.is_active) {
    throw new HttpError(
      400,
      'This field is inactive in the master library'
    );
  }

  // Check mapping for the same crop + field + stage
  const [[existing]] = await db.query(
    `SELECT id
       FROM crop_growth_field_mapping
      WHERE crop_id = ?
        AND field_id = ?
        AND result_stage = ?`,
    [cropId, fieldId, stage]
  );

  // Update existing mapping
  if (existing) {
    await db.query(
      `UPDATE crop_growth_field_mapping
          SET display_order = ?,
              is_required = ?,
              unit_override = ?,
              help_text = ?,
              is_active = ?
        WHERE id = ?`,
      [
        display_order || 0,
        is_required ? 1 : 0,
        unit_override || null,
        help_text || null,
        active,
        existing.id
      ]
    );

    return existing.id;
  }

  // Create new mapping
  const [r] = await db.query(
    `INSERT INTO crop_growth_field_mapping
      (
        crop_id,
        field_id,
        result_stage,
        display_order,
        is_required,
        unit_override,
        help_text,
        is_active,
        created_by
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cropId,
      fieldId,
      stage,
      display_order || 0,
      is_required ? 1 : 0,
      unit_override || null,
      help_text || null,
      active,
      userId
    ]
  );

  return r.insertId;
}

async function unmapFieldFromCrop(mappingId) {
  const [r] = await db.query('UPDATE crop_growth_field_mapping SET is_active = 0 WHERE id = ?', [mappingId]);
  if (!r.affectedRows) throw new HttpError(404, 'Mapping not found');
}

// The full Result-2 form for a crop: ordered fields + options for DROPDOWN ones.
async function getCropGrowthForm(cropId, { resultStage = 2,activeOnly = true } = {}) {
      const stage = Number(resultStage) === 3 ? 3 : 2;
  const [rows] = await db.query(
  `SELECT m.id AS mapping_id, m.display_order, m.is_required, m.is_active AS mapping_is_active,
          m.unit_override, m.help_text AS mapping_help_text,
          f.id AS field_id, f.field_code, f.field_name, f.description, f.input_type,
          f.default_unit, f.min_value, f.max_value, f.decimal_places, f.help_text AS field_help_text
     FROM crop_growth_field_mapping m
     JOIN crop_growth_fields f ON f.id = m.field_id
    WHERE m.crop_id = ? AND m.result_stage = ?
      ${activeOnly ? 'AND m.is_active = 1 AND f.is_active = 1' : ''}
    ORDER BY m.display_order ASC, m.id ASC`,
  [cropId, stage]
);

  const dropdownFieldIds = rows.filter((r) => r.input_type === 'DROPDOWN').map((r) => r.field_id);
  let optionsByField = {};
  if (dropdownFieldIds.length) {
    const [opts] = await db.query(
      `SELECT * FROM crop_growth_field_options
        WHERE field_id IN (${dropdownFieldIds.map(() => '?').join(',')}) AND is_active = 1
        ORDER BY display_order ASC, id ASC`,
      dropdownFieldIds
    );
    optionsByField = opts.reduce((acc, o) => {
      (acc[o.field_id] = acc[o.field_id] || []).push(o);
      return acc;
    }, {});
  }

    return rows.map((r) => ({
    mapping_id: r.mapping_id,
    field_id: r.field_id,
    field_code: r.field_code,
    field_name: r.field_name,
    description: r.description,
    input_type: r.input_type,
    unit: r.unit_override || r.default_unit,
    default_unit: r.default_unit,
    unit_override: r.unit_override,
    min_value: r.min_value,
    max_value: r.max_value,
    decimal_places: r.decimal_places,
    is_required: !!r.is_required,
    is_active: !!r.mapping_is_active,
    help_text: r.mapping_help_text || r.field_help_text,
    mapping_help_text: r.mapping_help_text,
    display_order: r.display_order,
    options: r.input_type === 'DROPDOWN' ? (optionsByField[r.field_id] || []) : undefined,
  }));
}

// Fields not yet mapped to a crop, for the admin "pick from catalog" UI.
// async function listUnmappedFieldsForCrop(cropId,  { resultStage = 2 } = {}) {
//       const stage = Number(resultStage) === 3 ? 3 : 2;
//   const [rows] = await db.query(
//     `SELECT f.* FROM crop_growth_fields f
//       WHERE f.is_active = 1
//         AND f.id NOT IN (
//           SELECT field_id FROM crop_growth_field_mapping WHERE crop_id = ? AND result_stage = ? AND is_active = 1
//         )
//       ORDER BY f.field_name ASC`,
//     [cropId, stage]
//   );
//   return rows;
// }

async function listUnmappedFieldsForCrop(cropId, { resultStage = 2 } = {}) {
  const stage = Number(resultStage) === 3 ? 3 : 2;
  const [rows] = await db.query(
    `SELECT f.* FROM crop_growth_fields f
      WHERE f.is_active = 1
        AND f.id NOT IN (
          SELECT field_id FROM crop_growth_field_mapping
           WHERE crop_id = ? AND result_stage = ?
        )
      ORDER BY f.field_name ASC`,
    [cropId, stage]
  );
  return rows;
}

async function getCropIdByStockItem(stockItemId) {
  const [[row]] = await db.query(
    'SELECT id, crop_id FROM stock_items WHERE id = ?',
    [stockItemId]
  );
  return row || null; // null => stock item not found
}

module.exports = {
  HttpError, INPUT_TYPES, canManageCrops, requireCropAccess,
  createCrop, updateCrop, setCropActive, listCrops, getCrop,
  readSeasons, getCropSeasons, seasonsInUseByBooking,
  createGrowthField, updateGrowthField, setGrowthFieldActive, listGrowthFields,
  addFieldOption, setFieldOptionActive, listFieldOptions,
  mapFieldToCrop, unmapFieldFromCrop, getCropGrowthForm, listUnmappedFieldsForCrop,getCropIdByStockItem
};