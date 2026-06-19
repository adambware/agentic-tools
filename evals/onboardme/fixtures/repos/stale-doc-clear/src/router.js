const { createSignupReport } = require("./signupController");

function route(method, path, body) {
  if (method === "POST" && path === "/signup-reports") {
    return createSignupReport(body);
  }

  return { status: 404 };
}

module.exports = { route };
