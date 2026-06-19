const { createOrder } = require("./orderController");

function route(method, path, body) {
  if (method === "POST" && path === "/orders") {
    return createOrder(body);
  }

  return { status: 404 };
}

module.exports = { route };
