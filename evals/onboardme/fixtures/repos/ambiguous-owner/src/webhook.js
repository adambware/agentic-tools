const { writeAuditRow } = require("./auditWriter");

function receiveWebhook(payload) {
  writeAuditRow({ type: "partner-webhook", partnerId: payload.partnerId });
  return { status: 204 };
}

module.exports = { receiveWebhook };
