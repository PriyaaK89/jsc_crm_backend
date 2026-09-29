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

// ============================================================ crops
async function createCrop({ crop_name, description }, userId) {
  const name = (crop_name || '').trim();
  if (!name) throw new HttpError(400, 'crop_name is required');
  try {
    const [r] = await db.query(
      'INSERT INTO crops (crop_name, description, created_by) VALUES (?,?,?)',
      [name, description || null, userId]
    );
    return r.insertId;
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new HttpError(400, 'A crop with this name already exists');
    throw e;
  }
}

async function updateCrop(id, { crop_name, description }) {
  const sets = [];
  const vals = [];
  if (crop_name !== undefined) {
    const name = (crop_name || '').trim();
    if (!name) throw new HttpError(400, 'crop_name cannot be empty');
    sets.push('crop_name = ?');
    vals.push(name);
  }
  if (description !== undefined) { sets.push('description = ?'); vals.push(description || null); }
  if (!sets.length) return;
  try {
    await db.query(`UPDATE crops SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new HttpError(400, 'A crop with this name already exists');
    throw e;
  }
}

async function setCropActive(id, isActive) {
  const [r] = await db.query('UPDATE crops SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, id]);
  if (!r.affectedRows) throw new HttpError(404, 'Crop not found');
}

async function listCrops({ includeInactive = false } = {}) {
  const [rows] = await db.query(
    `SELECT id, crop_name, description, is_active, created_at
       FROM crops
      ${includeInactive ? '' : 'WHERE is_active = 1'}
      ORDER BY crop_name ASC`
  );
  return rows;
}

async function getCrop(id) {
  const [[row]] = await db.query('SELECT * FROM crops WHERE id = ?', [id]);
  return row || null;
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
      WHERE m.crop_id = ? ${activeOnly ? 'AND m.is_active = 1 AND f.is_active = 1' : ''}
       WHERE m.crop_id = ? AND m.result_stage = ? ${activeOnly ? 'AND m.is_active = 1 AND f.is_active = 1' : ''}
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
async function listUnmappedFieldsForCrop(cropId,  { resultStage = 2 } = {}) {
      const stage = Number(resultStage) === 3 ? 3 : 2;
  const [rows] = await db.query(
    `SELECT f.* FROM crop_growth_fields f
      WHERE f.is_active = 1
        AND f.id NOT IN (
          SELECT field_id FROM crop_growth_field_mapping WHERE crop_id = ? AND result_stage = ? AND is_active = 1
        )
      ORDER BY f.field_name ASC`,
    [cropId, stage]
  );
  return rows;
}

module.exports = {
  HttpError, INPUT_TYPES, canManageCrops, requireCropAccess,
  createCrop, updateCrop, setCropActive, listCrops, getCrop,
  createGrowthField, updateGrowthField, setGrowthFieldActive, listGrowthFields,
  addFieldOption, setFieldOptionActive, listFieldOptions,
  mapFieldToCrop, unmapFieldFromCrop, getCropGrowthForm, listUnmappedFieldsForCrop,
};