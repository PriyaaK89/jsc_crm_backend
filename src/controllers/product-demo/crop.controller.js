// controllers/product-demo/crop.controller.js
const crop = require('../../models/product-demo/crop.model');
const { HttpError } = crop;

async function run(res, fn) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ success: false, message: err.message });
    console.error('[crop]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong' });
  }
}

// ---- crops ----
exports.createCrop = (req, res) => run(res, async () => {
  await crop.requireCropAccess(req.user);
  const id = await crop.createCrop(req.body, req.user.id);
  res.status(201).json({ success: true, message: 'Crop created', data: { id } });
});

exports.updateCrop = (req, res) => run(res, async () => {
  await crop.requireCropAccess(req.user);
  await crop.updateCrop(req.params.id, req.body);
  res.json({ success: true, message: 'Crop updated' });
});

exports.setCropActive = (req, res) => run(res, async () => {
  await crop.requireCropAccess(req.user);
  await crop.setCropActive(req.params.id, req.body.is_active);
  res.json({ success: true, message: req.body.is_active ? 'Crop activated' : 'Crop deactivated' });
});

exports.listCrops = (req, res) => run(res, async () => {
  const includeInactive = req.query.include_inactive === '1' && (await crop.canManageCrops(req.user));
  res.json({ success: true, data: await crop.listCrops({ includeInactive }) });
});


exports.getCropGrowthForm = (req, res) => run(res, async () => {
  const c = await crop.getCrop(req.params.id);
    const activeOnly = !(req.query.include_inactive === '1' && (await crop.canManageCrops(req.user)));

  if (!c) throw new HttpError(404, 'Crop not found');
  const stage = Number(req.query.stage) === 3 ? 3 : 2;
  res.json({ success: true, data: { crop: c, fields: await crop.getCropGrowthForm(req.params.id, {activeOnly, resultStage: stage }) } });
});

// ---- growth field catalog ----
exports.createGrowthField = (req, res) => run(res, async () => {
  await crop.requireCropAccess(req.user);
  const id = await crop.createGrowthField(req.body, req.user.id);
  res.status(201).json({ success: true, message: 'Field created', data: { id } });
});

exports.updateGrowthField = (req, res) => run(res, async () => {
  await crop.requireCropAccess(req.user);
  await crop.updateGrowthField(req.params.id, req.body);
  res.json({ success: true, message: 'Field updated' });
});

exports.setGrowthFieldActive = (req, res) => run(res, async () => {
  await crop.requireCropAccess(req.user);
  await crop.setGrowthFieldActive(req.params.id, req.body.is_active);
  res.json({ success: true, message: req.body.is_active ? 'Field activated' : 'Field deactivated' });
});

exports.listGrowthFields = (req, res) => run(res, async () => {
  await crop.requireCropAccess(req.user);
  const includeInactive = req.query.include_inactive === '1';
  res.json({ success: true, data: await crop.listGrowthFields({ includeInactive }) });
});

// ---- dropdown options ----
exports.addFieldOption = (req, res) => run(res, async () => {
  await crop.requireCropAccess(req.user);
  const id = await crop.addFieldOption(req.params.fieldId, req.body);
  res.status(201).json({ success: true, message: 'Option added', data: { id } });
});

exports.setFieldOptionActive = (req, res) => run(res, async () => {
  await crop.requireCropAccess(req.user);
  await crop.setFieldOptionActive(req.params.optionId, req.body.is_active);
  res.json({ success: true, message: 'Option updated' });
});

exports.listFieldOptions = (req, res) => run(res, async () => {
  await crop.requireCropAccess(req.user);
  res.json({ success: true, data: await crop.listFieldOptions(req.params.fieldId, { includeInactive: true }) });
});

// ---- crop <-> field mapping ----
exports.mapFieldToCrop = (req, res) => run(res, async () => {
  await crop.requireCropAccess(req.user);
  const id = await crop.mapFieldToCrop(req.params.id, req.body.field_id, req.body, req.user.id);
  res.status(201).json({ success: true, message: 'Field mapped to crop', data: { id } });
});

exports.unmapFieldFromCrop = (req, res) => run(res, async () => {
  await crop.requireCropAccess(req.user);
  await crop.unmapFieldFromCrop(req.params.mappingId);
  res.json({ success: true, message: 'Field unmapped from crop' });
});

exports.listUnmappedFieldsForCrop = (req, res) => run(res, async () => {
  await crop.requireCropAccess(req.user);
  const stage = Number(req.query.stage) === 3 ? 3 : 2;
  res.json({ success: true, data: await crop.listUnmappedFieldsForCrop(req.params.id, { resultStage: stage }) });
});

exports.getGrowthFormByStockItem = (req, res) => run(res, async () => {
  const item = await crop.getCropIdByStockItem(req.params.stockItemId);
  if (!item) throw new HttpError(404, 'Stock item not found');

  if (!item.crop_id) {
    return res.json({
      success: true,
      message: 'No crop is linked to this stock item',
      data: { crop: null, fields: [] },
    });
  }

  const c = await crop.getCrop(item.crop_id);
  if (!c || !c.is_active) {
    return res.json({ success: true, message: 'Linked crop is inactive', data: { crop: null, fields: [] } });
  }

  const stage = Number(req.query.stage) === 3 ? 3 : 2;
  const fields = await crop.getCropGrowthForm(item.crop_id, { resultStage: stage, activeOnly: true });
  res.json({ success: true, data: { crop: c, fields } });
});