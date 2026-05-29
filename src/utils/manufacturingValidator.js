const Joi = require("joi");

const createManufacturingSchema = Joi.object({
  entry_date: Joi.date().required(),

  finished_item_id: Joi.number().required(),

  finished_godown_id: Joi.number().required(),

  produced_qty: Joi.number().required(),

  batch_no: Joi.string().allow("", null),

  mfg_date: Joi.date().allow(null),

  expiry_date: Joi.date().allow(null),

  total_component_cost: Joi.number().required(),

  total_additional_cost: Joi.number().required(),

  total_cost: Joi.number().required(),

  effective_rate: Joi.number().required(),

  remarks: Joi.string().allow("", null),

  components: Joi.array()
    .items(
      Joi.object({
        item_id: Joi.number().required(),

        godown_id: Joi.number().required(),

        available_qty: Joi.number().allow(null),

        qty: Joi.number().required(),

        unit_id: Joi.number().required(),

        rate: Joi.number().required(),

        amount: Joi.number().required(),
      }),
    )
    .required(),

  coproducts: Joi.array()
    .items(
      Joi.object({
        item_id: Joi.number().required(),

        godown_id: Joi.number().required(),

        qty: Joi.number().required(),

        cost_allocation_percent: Joi.number().required(),

        unit_id: Joi.number().required(),

        rate: Joi.number().required(),

        amount: Joi.number().required(),
      }),
    )
    .optional(),

  additional_costs: Joi.array()
    .items(
      Joi.object({
        ledger_id: Joi.number().required(),

        amount: Joi.number().required(),
      }),
    )
    .optional(),
});

module.exports = {
  createManufacturingSchema,
};
