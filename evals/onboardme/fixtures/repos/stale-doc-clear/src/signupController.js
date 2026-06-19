const { appendSignup } = require("./reportStore");
const { publish } = require("./digestQueue");

function createSignupReport(input) {
  const report = appendSignup(input.email, input.plan);
  publish("SignupRecorded", { reportId: report.id });
  return { status: 201, reportId: report.id };
}

module.exports = { createSignupReport };
