const dayjs = require("dayjs"); 
const whatsappService = require("../whatsapp.service");

const formatOrderDate = (date) => dayjs(date).format("DD MMMM, YYYY");
const formatAmount = (amount) => Number(amount).toLocaleString("en-IN");

exports.sendOrderConfirmedNotification = async ({ phone, recipientName, orderNo, orderDate, amount}) => {
    if (!phone) {
        console.warn(`Skipping order_confirmed WhatsApp — no phone for order ${orderNo}`);
        return;
    }

    const components = [
        {
            type: "body",
            parameters: [
                { type: "text", text: recipientName },
                { type: "text", text: String(orderNo) },
                { type: "text", text: formatOrderDate(orderDate) },
                { type: "text", text: formatAmount(amount) }
            ]
        }
    ];

    return whatsappService.sendTemplateMessage(phone, "order_confirmed", "en_US", components);
};

exports.sendOrderDispatchedNotification = async ({
    phone,
    recipientName,
    orderNo,
    transportName,
    biltyNo,
    biltyImageBuffer,
    biltyImageMimeType
}) => {
    if (!phone) {
        console.warn(`Skipping order_dispatched_image WhatsApp — no phone for order ${orderNo}`);
        return;
    }
    if (!biltyImageBuffer) {
        console.warn(`Skipping order_dispatched_image WhatsApp — no bilty image for order ${orderNo}`);
        return;
    }

    const mediaId = await whatsappService.uploadMedia(
        biltyImageBuffer,
        biltyImageMimeType,
        `bilty-${orderNo}.jpg`
    );

    const components = [
        {
            type: "header",
            parameters: [
                { type: "image", image: { id: mediaId } }
            ]
        },
        {
            type: "body",
            parameters: [
                { type: "text", text: recipientName },
                { type: "text", text: String(orderNo) },
                { type: "text", text: transportName },
                { type: "text", text: biltyNo }
            ]
        }
    ];

    return whatsappService.sendTemplateMessage(phone, "order_dispatched_image", "en_US", components);
};