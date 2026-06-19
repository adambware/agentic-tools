function writeAuditRow(row) {
  return { stream: "audit-log", row };
}

module.exports = { writeAuditRow };
