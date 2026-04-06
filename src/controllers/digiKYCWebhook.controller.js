// controllers/digioWebhook.controller.js

const digioWebhook = (req, res) => {
  try {
    console.log(" DIGIO WEBHOOK RECEIVED");

    console.log(" Event:", req.body.event);
    console.log(" Entities:", req.body.entities);

    console.log(" Full Payload:");
    console.log(JSON.stringify(req.body, null, 2));

    //  Example: Extract useful data
    const event = req.body.event;

    if (event === "KYC_REQUEST_COMPLETED") {
      console.log(" KYC Completed");
    }

    if (event === "DOCUMENTS_PULLED_SUCCESSFULLY") {
      console.log(" Digilocker documents fetched");
    }

    if (event === "KYC_REQUEST_APPROVED") {
      console.log(" KYC Approved");
    }

    res.sendStatus(200); // VERY IMPORTANT

  } catch (error) {
    console.error("Webhook Error:", error.message);
    res.sendStatus(500);
  }
};

module.exports = { digioWebhook };