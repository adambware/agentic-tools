function appendSignup(email, plan) {
  return { id: "signup_1", email, plan, database: "signup_reports.sqlite" };
}

module.exports = { appendSignup };
