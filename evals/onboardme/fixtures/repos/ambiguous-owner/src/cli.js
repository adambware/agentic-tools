const { writeAuditRow } = require("./auditWriter");
const { exportCsv } = require("./csvExporter");

function run(argv) {
  if (argv[2] === "export-audit") {
    const exportId = exportCsv(argv[3]);
    writeAuditRow({ type: "manual-export", exportId });
    return exportId;
  }

  return null;
}

module.exports = { run };
