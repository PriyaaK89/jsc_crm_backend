// routes/product-demo/cropRoutes.js
const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth.middleware');
const c = require('../../controllers/product-demo/crop.controller');

// crops
router.get('/get-crops-list', auth, c.listCrops);
router.post('/create-crops', auth, c.createCrop);
router.put('/update-crops/:id', auth, c.updateCrop);
router.patch('/set-crops-active/:id', auth, c.setCropActive);
router.get('/get-crop-growth-form/:id', auth, c.getCropGrowthForm);
router.get('/get-list-unmapped-fields-for-crops/:id/', auth, c.listUnmappedFieldsForCrop);

// growth field catalog
router.get('/crop-growth-fields-list', auth, c.listGrowthFields);
router.post('/create-crop-growth-fields', auth, c.createGrowthField);
router.put('/update-crop-growth-fields/:id', auth, c.updateGrowthField);
router.patch('/set-crop-growth-fields-active/:id/active', auth, c.setGrowthFieldActive);



// dropdown options
router.get('/crop-growth-fields/:fieldId/options', auth, c.listFieldOptions);
router.post('/crop-growth-fields/:fieldId/options', auth, c.addFieldOption);
router.patch('/crop-growth-field-options/:optionId/active', auth, c.setFieldOptionActive);

// crop <-> field mapping
router.post('/crops/:id/fields', auth, c.mapFieldToCrop);          // body: { field_id, display_order, is_required, unit_override, help_text }
router.patch('/crop-field-mappings/:mappingId/unmap', auth, c.unmapFieldFromCrop);
router.get('/get-growth-form-by-stock-item/:stockItemId', auth, c.getGrowthFormByStockItem);

module.exports = router;